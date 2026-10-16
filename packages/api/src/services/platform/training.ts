import { newId, type Permission } from '@pos/core';
import {
  type Database,
  runCommand,
  schema as s,
  type TenantContext,
  type Transaction,
} from '@pos/db';
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { MySqlColumn, MySqlTable } from 'drizzle-orm/mysql-core';
import { type Actor, assertPermission, requireLocationId } from '../../actor';
import { ApiError, notFound } from '../../errors';
import { assertActiveStaff, uniqueSlug } from '../admin/support';
import { newQrCode } from '../locations';
import { issuePairingCode, type TerminalDto, toTerminalDto } from '../people/devices';
import type { ServiceDeps } from '../shared';

/**
 * Training organization (RF-F22): a copy of the real one — locations, floor, stations, menu,
 * MWST setup, roles and staff with the same PINs, and its devices with new pairings — in an
 * organization of its own, so practice orders, payments and closings never mix with the real
 * ones. Its receipts say they are not valid, it never alerts and counts in no plan. A new copy
 * replaces the previous one: the old devices are unpaired and nothing is deleted.
 */

type CopiedTable = MySqlTable & { organizationId: MySqlColumn; id: MySqlColumn };

/** In foreign-key order; customers, API keys, grants and subscriptions stay with the real one. */
const COPIED_TABLES = [
  s.locations,
  s.areas,
  s.diningTables,
  s.printers,
  s.kitchenStations,
  s.terminals,
  s.roles,
  s.rolePermissions,
  s.users,
  s.userLocations,
  s.userRoles,
  s.taxCategories,
  s.taxRates,
  s.taxRules,
  s.categories,
  s.products,
  s.productVariants,
  s.modifierGroups,
  s.modifiers,
  s.productModifierGroups,
  s.productAllergens,
  s.modifierAllergens,
  s.productOrigins,
  s.translations,
  s.availabilityRules,
  s.channelPrices,
  s.productLocationSettings,
  s.productStationRoutes,
] as unknown as readonly CopiedTable[];

type Row = Record<string, unknown>;

/** Every copied id, also inside JSON (settings, keys), points to its copy. */
function remap(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => remap(item, ids));
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;
  if (Buffer.isBuffer(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [ids.get(key) ?? key, remap(item, ids)]),
  );
}

const isTable = (table: CopiedTable, other: unknown) => table === other;

/** What a copy must not carry: device pairings, sign-in secrets, the real printers. */
function prepare(table: CopiedTable, row: Row): Row | null {
  if (isTable(table, s.terminals)) {
    // A waiter's own phone pairs with the waiter's PIN (DEC-036); practice uses the location's.
    if (row.type === 'phone') return null;
    return {
      ...row,
      appVersion: null,
      lastSeenAt: null,
      pairingCodeHash: null,
      pairingExpiresAt: null,
      deviceTokenHash: null,
      pairedAt: null,
    };
  }
  if (isTable(table, s.users)) {
    // Staff practise with their PIN; the backoffice stays the real one.
    return {
      ...row,
      email: null,
      passwordHash: null,
      totpSecret: null,
      twoFactorEnabled: false,
      mustChangePassword: false,
      failedPinAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
    };
  }
  // Practice tickets and receipts never come out of the real printers.
  if (isTable(table, s.printers)) return { ...row, isActive: false };
  // A table's QR code is unique on the platform: the practice table gets its own.
  if (isTable(table, s.diningTables)) return { ...row, qrCode: newQrCode() };
  return row;
}

const CHUNK = 500;

async function copyOrganization(
  tx: Transaction,
  source: typeof s.organizations.$inferSelect,
  slug: string,
): Promise<string> {
  const trainingId = newId();
  const ids = new Map<string, string>([[source.id, trainingId]]);
  const loaded: { table: CopiedTable; rows: Row[] }[] = [];
  for (const table of COPIED_TABLES) {
    const rows = (await tx
      .select()
      .from(table)
      .where(eq(table.organizationId, source.id))) as Row[];
    for (const row of rows) ids.set(row.id as string, newId());
    loaded.push({ table, rows });
  }

  await tx.insert(s.organizations).values({
    id: trainingId,
    name: `Übung · ${source.name}`.slice(0, 200),
    slug,
    legalName: source.legalName,
    defaultLanguage: source.defaultLanguage,
    status: 'active',
    isTraining: true,
    trainingOfId: source.id,
    // The same key: every PIN opens the practice devices as it opens the real ones.
    pinKey: source.pinKey,
  });
  const now = new Date();
  // Self-references (sub-categories, fallback stations) may point anywhere in the copy.
  await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
  try {
    for (const { table, rows } of loaded) {
      const copies = rows.flatMap((row) => {
        const prepared = prepare(table, row);
        if (!prepared) return [];
        const copy = remap(prepared, ids) as Row;
        return [{ ...copy, ...('createdAt' in copy ? { createdAt: now, updatedAt: now } : {}) }];
      });
      for (let start = 0; start < copies.length; start += CHUNK) {
        await tx.insert(table).values(copies.slice(start, start + CHUNK) as never);
      }
    }
  } finally {
    await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
  }
  return trainingId;
}

async function currentTraining(db: Database | Transaction, organizationId: string) {
  const [training] = await db
    .select()
    .from(s.organizations)
    .where(
      and(
        eq(s.organizations.trainingOfId, organizationId),
        eq(s.organizations.isTraining, true),
        isNull(s.organizations.deletedAt),
      ),
    )
    .orderBy(desc(s.organizations.createdAt))
    .limit(1);
  return training ?? null;
}

/**
 * Copies the organization into a new training one. The previous copy is retired (soft delete)
 * and its devices unpaired, so they show the pairing screen for the new one.
 */
async function createTrainingOf(
  db: Database,
  ctx: TenantContext,
  organizationId: string,
): Promise<string> {
  const [source] = await db
    .select()
    .from(s.organizations)
    .where(and(eq(s.organizations.id, organizationId), isNull(s.organizations.deletedAt)));
  if (!source) throw notFound('Organization');
  if (source.isTraining) {
    throw new ApiError('CONFLICT', 'A training organization is not copied again', {
      reason: 'already_training',
    });
  }
  const slug = await uniqueSlug(db, `${source.slug}-training`);
  return runCommand(db, ctx, async (tx, recorder) => {
    const previous = await currentTraining(tx, source.id);
    if (previous) {
      await tx
        .update(s.organizations)
        .set({ deletedAt: new Date(), status: 'archived' })
        .where(eq(s.organizations.id, previous.id));
      await tx
        .update(s.terminals)
        .set({ deviceTokenHash: null, pairingCodeHash: null, pairingExpiresAt: null })
        .where(eq(s.terminals.organizationId, previous.id));
    }
    const trainingId = await copyOrganization(tx, source, slug);
    recorder.audit({
      action: 'training.created',
      entityType: 'organization',
      entityId: trainingId,
      locationId: null,
      after: { trainingOrganizationId: trainingId, replaced: previous?.id ?? null },
    });
    return trainingId;
  });
}

export interface TrainingDto {
  organizationId: string;
  name: string;
  createdAt: string;
  /** The practice devices of the caller's location, to pair them. */
  terminals: TerminalDto[];
}

/** The practice copy of the caller's location: the same name in the training organization. */
async function trainingLocation(db: Database, actor: Actor, trainingId: string) {
  const locationId = requireLocationId(actor);
  const [real] = await db
    .select({ name: s.locations.name })
    .from(s.locations)
    .where(
      and(eq(s.locations.id, locationId), eq(s.locations.organizationId, actor.organizationId)),
    );
  if (!real) throw notFound('Location');
  const [copy] = await db
    .select({ id: s.locations.id })
    .from(s.locations)
    .where(and(eq(s.locations.organizationId, trainingId), eq(s.locations.name, real.name)));
  return copy?.id ?? null;
}

/** «Übungsbetrieb» in «My plan»: the current practice copy and its devices, or null. */
export async function getTraining(deps: ServiceDeps, actor: Actor): Promise<TrainingDto | null> {
  assertPermission(actor, 'location.manage');
  const training = await currentTraining(deps.db, actor.organizationId);
  if (!training) return null;
  const locationId = await trainingLocation(deps.db, actor, training.id);
  const terminals = locationId
    ? await deps.db
        .select()
        .from(s.terminals)
        .where(
          and(
            eq(s.terminals.organizationId, training.id),
            eq(s.terminals.locationId, locationId),
            ne(s.terminals.type, 'phone'),
            isNull(s.terminals.deletedAt),
          ),
        )
        .orderBy(asc(s.terminals.name))
    : [];
  return {
    organizationId: training.id,
    name: training.name,
    createdAt: training.createdAt.toISOString(),
    terminals: terminals.map((row) => toTerminalDto(row)),
  };
}

/** The owner creates (or renews) the practice copy from the backoffice. */
export async function createTraining(deps: ServiceDeps, actor: Actor): Promise<TrainingDto> {
  assertPermission(actor, 'location.manage');
  await createTrainingOf(deps.db, actor, actor.organizationId);
  return (await getTraining(deps, actor))!;
}

/** Support creates (or renews) it for an organization, e.g. before the go-live training. */
export async function createTrainingAsSupport(
  deps: ServiceDeps,
  staff: { staffId: string },
  organizationId: string,
): Promise<{ organizationId: string }> {
  await assertActiveStaff(deps.db, staff.staffId);
  const trainingId = await createTrainingOf(
    deps.db,
    {
      organizationId,
      locationId: null,
      userId: null,
      supportStaffId: staff.staffId,
      requestId: `support:${staff.staffId}`,
    },
    organizationId,
  );
  return { organizationId: trainingId };
}

const PAIRING_ONLY: ReadonlySet<Permission> = new Set(['location.manage']);

/**
 * Pairing code for a practice device, issued from the real backoffice: the device ends up in
 * the training organization, and the real one never sees its data.
 */
export async function issueTrainingPairingCode(
  deps: ServiceDeps,
  actor: Actor,
  terminalId: string,
): Promise<{ code: string; expiresAt: string }> {
  assertPermission(actor, 'location.manage');
  const training = await currentTraining(deps.db, actor.organizationId);
  if (!training) throw notFound('Terminal');
  const locationId = await trainingLocation(deps.db, actor, training.id);
  if (!locationId) throw notFound('Terminal');
  return issuePairingCode(
    deps,
    {
      kind: 'user',
      organizationId: training.id,
      locationId,
      userId: null,
      permissions: PAIRING_ONLY,
      requestId: actor.requestId ?? null,
    },
    terminalId,
  );
}
