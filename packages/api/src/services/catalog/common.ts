import {
  CONTENT_LANGUAGES,
  type ContentLanguage,
  type EventType,
  type TranslatableEntity,
  type TranslatableField,
} from '@pos/core';
import {
  type Database,
  type EventRecord,
  inOrg,
  notDeleted,
  ownedByOrg,
  schema as s,
  type Transaction,
} from '@pos/db';
import { eq, inArray } from 'drizzle-orm';
import type { Actor } from '../../actor';
import { ApiError, notFound } from '../../errors';

/** Shared pieces of the catalog use cases: tenant loaders, translations and set replacement. */

/** Reads are open to every actor; API keys need the `catalog:read` scope (RF-F14). */
export function assertCatalogRead(actor: Actor): void {
  if (actor.kind !== 'api_key') return;
  if (actor.scopes?.has('catalog:read') || actor.scopes?.has('catalog:write')) return;
  throw new ApiError('FORBIDDEN', 'This API key needs the catalog:read scope', {
    missing: ['catalog:read'],
  });
}

export async function loadProductRow(db: Database, actor: Actor, id: string) {
  const [row] = await db
    .select()
    .from(s.products)
    .where(inOrg(s.products, actor, eq(s.products.id, id), notDeleted(s.products)));
  if (!row) throw notFound('Product');
  return row;
}
export type ProductRow = Awaited<ReturnType<typeof loadProductRow>>;

export async function assertCategoryExists(db: Database, actor: Actor, id: string) {
  const [row] = await db
    .select({ id: s.categories.id })
    .from(s.categories)
    .where(inOrg(s.categories, actor, eq(s.categories.id, id), notDeleted(s.categories)));
  if (!row) throw notFound('Category');
}

export async function assertTaxCategoryExists(db: Database, actor: Actor, id: string) {
  const [row] = await db
    .select({ id: s.taxCategories.id })
    .from(s.taxCategories)
    .where(inOrg(s.taxCategories, actor, eq(s.taxCategories.id, id), notDeleted(s.taxCategories)));
  if (!row) throw notFound('Tax category');
}

/** Every id must be a location of the organization (404 otherwise, RNF-12). */
export async function assertLocationsExist(db: Database, actor: Actor, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return;
  const rows = await db
    .select({ id: s.locations.id })
    .from(s.locations)
    .where(inOrg(s.locations, actor, inArray(s.locations.id, wanted), notDeleted(s.locations)));
  if (rows.length !== wanted.length) throw notFound('Location');
}

/** The actor's current location (time zone and languages for the menu and the "86"). */
export async function loadActorLocation(db: Database, actor: Actor, locationId: string) {
  const [row] = await db
    .select()
    .from(s.locations)
    .where(inOrg(s.locations, actor, eq(s.locations.id, locationId), notDeleted(s.locations)));
  if (!row) throw notFound('Location');
  return row;
}

export const asContentLanguage = (value: string, fallback: ContentLanguage = 'de') =>
  (CONTENT_LANGUAGES as readonly string[]).includes(value) ? (value as ContentLanguage) : fallback;

/** `catalog.product_updated` event (PA-10); catalog-level unless a location is given. */
export function productUpdatedEvent(
  productId: string,
  changes: string[],
  locationId: string | null = null,
  extra: Record<string, unknown> = {},
): EventRecord {
  const type: EventType = 'catalog.product_updated';
  return {
    type,
    aggregateType: 'product',
    aggregateId: productId,
    payload: { productId, changes, ...extra },
    locationId,
  };
}

// ── Translations (RF-B07) ───────────────────────────────────────────────────

/** `{ fr: { name, description }, … }` as stored in `translations`. */
export type TranslationMap = Record<string, { name?: string; description?: string }>;

export async function loadTranslations(
  db: Database,
  actor: Actor,
  entityTypes: TranslatableEntity[],
  entityIds?: string[],
): Promise<Map<string, TranslationMap>> {
  const map = new Map<string, TranslationMap>();
  if (entityIds && entityIds.length === 0) return map;
  const rows = await db
    .select({
      entityId: s.translations.entityId,
      language: s.translations.language,
      field: s.translations.field,
      value: s.translations.value,
    })
    .from(s.translations)
    .where(
      inOrg(
        s.translations,
        actor,
        inArray(s.translations.entityType, entityTypes),
        entityIds ? inArray(s.translations.entityId, entityIds) : undefined,
        notDeleted(s.translations),
      ),
    );
  for (const row of rows) {
    const entry = map.get(row.entityId) ?? {};
    (entry[row.language] ??= {})[row.field as TranslatableField] = row.value;
    map.set(row.entityId, entry);
  }
  return map;
}

/** Name-only view of a translation map: `{ fr: 'Menu du jour' }`. */
export function labelsOf(map: TranslationMap | undefined): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [language, texts] of Object.entries(map ?? {})) {
    if (texts.name) labels[language] = texts.name;
  }
  return labels;
}

export interface DesiredTranslation {
  language: string;
  field: TranslatableField;
  value: string;
}

export function desiredTexts(
  input: Partial<Record<string, { name: string; description?: string | null }>>,
  fields: readonly TranslatableField[],
): DesiredTranslation[] {
  const desired: DesiredTranslation[] = [];
  for (const [language, texts] of Object.entries(input)) {
    for (const field of fields) {
      const value = texts?.[field]?.trim();
      if (value) desired.push({ language, field, value });
    }
  }
  return desired;
}

export const desiredLabels = (input: Partial<Record<string, string>>): DesiredTranslation[] =>
  desiredTexts(
    Object.fromEntries(
      Object.entries(input).map(([language, name]) => [language, { name: name ?? '' }]),
    ),
    ['name'],
  );

/** Replaces every translation of one entity (missing languages or fields are soft-deleted). */
export async function replaceTranslations(
  tx: Transaction,
  actor: Actor,
  entityType: TranslatableEntity,
  entityId: string,
  desired: DesiredTranslation[],
): Promise<boolean> {
  const rows = await tx
    .select()
    .from(s.translations)
    .where(
      inOrg(
        s.translations,
        actor,
        eq(s.translations.entityType, entityType),
        eq(s.translations.entityId, entityId),
      ),
    );
  const key = (t: { language: string; field: string }) => `${t.language}:${t.field}`;
  const plan = planReplace(rows, desired, key, key);
  for (const [row, item] of plan.update) {
    if (row.value === item.value && row.deletedAt === null) continue;
    await tx
      .update(s.translations)
      .set({ value: item.value, deletedAt: null })
      .where(inOrg(s.translations, actor, eq(s.translations.id, row.id)));
  }
  if (plan.insert.length > 0) {
    await tx
      .insert(s.translations)
      .values(plan.insert.map((item) => ownedByOrg(actor, { entityType, entityId, ...item })));
  }
  if (plan.remove.length > 0) {
    await tx
      .update(s.translations)
      .set({ deletedAt: new Date() })
      .where(
        inOrg(
          s.translations,
          actor,
          inArray(
            s.translations.id,
            plan.remove.map((row) => row.id),
          ),
        ),
      );
  }
  return (
    plan.insert.length > 0 ||
    plan.remove.length > 0 ||
    plan.update.some(([row, item]) => row.value !== item.value || row.deletedAt !== null)
  );
}

// ── Replacing a set of rows (PUT) ───────────────────────────────────────────

/**
 * Plan for replacing a collection: items matching an existing row by key update it (reviving a
 * soft-deleted row, which keeps unique indexes valid), the rest are inserted, and live rows that
 * are no longer wanted are soft-deleted (PA-06).
 */
export function planReplace<R extends { deletedAt: Date | null }, I>(
  rows: readonly R[],
  items: readonly I[],
  rowKey: (row: R) => string,
  itemKey: (item: I) => string | null,
) {
  const byKey = new Map<string, R>();
  // Live rows win over soft-deleted ones with the same key.
  for (const row of rows) {
    const existing = byKey.get(rowKey(row));
    if (!existing || (existing.deletedAt !== null && row.deletedAt === null))
      byKey.set(rowKey(row), row);
  }
  const kept = new Set<R>();
  const update: [R, I][] = [];
  const insert: I[] = [];
  for (const item of items) {
    const key = itemKey(item);
    const row = key === null ? undefined : byKey.get(key);
    if (row && !kept.has(row)) {
      kept.add(row);
      update.push([row, item]);
    } else {
      insert.push(item);
    }
  }
  const remove = rows.filter((row) => !kept.has(row) && row.deletedAt === null);
  return { update, insert, remove };
}
