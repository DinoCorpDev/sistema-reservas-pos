import {
  ALLERGENS,
  checkPublishable,
  type createProductSchema,
  isSoldOut,
  type listProductsQuerySchema,
  newId,
  type updateProductSchema,
} from '@pos/core';
import { inLocation, inOrg, notDeleted, ownedByOrg, runCommand, schema as s } from '@pos/db';
import { asc, eq, inArray, like, or } from 'drizzle-orm';
import type { z } from 'zod';
import { type Actor, assertPermission } from '../../actor';
import { ApiError } from '../../errors';
import { changedFields, definedOnly, iso, type ServiceDeps } from '../shared';
import {
  assertCatalogRead,
  assertCategoryExists,
  assertTaxCategoryExists,
  labelsOf,
  loadProductRow,
  loadTranslations,
  type ProductRow,
  productUpdatedEvent,
} from './common';

// ── DTOs ────────────────────────────────────────────────────────────────────

const toProductBase = (row: ProductRow) => ({
  id: row.id,
  categoryId: row.categoryId,
  taxCategoryId: row.taxCategoryId,
  sku: row.sku,
  name: row.name,
  description: row.description,
  basePriceRappen: row.basePriceRappen,
  defaultCourse: row.defaultCourse,
  imageUrl: row.imageUrl,
  requiresOrigin: row.requiresOrigin,
  allergensComplete: row.allergensComplete,
  publishQr: row.publishQr,
  publishWeb: row.publishWeb,
  sortOrder: row.sortOrder,
  isActive: row.isActive,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

type OriginLike = { kind: string; country: string };

/** RN-18: whether the product may appear on the QR menu and the web. */
const publicationOf = (row: ProductRow, origins: readonly OriginLike[]) => {
  const { publishable, issues } = checkPublishable({
    allergensComplete: row.allergensComplete,
    requiresOrigin: row.requiresOrigin,
    origins,
  });
  return { publishable, issues: [...issues] as string[] };
};

export type ProductSummaryDto = ReturnType<typeof toProductBase> & {
  publication: ReturnType<typeof publicationOf>;
};

const allergenOrder = (allergen: string) => (ALLERGENS as readonly string[]).indexOf(allergen);

type SettingRow = typeof s.productLocationSettings.$inferSelect;

export function toLocationSettingsDto(
  locationId: string,
  row: SettingRow | null,
  now = new Date(),
) {
  const live = row && row.deletedAt === null ? row : null;
  return {
    locationId,
    isActive: live?.isActive ?? true,
    priceRappen: live?.priceRappen ?? null,
    soldOutAt: iso(live?.soldOutAt),
    soldOutUntil: iso(live?.soldOutUntil),
    isSoldOut: isSoldOut(live, now),
  };
}

/** Full product aggregate as the backoffice edits it (RF-B01…RF-B11, RN-18). */
export async function buildProductDto(deps: ServiceDeps, actor: Actor, id: string) {
  const { db } = deps;
  const product = await loadProductRow(db, actor, id);
  const locationId = actor.locationId ?? null;
  const [variants, links, allergens, origins, rules, prices, settings, routes] = await Promise.all([
    db
      .select()
      .from(s.productVariants)
      .where(
        inOrg(
          s.productVariants,
          actor,
          eq(s.productVariants.productId, id),
          notDeleted(s.productVariants),
        ),
      )
      .orderBy(asc(s.productVariants.sortOrder)),
    db
      .select()
      .from(s.productModifierGroups)
      .where(
        inOrg(
          s.productModifierGroups,
          actor,
          eq(s.productModifierGroups.productId, id),
          notDeleted(s.productModifierGroups),
        ),
      )
      .orderBy(asc(s.productModifierGroups.sortOrder)),
    db
      .select()
      .from(s.productAllergens)
      .where(
        inOrg(
          s.productAllergens,
          actor,
          eq(s.productAllergens.productId, id),
          notDeleted(s.productAllergens),
        ),
      ),
    db
      .select()
      .from(s.productOrigins)
      .where(
        inOrg(
          s.productOrigins,
          actor,
          eq(s.productOrigins.productId, id),
          notDeleted(s.productOrigins),
        ),
      )
      .orderBy(asc(s.productOrigins.createdAt)),
    db
      .select()
      .from(s.availabilityRules)
      .where(
        inOrg(
          s.availabilityRules,
          actor,
          eq(s.availabilityRules.productId, id),
          notDeleted(s.availabilityRules),
        ),
      )
      .orderBy(asc(s.availabilityRules.createdAt)),
    db
      .select()
      .from(s.channelPrices)
      .where(
        inOrg(
          s.channelPrices,
          actor,
          eq(s.channelPrices.productId, id),
          notDeleted(s.channelPrices),
        ),
      )
      .orderBy(asc(s.channelPrices.channel)),
    locationId
      ? db
          .select()
          .from(s.productLocationSettings)
          .where(
            inLocation(
              s.productLocationSettings,
              actor,
              eq(s.productLocationSettings.productId, id),
              notDeleted(s.productLocationSettings),
            ),
          )
      : Promise.resolve([]),
    locationId
      ? db
          .select()
          .from(s.productStationRoutes)
          .where(
            inLocation(
              s.productStationRoutes,
              actor,
              eq(s.productStationRoutes.productId, id),
              notDeleted(s.productStationRoutes),
            ),
          )
      : Promise.resolve([]),
  ]);
  const translations = await loadTranslations(
    db,
    actor,
    ['product', 'product_variant'],
    [id, ...variants.map((v) => v.id)],
  );

  return {
    ...toProductBase(product),
    variants: variants.map((v) => ({
      id: v.id,
      name: v.name,
      priceRappen: v.priceRappen,
      isDefault: v.isDefault,
      sortOrder: v.sortOrder,
      isActive: v.isActive,
      translations: labelsOf(translations.get(v.id)),
    })),
    modifierGroupIds: links.map((l) => l.modifierGroupId),
    allergens: allergens
      .map((a) => ({ allergen: a.allergen, presence: a.presence }))
      .sort((a, b) => allergenOrder(a.allergen) - allergenOrder(b.allergen)),
    origins: origins.map((o) => ({
      id: o.id,
      kind: o.kind,
      species: o.species,
      country: o.country,
    })),
    translations: translations.get(id) ?? {},
    availability: rules.map((r) => ({
      id: r.id,
      locationId: r.locationId,
      channel: r.channel,
      daysOfWeek: r.daysOfWeek,
      startTime: r.startTime,
      endTime: r.endTime,
      validFrom: r.validFrom,
      validTo: r.validTo,
    })),
    channelPrices: prices.map((p) => ({
      id: p.id,
      channel: p.channel,
      locationId: p.locationId,
      variantId: p.variantId,
      priceRappen: p.priceRappen,
    })),
    locationSettings: locationId ? toLocationSettingsDto(locationId, settings[0] ?? null) : null,
    stationIds: routes.map((r) => r.kitchenStationId),
    publication: publicationOf(product, origins),
  };
}
export type ProductDto = Awaited<ReturnType<typeof buildProductDto>>;

// ── Queries ─────────────────────────────────────────────────────────────────

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

export async function listProducts(
  deps: ServiceDeps,
  actor: Actor,
  query: z.output<typeof listProductsQuerySchema>,
): Promise<ProductSummaryDto[]> {
  assertCatalogRead(actor);
  const pattern = query.search ? `%${escapeLike(query.search)}%` : null;
  const rows = await deps.db
    .select()
    .from(s.products)
    .where(
      inOrg(
        s.products,
        actor,
        notDeleted(s.products),
        query.categoryId ? eq(s.products.categoryId, query.categoryId) : undefined,
        query.includeInactive === 'true' ? undefined : eq(s.products.isActive, true),
        pattern ? or(like(s.products.name, pattern), like(s.products.sku, pattern)) : undefined,
      ),
    )
    .orderBy(asc(s.products.sortOrder), asc(s.products.name));
  if (rows.length === 0) return [];
  const origins = await deps.db
    .select({
      productId: s.productOrigins.productId,
      kind: s.productOrigins.kind,
      country: s.productOrigins.country,
    })
    .from(s.productOrigins)
    .where(
      inOrg(
        s.productOrigins,
        actor,
        inArray(
          s.productOrigins.productId,
          rows.map((r) => r.id),
        ),
        notDeleted(s.productOrigins),
      ),
    );
  return rows.map((row) => ({
    ...toProductBase(row),
    publication: publicationOf(
      row,
      origins.filter((o) => o.productId === row.id),
    ),
  }));
}

export async function getProduct(deps: ServiceDeps, actor: Actor, id: string): Promise<ProductDto> {
  assertCatalogRead(actor);
  return buildProductDto(deps, actor, id);
}

// ── Commands ────────────────────────────────────────────────────────────────

/** RN-18: publishing to QR or web is blocked while allergens or origin are missing. */
export function assertPublishable(product: {
  allergensComplete: boolean;
  requiresOrigin: boolean;
  origins: readonly OriginLike[];
}): void {
  const { publishable, issues } = checkPublishable(product);
  if (!publishable) {
    throw new ApiError(
      'RULE_VIOLATION',
      'The product cannot be published to the QR menu or the web: allergens or origin are missing',
      { rule: 'RN-18', issues },
    );
  }
}

export async function createProduct(
  deps: ServiceDeps,
  actor: Actor,
  input: z.output<typeof createProductSchema>,
): Promise<ProductDto> {
  assertPermission(actor, 'catalog.manage');
  await assertCategoryExists(deps.db, actor, input.categoryId);
  await assertTaxCategoryExists(deps.db, actor, input.taxCategoryId);
  if (input.publishQr || input.publishWeb) {
    assertPublishable({
      allergensComplete: false,
      requiresOrigin: input.requiresOrigin,
      origins: [],
    });
  }
  const id = newId();
  await runCommand(deps.db, actor, async (tx, recorder) => {
    await tx.insert(s.products).values(ownedByOrg(actor, { ...input, id }));
    recorder.event(productUpdatedEvent(id, ['created']));
  });
  return buildProductDto(deps, actor, id);
}

const PRICE_FIELDS = new Set(['basePriceRappen']);
const AVAILABILITY_FIELDS = new Set(['isActive']);

/** Splits a diff into the audit actions of RF-B17 (price, availability, everything else). */
function splitDiff(diff: { before: Record<string, unknown>; after: Record<string, unknown> }) {
  const pick = (keys: (key: string) => boolean) => {
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of Object.keys(diff.after).filter(keys)) {
      before[key] = diff.before[key];
      after[key] = diff.after[key];
    }
    return Object.keys(after).length > 0 ? { before, after } : null;
  };
  return {
    price: pick((k) => PRICE_FIELDS.has(k)),
    availability: pick((k) => AVAILABILITY_FIELDS.has(k)),
    other: pick((k) => !PRICE_FIELDS.has(k) && !AVAILABILITY_FIELDS.has(k)),
  };
}

export async function updateProduct(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: z.output<typeof updateProductSchema>,
): Promise<ProductDto> {
  assertPermission(actor, 'catalog.manage');
  const current = await loadProductRow(deps.db, actor, id);
  const patch = definedOnly(input);
  if (patch.basePriceRappen !== undefined && patch.basePriceRappen !== current.basePriceRappen) {
    assertPermission(actor, 'catalog.price_change');
  }
  if (patch.categoryId) await assertCategoryExists(deps.db, actor, patch.categoryId);
  if (patch.taxCategoryId) await assertTaxCategoryExists(deps.db, actor, patch.taxCategoryId);

  const publishing =
    (patch.publishQr && !current.publishQr) || (patch.publishWeb && !current.publishWeb);
  if (publishing) {
    const origins = await deps.db
      .select({ kind: s.productOrigins.kind, country: s.productOrigins.country })
      .from(s.productOrigins)
      .where(
        inOrg(
          s.productOrigins,
          actor,
          eq(s.productOrigins.productId, id),
          notDeleted(s.productOrigins),
        ),
      );
    assertPublishable({
      allergensComplete: current.allergensComplete,
      requiresOrigin: patch.requiresOrigin ?? current.requiresOrigin,
      origins,
    });
  }

  const diff = changedFields(current as unknown as Record<string, unknown>, patch);
  if (Object.keys(diff.after).length === 0) return buildProductDto(deps, actor, id);

  await runCommand(deps.db, actor, async (tx, recorder) => {
    await tx
      .update(s.products)
      .set(patch)
      .where(inOrg(s.products, actor, eq(s.products.id, id)));
    const { price, availability, other } = splitDiff(diff);
    const audit = { entityType: 'product', entityId: id, locationId: null };
    if (price) recorder.audit({ action: 'catalog.price_changed', ...audit, ...price });
    if (availability)
      recorder.audit({ action: 'catalog.availability_changed', ...audit, ...availability });
    if (other) recorder.audit({ action: 'catalog.product_updated', ...audit, ...other });
    recorder.event(productUpdatedEvent(id, Object.keys(diff.after)));
  });
  return buildProductDto(deps, actor, id);
}

/** Soft delete (PA-06): past orders keep pointing at the product. */
export async function deleteProduct(deps: ServiceDeps, actor: Actor, id: string): Promise<void> {
  assertPermission(actor, 'catalog.manage');
  const current = await loadProductRow(deps.db, actor, id);
  await runCommand(deps.db, actor, async (tx, recorder) => {
    await tx
      .update(s.products)
      .set({ deletedAt: new Date(), isActive: false })
      .where(inOrg(s.products, actor, eq(s.products.id, id)));
    recorder.audit({
      action: 'catalog.product_updated',
      entityType: 'product',
      entityId: id,
      locationId: null,
      before: { name: current.name, isActive: current.isActive },
      after: { deleted: true },
    });
    recorder.event(productUpdatedEvent(id, ['deleted']));
  });
}

const COPY_SUFFIX = ' (Kopie)';

/**
 * RF-B18: copies the product with its variants, allergens, origins, translations, modifier groups,
 * channel prices, availability and station routes. The copy starts inactive.
 */
export async function duplicateProduct(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
): Promise<ProductDto> {
  assertPermission(actor, 'catalog.manage');
  const { db } = deps;
  const source = await loadProductRow(db, actor, id);
  const byProduct = {
    variants: inOrg(
      s.productVariants,
      actor,
      eq(s.productVariants.productId, id),
      notDeleted(s.productVariants),
    ),
    links: inOrg(
      s.productModifierGroups,
      actor,
      eq(s.productModifierGroups.productId, id),
      notDeleted(s.productModifierGroups),
    ),
    allergens: inOrg(
      s.productAllergens,
      actor,
      eq(s.productAllergens.productId, id),
      notDeleted(s.productAllergens),
    ),
    origins: inOrg(
      s.productOrigins,
      actor,
      eq(s.productOrigins.productId, id),
      notDeleted(s.productOrigins),
    ),
    rules: inOrg(
      s.availabilityRules,
      actor,
      eq(s.availabilityRules.productId, id),
      notDeleted(s.availabilityRules),
    ),
    prices: inOrg(
      s.channelPrices,
      actor,
      eq(s.channelPrices.productId, id),
      notDeleted(s.channelPrices),
    ),
    routes: inOrg(
      s.productStationRoutes,
      actor,
      eq(s.productStationRoutes.productId, id),
      notDeleted(s.productStationRoutes),
    ),
  };
  const [variants, links, allergens, origins, rules, prices, routes] = await Promise.all([
    db.select().from(s.productVariants).where(byProduct.variants),
    db.select().from(s.productModifierGroups).where(byProduct.links),
    db.select().from(s.productAllergens).where(byProduct.allergens),
    db.select().from(s.productOrigins).where(byProduct.origins),
    db.select().from(s.availabilityRules).where(byProduct.rules),
    db.select().from(s.channelPrices).where(byProduct.prices),
    db.select().from(s.productStationRoutes).where(byProduct.routes),
  ]);
  const translations = await db
    .select()
    .from(s.translations)
    .where(
      inOrg(
        s.translations,
        actor,
        inArray(s.translations.entityId, [id, ...variants.map((v) => v.id)]),
        notDeleted(s.translations),
      ),
    );

  const copyId = newId();
  const variantIds = new Map(variants.map((v) => [v.id, newId()]));
  const productId = copyId;
  await runCommand(db, actor, async (tx, recorder) => {
    await tx.insert(s.products).values(
      ownedByOrg(actor, {
        id: copyId,
        categoryId: source.categoryId,
        taxCategoryId: source.taxCategoryId,
        sku: null,
        name: `${source.name.slice(0, 150 - COPY_SUFFIX.length)}${COPY_SUFFIX}`,
        description: source.description,
        basePriceRappen: source.basePriceRappen,
        defaultCourse: source.defaultCourse,
        imageUrl: source.imageUrl,
        requiresOrigin: source.requiresOrigin,
        allergensComplete: source.allergensComplete,
        publishQr: source.publishQr,
        publishWeb: source.publishWeb,
        sortOrder: source.sortOrder,
        isActive: false,
      }),
    );
    if (variants.length > 0) {
      await tx.insert(s.productVariants).values(
        variants.map((v) =>
          ownedByOrg(actor, {
            id: variantIds.get(v.id)!,
            productId,
            name: v.name,
            priceRappen: v.priceRappen,
            isDefault: v.isDefault,
            sortOrder: v.sortOrder,
            isActive: v.isActive,
          }),
        ),
      );
    }
    if (links.length > 0) {
      await tx.insert(s.productModifierGroups).values(
        links.map((l) =>
          ownedByOrg(actor, {
            productId,
            modifierGroupId: l.modifierGroupId,
            sortOrder: l.sortOrder,
          }),
        ),
      );
    }
    if (allergens.length > 0) {
      await tx
        .insert(s.productAllergens)
        .values(
          allergens.map((a) =>
            ownedByOrg(actor, { productId, allergen: a.allergen, presence: a.presence }),
          ),
        );
    }
    if (origins.length > 0) {
      await tx
        .insert(s.productOrigins)
        .values(
          origins.map((o) =>
            ownedByOrg(actor, { productId, kind: o.kind, species: o.species, country: o.country }),
          ),
        );
    }
    if (rules.length > 0) {
      await tx.insert(s.availabilityRules).values(
        rules.map((r) =>
          ownedByOrg(actor, {
            productId,
            locationId: r.locationId,
            categoryId: null,
            channel: r.channel,
            daysOfWeek: r.daysOfWeek,
            startTime: r.startTime,
            endTime: r.endTime,
            validFrom: r.validFrom,
            validTo: r.validTo,
          }),
        ),
      );
    }
    // Prices of removed variants are dropped with them.
    const copiedPrices = prices.filter((p) => p.variantId === null || variantIds.has(p.variantId));
    if (copiedPrices.length > 0) {
      await tx.insert(s.channelPrices).values(
        copiedPrices.map((p) =>
          ownedByOrg(actor, {
            productId,
            locationId: p.locationId,
            variantId: p.variantId === null ? null : variantIds.get(p.variantId)!,
            channel: p.channel,
            priceRappen: p.priceRappen,
          }),
        ),
      );
    }
    if (routes.length > 0) {
      await tx.insert(s.productStationRoutes).values(
        routes.map((r) =>
          ownedByOrg(actor, {
            productId,
            locationId: r.locationId,
            kitchenStationId: r.kitchenStationId,
          }),
        ),
      );
    }
    const copiedTexts = translations.filter((t) => t.entityId === id || variantIds.has(t.entityId));
    if (copiedTexts.length > 0) {
      await tx.insert(s.translations).values(
        copiedTexts.map((t) =>
          ownedByOrg(actor, {
            entityType: t.entityType,
            entityId: t.entityId === id ? copyId : variantIds.get(t.entityId)!,
            language: t.language,
            field: t.field,
            value: t.value,
          }),
        ),
      );
    }
    recorder.event(productUpdatedEvent(copyId, ['created'], null, { duplicatedFrom: id }));
  });
  return buildProductDto(deps, actor, copyId);
}
