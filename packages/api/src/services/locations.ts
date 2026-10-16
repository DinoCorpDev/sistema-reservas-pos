import { randomBytes } from 'node:crypto';
import {
  type createAreaSchema,
  type createTableSchema,
  asCountry,
  formatTaxId,
  locationFieldProblems,
  type LocationSettings,
  parseLocationSettings,
  type UpdateLocationInput,
  type updateAreaSchema,
  type updateTableSchema,
} from '@pos/core';
import { inLocation, inOrg, notDeleted, ownedByLocation, runCommand, schema as s } from '@pos/db';
import { asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { type Actor, assertPermission, requireLocationId } from '../actor';
import { ApiError, notFound } from '../errors';
import { changedFields, definedOnly, iso, type ServiceDeps } from './shared';
import { assertGrowth } from './platform/plans';

// ── Locations (RF-A02) ──────────────────────────────────────────────────────

type LocationRow = typeof s.locations.$inferSelect;

export function toLocationDto(row: LocationRow) {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legalName,
    street: row.street,
    postalCode: row.postalCode,
    city: row.city,
    canton: row.canton,
    country: row.country,
    vatUid: row.vatUid,
    currency: row.currency,
    timezone: row.timezone,
    defaultLanguage: row.defaultLanguage,
    kitchenLanguage: row.kitchenLanguage,
    languages: row.languages,
    phone: row.phone,
    email: row.email,
    receiptHeader: row.receiptHeader,
    receiptFooter: row.receiptFooter,
    openingHours: row.openingHours ?? null,
    settings: parseLocationSettings(row.settings),
    operationActivatedAt: iso(row.setupCompletedAt),
  };
}
export type LocationDto = ReturnType<typeof toLocationDto>;

async function loadLocation(deps: ServiceDeps, actor: Actor, id: string) {
  const [row] = await deps.db
    .select()
    .from(s.locations)
    .where(inOrg(s.locations, actor, eq(s.locations.id, id), notDeleted(s.locations)));
  if (!row) throw notFound('Location');
  return row;
}

export async function listLocations(deps: ServiceDeps, actor: Actor): Promise<LocationDto[]> {
  const rows = await deps.db
    .select()
    .from(s.locations)
    .where(inOrg(s.locations, actor, notDeleted(s.locations)))
    .orderBy(asc(s.locations.name));
  return rows.map(toLocationDto);
}

export async function getLocation(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
): Promise<LocationDto> {
  return toLocationDto(await loadLocation(deps, actor, id));
}

export async function updateLocation(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: UpdateLocationInput,
): Promise<LocationDto> {
  assertPermission(actor, 'location.manage');
  const current = await loadLocation(deps, actor, id);
  // The country stays; its address and tax id rules apply (DEC-047).
  const country = asCountry(current.country);
  const [problem] = locationFieldProblems(country, input);
  if (problem) {
    throw new ApiError('VALIDATION_FAILED', problem.message, { path: [problem.path] });
  }
  const patch = definedOnly({
    ...input,
    vatUid:
      input.vatUid === undefined ? undefined : input.vatUid && formatTaxId(country, input.vatUid),
    canton: input.canton === undefined ? undefined : (input.canton?.toUpperCase() ?? null),
  });

  const languages = patch.languages ?? current.languages;
  const defaultLanguage = patch.defaultLanguage ?? current.defaultLanguage;
  if (!languages.includes(defaultLanguage)) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'The location languages must include the default language',
      {
        path: ['languages'],
      },
    );
  }

  return runCommand(deps.db, { ...actor, locationId: id }, async (tx, recorder) => {
    await tx
      .update(s.locations)
      .set(patch)
      .where(inOrg(s.locations, actor, eq(s.locations.id, id)));
    const diff = changedFields(current as unknown as Record<string, unknown>, patch);
    if (Object.keys(diff.after).length > 0) {
      recorder.audit({ action: 'location.updated', entityType: 'location', entityId: id, ...diff });
    }
    const [row] = await tx.select().from(s.locations).where(eq(s.locations.id, id));
    return toLocationDto(row!);
  });
}

/** Operating thresholds of the location (DEC-004): replaced as a whole, validated with defaults. */
export async function updateLocationSettings(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<LocationSettings> {
  assertPermission(actor, 'location.manage');
  const current = await loadLocation(deps, actor, id);
  const settings = parseLocationSettings(input);
  if (
    settings.tableOwnership === 'restricted' &&
    parseLocationSettings(current.settings).tableOwnership !== 'restricted'
  ) {
    // Tables of their own per waiter is a module of the plan (DEC-039, DEC-045).
    await assertGrowth(deps.db, actor.organizationId, { feature: 'table_ownership' });
  }
  await runCommand(deps.db, { ...actor, locationId: id }, async (tx, recorder) => {
    await tx
      .update(s.locations)
      .set({ settings })
      .where(inOrg(s.locations, actor, eq(s.locations.id, id)));
    recorder.audit({
      action: 'location.settings_changed',
      entityType: 'location',
      entityId: id,
      before: parseLocationSettings(current.settings),
      after: settings,
    });
  });
  return settings;
}

// ── Areas (RF-A03, RF-C06) ──────────────────────────────────────────────────

type AreaRow = typeof s.areas.$inferSelect;

const toAreaDto = (row: AreaRow) => ({
  id: row.id,
  locationId: row.locationId,
  name: row.name,
  qrMode: row.qrMode,
  sortOrder: row.sortOrder,
  isActive: row.isActive,
});
export type AreaDto = ReturnType<typeof toAreaDto>;

async function loadArea(deps: ServiceDeps, actor: Actor, id: string) {
  const [row] = await deps.db
    .select()
    .from(s.areas)
    .where(inLocation(s.areas, actor, eq(s.areas.id, id), notDeleted(s.areas)));
  if (!row) throw notFound('Area');
  return row;
}

export async function listAreas(deps: ServiceDeps, actor: Actor): Promise<AreaDto[]> {
  requireLocationId(actor);
  const rows = await deps.db
    .select()
    .from(s.areas)
    .where(inLocation(s.areas, actor, notDeleted(s.areas)))
    .orderBy(asc(s.areas.sortOrder), asc(s.areas.name));
  return rows.map(toAreaDto);
}

export async function createArea(
  deps: ServiceDeps,
  actor: Actor,
  input: z.output<typeof createAreaSchema>,
): Promise<AreaDto> {
  assertPermission(actor, 'location.manage');
  requireLocationId(actor);
  const values = ownedByLocation(actor, input);
  const [row] = await deps.db.insert(s.areas).values(values).$returningId();
  return toAreaDto(await loadArea(deps, actor, row!.id));
}

export async function updateArea(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: z.output<typeof updateAreaSchema>,
): Promise<AreaDto> {
  assertPermission(actor, 'location.manage');
  await loadArea(deps, actor, id);
  await deps.db
    .update(s.areas)
    .set(definedOnly(input))
    .where(inLocation(s.areas, actor, eq(s.areas.id, id)));
  return toAreaDto(await loadArea(deps, actor, id));
}

/** Soft delete (PA-06); only when the area has no tables left. Seasonal areas are deactivated instead. */
export async function deleteArea(deps: ServiceDeps, actor: Actor, id: string): Promise<void> {
  assertPermission(actor, 'location.manage');
  await loadArea(deps, actor, id);
  const tables = await deps.db
    .select({ id: s.diningTables.id })
    .from(s.diningTables)
    .where(
      inLocation(s.diningTables, actor, eq(s.diningTables.areaId, id), notDeleted(s.diningTables)),
    )
    .limit(1);
  if (tables.length > 0) {
    throw new ApiError(
      'CONFLICT',
      'The area still has tables; move or remove them, or deactivate the area',
    );
  }
  await deps.db
    .update(s.areas)
    .set({ deletedAt: new Date(), isActive: false })
    .where(inLocation(s.areas, actor, eq(s.areas.id, id)));
}

// ── Tables (RF-A03, RF-E06) ─────────────────────────────────────────────────

type TableRow = typeof s.diningTables.$inferSelect;

const toTableDto = (row: TableRow) => ({
  id: row.id,
  locationId: row.locationId,
  areaId: row.areaId,
  label: row.label,
  qrCode: row.qrCode,
  capacity: row.capacity,
  shape: row.shape,
  posX: row.posX,
  posY: row.posY,
  width: row.width,
  height: row.height,
  qrMode: row.qrMode,
  isActive: row.isActive,
});
export type TableDto = ReturnType<typeof toTableDto>;

/** Public QR code of a table: 12 URL-safe characters, unguessable (RF-E06). */
export const newQrCode = () => randomBytes(9).toString('base64url');

async function loadTable(deps: ServiceDeps, actor: Actor, id: string) {
  const [row] = await deps.db
    .select()
    .from(s.diningTables)
    .where(
      inLocation(s.diningTables, actor, eq(s.diningTables.id, id), notDeleted(s.diningTables)),
    );
  if (!row) throw notFound('Table');
  return row;
}

export async function listTables(deps: ServiceDeps, actor: Actor): Promise<TableDto[]> {
  requireLocationId(actor);
  const rows = await deps.db
    .select()
    .from(s.diningTables)
    .where(inLocation(s.diningTables, actor, notDeleted(s.diningTables)))
    .orderBy(asc(s.diningTables.label));
  return rows.map(toTableDto);
}

export async function createTable(
  deps: ServiceDeps,
  actor: Actor,
  input: z.output<typeof createTableSchema>,
): Promise<TableDto> {
  assertPermission(actor, 'location.manage');
  await loadArea(deps, actor, input.areaId);
  const [row] = await deps.db
    .insert(s.diningTables)
    .values(ownedByLocation(actor, { ...input, qrCode: newQrCode() }))
    .$returningId();
  return toTableDto(await loadTable(deps, actor, row!.id));
}

export async function updateTable(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: z.output<typeof updateTableSchema>,
): Promise<TableDto> {
  assertPermission(actor, 'location.manage');
  await loadTable(deps, actor, id);
  if (input.areaId) await loadArea(deps, actor, input.areaId);
  await deps.db
    .update(s.diningTables)
    .set(definedOnly(input))
    .where(inLocation(s.diningTables, actor, eq(s.diningTables.id, id)));
  return toTableDto(await loadTable(deps, actor, id));
}

/** New QR code for a table, e.g. when a printed code was copied or damaged. */
export async function regenerateTableQr(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
): Promise<TableDto> {
  assertPermission(actor, 'location.manage');
  await loadTable(deps, actor, id);
  await deps.db
    .update(s.diningTables)
    .set({ qrCode: newQrCode() })
    .where(inLocation(s.diningTables, actor, eq(s.diningTables.id, id)));
  return toTableDto(await loadTable(deps, actor, id));
}

export async function deleteTable(deps: ServiceDeps, actor: Actor, id: string): Promise<void> {
  assertPermission(actor, 'location.manage');
  await loadTable(deps, actor, id);
  await deps.db
    .update(s.diningTables)
    .set({ deletedAt: new Date(), isActive: false })
    .where(inLocation(s.diningTables, actor, eq(s.diningTables.id, id)));
}
