import { randomBytes } from 'node:crypto';
import {
  type createAreaSchema,
  type createTableSchema,
  asCountry,
  formatTaxId,
  locationFieldProblems,
  type LocationSettings,
  parseLocationSettings,
  type FloorPhotoInput,
  type PlannedTable,
  planFromPhoto,
  type SaveFloorLayoutInput,
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
import { claudeFloorReader, type FloorPhotoReader } from './ai/floor-photo';

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

// ── Floor plan of an area (DEC-056) ─────────────────────────────────────────

/**
 * Saves the plan of an area as the editor shows it, in one transaction: existing tables move or
 * change, new ones are created with their QR code; a table left out keeps its place (removing
 * one stays an explicit action). The input is already checked by `saveFloorLayoutSchema`: in the
 * grid, no overlaps, unique labels. A label another table of the location already has is a 409.
 */
export async function saveFloorLayout(
  deps: ServiceDeps,
  actor: Actor,
  areaId: string,
  input: SaveFloorLayoutInput,
): Promise<{ created: number; updated: number }> {
  assertPermission(actor, 'location.manage');
  await loadArea(deps, actor, areaId);
  // Every table of the location, removed ones too: labels are unique across all of them.
  const all = await deps.db
    .select({
      id: s.diningTables.id,
      areaId: s.diningTables.areaId,
      label: s.diningTables.label,
      deletedAt: s.diningTables.deletedAt,
    })
    .from(s.diningTables)
    .where(inLocation(s.diningTables, actor));
  const inArea = new Set(
    all.filter((t) => t.areaId === areaId && t.deletedAt === null).map((t) => t.id),
  );
  // Tables in the plan take their labels from it (unique there); the others keep theirs.
  const planned = new Set(input.tables.flatMap((t) => (t.id ? [t.id] : [])));
  const kept = all.filter((other) => !planned.has(other.id));
  for (const table of input.tables) {
    if (table.id !== null && !inArea.has(table.id)) throw notFound('Table');
    const clash = kept.find((other) => other.label.toLowerCase() === table.label.toLowerCase());
    if (clash) {
      throw new ApiError(
        'CONFLICT',
        `Another table of this location is already called ${table.label}`,
        {
          field: 'label',
          reason: 'label_taken',
          label: table.label,
        },
      );
    }
  }
  const now = new Date();
  const position = (t: SaveFloorLayoutInput['tables'][number]) => ({
    label: t.label,
    capacity: t.capacity,
    shape: t.shape,
    posX: t.posX,
    posY: t.posY,
    width: t.width,
    height: t.height,
  });
  const existing = input.tables.filter((t) => t.id !== null);
  const fresh = input.tables.filter((t) => t.id === null);
  await runCommand(deps.db, actor, async (tx, recorder) => {
    // Labels first move out of the way, so two tables can swap names in one save.
    for (const table of existing) {
      await tx
        .update(s.diningTables)
        .set({ label: `~${table.id!.slice(-14)}`, updatedAt: now })
        .where(inLocation(s.diningTables, actor, eq(s.diningTables.id, table.id!)));
    }
    for (const table of existing) {
      await tx
        .update(s.diningTables)
        .set({ ...position(table), updatedAt: now })
        .where(inLocation(s.diningTables, actor, eq(s.diningTables.id, table.id!)));
    }
    if (fresh.length > 0) {
      await tx.insert(s.diningTables).values(
        fresh.map((table) =>
          ownedByLocation(actor, {
            ...position(table),
            areaId,
            qrCode: newQrCode(),
            qrMode: null,
          }),
        ),
      );
    }
    recorder.audit({
      action: 'floor.layout_saved',
      entityType: 'area',
      entityId: areaId,
      after: { tables: input.tables.length, created: fresh.length, updated: existing.length },
    });
  });
  return { created: fresh.length, updated: existing.length };
}

/**
 * The AI reads a photo or sketch of the area and proposes its plan (DEC-056): tables on the
 * grid, numbered after the labels the location already uses elsewhere. Nothing is saved here:
 * the editor shows the proposal over the photo and the person saves it (PA-07). `reader` is
 * the AI; tests pass their own.
 */
export async function readFloorPhoto(
  deps: ServiceDeps,
  actor: Actor,
  areaId: string,
  photo: FloorPhotoInput,
  reader: FloorPhotoReader | null = claudeFloorReader(),
): Promise<{ tables: PlannedTable[]; notes: string | null }> {
  assertPermission(actor, 'location.manage');
  const area = await loadArea(deps, actor, areaId);
  if (!reader) {
    throw new ApiError('RULE_VIOLATION', 'Reading photos needs an AI key (ANTHROPIC_API_KEY)', {
      reason: 'ai_not_configured',
    });
  }
  const all = await deps.db
    .select({
      areaId: s.diningTables.areaId,
      label: s.diningTables.label,
      deletedAt: s.diningTables.deletedAt,
    })
    .from(s.diningTables)
    .where(inLocation(s.diningTables, actor));
  const here = all.filter((t) => t.areaId === areaId && t.deletedAt === null).map((t) => t.label);
  const elsewhere = new Set(all.filter((t) => !here.includes(t.label)).map((t) => t.label));
  const reading = await reader(photo, { areaName: area.name, knownLabels: here });
  return { tables: planFromPhoto(reading, { takenLabels: elsewhere }), notes: reading.notes };
}

/** Whether this installation can read photos at all (the key is set), for the editor. */
export const canReadFloorPhotos = (): boolean => Boolean(process.env.ANTHROPIC_API_KEY);
