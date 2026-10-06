import {
  checkPublishable,
  computeSetupChecklist,
  type SetupCheck,
  type SetupSnapshot,
} from '@pos/core';
import { type Database, inLocation, inOrg, notDeleted, runCommand, schema as s } from '@pos/db';
import { and, count, countDistinct, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { type Actor, assertPermission, requireLocationId } from '../../actor';
import { ApiError, notFound } from '../../errors';
import { iso, type ServiceDeps } from '../shared';
import { commandContext, localDate } from './common';
import { loadTaxData, resolvesForAllConsumptionTypes } from './tax';

/**
 * Setup checklist of the location (RF-A11, gate of Phase 1): what is still missing before the
 * restaurant can operate. The snapshot is counted in SQL; the rules live in @pos/core.
 */

export interface SetupChecklistDto {
  locationId: string;
  checks: SetupCheck[];
  done: number;
  total: number;
  complete: boolean;
  /** When the owner activated real operation (`locations.setup_completed_at`). */
  operationActivatedAt: string | null;
}

type LocationRow = typeof s.locations.$inferSelect;

async function loadLocation(db: Database, actor: Actor, locationId: string) {
  const [row] = await db
    .select()
    .from(s.locations)
    .where(inOrg(s.locations, actor, eq(s.locations.id, locationId), notDeleted(s.locations)));
  if (!row) throw notFound('Location');
  return row;
}

const value = (rows: { value: number }[]) => Number(rows[0]?.value ?? 0);

/** Builds the `SetupSnapshot` of the actor's location from the database. */
export async function buildSetupSnapshot(
  db: Database,
  actor: Actor,
  location: LocationRow,
): Promise<SetupSnapshot> {
  const ctx = { ...actor, locationId: location.id };
  const otherLanguages = location.languages.filter((l) => l !== location.defaultLanguage);

  const [areas, tables, posTerminals, stations, receiptPrinters, managers] = await Promise.all([
    db
      .select({ value: count() })
      .from(s.areas)
      .where(inLocation(s.areas, ctx, eq(s.areas.isActive, true), notDeleted(s.areas))),
    // Tables of a deactivated (seasonal) area cannot be used (RF-C06).
    db
      .select({ value: count() })
      .from(s.diningTables)
      .innerJoin(
        s.areas,
        and(
          eq(s.areas.id, s.diningTables.areaId),
          eq(s.areas.isActive, true),
          isNull(s.areas.deletedAt),
        ),
      )
      .where(
        inLocation(
          s.diningTables,
          ctx,
          eq(s.diningTables.isActive, true),
          notDeleted(s.diningTables),
        ),
      ),
    db
      .select({ value: count() })
      .from(s.terminals)
      .where(
        inLocation(
          s.terminals,
          ctx,
          eq(s.terminals.type, 'pos'),
          eq(s.terminals.isActive, true),
          notDeleted(s.terminals),
        ),
      ),
    db
      .select({ value: count() })
      .from(s.kitchenStations)
      .where(
        inLocation(
          s.kitchenStations,
          ctx,
          eq(s.kitchenStations.isActive, true),
          notDeleted(s.kitchenStations),
        ),
      ),
    db
      .select({ value: count() })
      .from(s.printers)
      .where(
        inLocation(
          s.printers,
          ctx,
          eq(s.printers.kind, 'receipt'),
          eq(s.printers.isActive, true),
          notDeleted(s.printers),
        ),
      ),
    // Active users working here, with a PIN, whose roles (here or everywhere) grant approvals (RN-15).
    db
      .select({ value: countDistinct(s.users.id) })
      .from(s.users)
      .innerJoin(
        s.userLocations,
        and(
          eq(s.userLocations.userId, s.users.id),
          eq(s.userLocations.locationId, location.id),
          isNull(s.userLocations.deletedAt),
        ),
      )
      .innerJoin(
        s.userRoles,
        and(
          eq(s.userRoles.userId, s.users.id),
          isNull(s.userRoles.deletedAt),
          or(isNull(s.userRoles.locationId), eq(s.userRoles.locationId, location.id)),
        ),
      )
      .innerJoin(s.roles, and(eq(s.roles.id, s.userRoles.roleId), isNull(s.roles.deletedAt)))
      .innerJoin(
        s.rolePermissions,
        and(
          eq(s.rolePermissions.roleId, s.roles.id),
          eq(s.rolePermissions.permission, 'approval.grant'),
          isNull(s.rolePermissions.deletedAt),
        ),
      )
      .where(
        inOrg(
          s.users,
          ctx,
          eq(s.users.isActive, true),
          notDeleted(s.users),
          isNotNull(s.users.pinHash),
        ),
      ),
  ]);

  // Active products: active in the catalog and not deactivated at this location (RF-B01).
  const products = await db
    .select({
      id: s.products.id,
      taxCategoryId: s.products.taxCategoryId,
      allergensComplete: s.products.allergensComplete,
      requiresOrigin: s.products.requiresOrigin,
    })
    .from(s.products)
    .leftJoin(
      s.productLocationSettings,
      and(
        eq(s.productLocationSettings.productId, s.products.id),
        eq(s.productLocationSettings.locationId, location.id),
        isNull(s.productLocationSettings.deletedAt),
      ),
    )
    .where(
      inOrg(
        s.products,
        ctx,
        eq(s.products.isActive, true),
        notDeleted(s.products),
        or(isNull(s.productLocationSettings.id), eq(s.productLocationSettings.isActive, true)),
      ),
    );
  const productIds = products.map((p) => p.id);

  const [origins, routed, translated, tax] = await Promise.all([
    productIds.length === 0
      ? []
      : db
          .select({
            productId: s.productOrigins.productId,
            kind: s.productOrigins.kind,
            country: s.productOrigins.country,
          })
          .from(s.productOrigins)
          .where(
            inOrg(
              s.productOrigins,
              ctx,
              inArray(s.productOrigins.productId, productIds),
              notDeleted(s.productOrigins),
            ),
          ),
    // Routed = at least one route to an active kitchen station of this location (RF-B11).
    db
      .selectDistinct({ productId: s.productStationRoutes.productId })
      .from(s.productStationRoutes)
      .innerJoin(
        s.kitchenStations,
        and(
          eq(s.kitchenStations.id, s.productStationRoutes.kitchenStationId),
          eq(s.kitchenStations.isActive, true),
          isNull(s.kitchenStations.deletedAt),
        ),
      )
      .where(inLocation(s.productStationRoutes, ctx, notDeleted(s.productStationRoutes))),
    productIds.length === 0 || otherLanguages.length === 0
      ? []
      : db
          .select({ productId: s.translations.entityId, language: s.translations.language })
          .from(s.translations)
          .where(
            inOrg(
              s.translations,
              ctx,
              eq(s.translations.entityType, 'product'),
              eq(s.translations.field, 'name'),
              inArray(s.translations.language, otherLanguages),
              sql`trim(${s.translations.value}) <> ''`,
              notDeleted(s.translations),
            ),
          ),
    loadTaxData(db, ctx),
  ]);

  const originsOf = new Map<string, { kind: string; country: string }[]>();
  for (const origin of origins) {
    originsOf.set(origin.productId, [...(originsOf.get(origin.productId) ?? []), origin]);
  }
  const routedIds = new Set(routed.map((r) => r.productId));
  const languagesOf = new Map<string, Set<string>>();
  for (const row of translated) {
    const set = languagesOf.get(row.productId) ?? new Set<string>();
    set.add(row.language);
    languagesOf.set(row.productId, set);
  }

  const today = localDate(location.timezone);
  const keyOf = new Map(tax.categories.map((c) => [c.id, c.key]));
  const categoriesInUse = [...new Set(products.map((p) => p.taxCategoryId))];
  const categoriesResolvable = categoriesInUse.filter((id) => {
    const key = keyOf.get(id);
    return key !== undefined && resolvesForAllConsumptionTypes(tax, key, today);
  }).length;

  return {
    location: {
      name: location.name,
      legalName: location.legalName,
      street: location.street,
      postalCode: location.postalCode,
      city: location.city,
      vatUid: location.vatUid,
      defaultLanguage: location.defaultLanguage,
      languages: location.languages,
    },
    activeAreas: value(areas),
    activeTables: value(tables),
    activePosTerminals: value(posTerminals),
    activeKitchenStations: value(stations),
    activeReceiptPrinters: value(receiptPrinters),
    managersWithPin: value(managers),
    tax: { categoriesInUse: categoriesInUse.length, categoriesResolvable },
    catalog: {
      activeProducts: products.length,
      unroutedProducts: products.filter((p) => !routedIds.has(p.id)).length,
      unpublishableProducts: products.filter(
        (p) =>
          !checkPublishable({
            allergensComplete: p.allergensComplete,
            requiresOrigin: p.requiresOrigin,
            origins: originsOf.get(p.id) ?? [],
          }).publishable,
      ).length,
      untranslatedProducts:
        otherLanguages.length === 0
          ? 0
          : products.filter((p) => otherLanguages.some((l) => !languagesOf.get(p.id)?.has(l)))
              .length,
    },
  };
}

async function checklistOf(
  db: Database,
  actor: Actor,
  location: LocationRow,
): Promise<SetupChecklistDto> {
  const checklist = computeSetupChecklist(await buildSetupSnapshot(db, actor, location));
  return {
    locationId: location.id,
    ...checklist,
    operationActivatedAt: iso(location.setupCompletedAt),
  };
}

/** What is still missing at the caller's location (RF-A11). */
export async function getSetupChecklist(
  deps: ServiceDeps,
  actor: Actor,
): Promise<SetupChecklistDto> {
  const location = await loadLocation(deps.db, actor, requireLocationId(actor));
  return checklistOf(deps.db, actor, location);
}

/**
 * Activates real operation at the caller's location (Flujo 7, step 4), only when every check is
 * done. Activating twice keeps the first activation time.
 */
export async function activateOperation(
  deps: ServiceDeps,
  actor: Actor,
): Promise<SetupChecklistDto> {
  assertPermission(actor, 'location.manage');
  const location = await loadLocation(deps.db, actor, requireLocationId(actor));
  const checklist = await checklistOf(deps.db, actor, location);
  if (!checklist.complete) {
    throw new ApiError('RULE_VIOLATION', 'The setup checklist is not complete', {
      rule: 'setup_incomplete',
      missing: checklist.checks.filter((check) => !check.done).map((check) => check.key),
    });
  }
  if (location.setupCompletedAt) return checklist;

  const activatedAt = new Date();
  await runCommand(
    deps.db,
    { ...commandContext(actor), locationId: location.id },
    async (tx, recorder) => {
      await tx
        .update(s.locations)
        .set({ setupCompletedAt: activatedAt })
        .where(inOrg(s.locations, actor, eq(s.locations.id, location.id)));
      recorder.audit({
        action: 'operation.activated',
        entityType: 'location',
        entityId: location.id,
        before: { setupCompletedAt: null },
        after: { setupCompletedAt: activatedAt.toISOString() },
      });
    },
  );
  return { ...checklist, operationActivatedAt: activatedAt.toISOString() };
}
