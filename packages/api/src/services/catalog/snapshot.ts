import {
  type AvailabilityRuleRecord,
  type CatalogSnapshot,
  type Channel,
  type TaxCategoryKey,
  TRANSLATABLE_ENTITIES,
} from '@pos/core';
import { type Database, inLocation, inOrg, notDeleted, schema as s } from '@pos/db';
import { asc, eq, isNull, or } from 'drizzle-orm';
import type { Actor } from '../../actor';
import { asContentLanguage, loadActorLocation, loadTranslations } from './common';

/**
 * Raw catalog of the actor's location (docs/SYNC.md §6.4): every active row the menu needs,
 * sorted for display, JSON-safe. `GET /catalog/menu` builds the menu from it with
 * `buildMenu()` of @pos/core, and the POS keeps it offline and does the same.
 */
export async function loadCatalogSnapshot(
  db: Database,
  actor: Actor,
  locationId: string,
): Promise<CatalogSnapshot> {
  const location = await loadActorLocation(db, actor, locationId);
  const [organization] = await db
    .select({ defaultLanguage: s.organizations.defaultLanguage })
    .from(s.organizations)
    .where(eq(s.organizations.id, actor.organizationId));
  const scoped = { ...actor, locationId };

  const [
    categories,
    products,
    variants,
    allergens,
    origins,
    links,
    groups,
    modifiers,
    modifierAllergens,
    rules,
    prices,
    settings,
    stations,
    translations,
  ] = await Promise.all([
    db
      .select()
      .from(s.categories)
      .where(inOrg(s.categories, actor, eq(s.categories.isActive, true), notDeleted(s.categories)))
      .orderBy(asc(s.categories.sortOrder), asc(s.categories.name)),
    db
      .select({ product: s.products, taxCategoryKey: s.taxCategories.key })
      .from(s.products)
      .innerJoin(s.taxCategories, eq(s.taxCategories.id, s.products.taxCategoryId))
      .where(inOrg(s.products, actor, eq(s.products.isActive, true), notDeleted(s.products)))
      .orderBy(asc(s.products.sortOrder), asc(s.products.name)),
    db
      .select()
      .from(s.productVariants)
      .where(
        inOrg(
          s.productVariants,
          actor,
          eq(s.productVariants.isActive, true),
          notDeleted(s.productVariants),
        ),
      )
      .orderBy(asc(s.productVariants.sortOrder)),
    db
      .select()
      .from(s.productAllergens)
      .where(inOrg(s.productAllergens, actor, notDeleted(s.productAllergens))),
    db
      .select()
      .from(s.productOrigins)
      .where(inOrg(s.productOrigins, actor, notDeleted(s.productOrigins)))
      .orderBy(asc(s.productOrigins.createdAt)),
    db
      .select()
      .from(s.productModifierGroups)
      .where(inOrg(s.productModifierGroups, actor, notDeleted(s.productModifierGroups)))
      .orderBy(asc(s.productModifierGroups.sortOrder)),
    db
      .select()
      .from(s.modifierGroups)
      .where(
        inOrg(
          s.modifierGroups,
          actor,
          eq(s.modifierGroups.isActive, true),
          notDeleted(s.modifierGroups),
        ),
      ),
    db
      .select()
      .from(s.modifiers)
      .where(inOrg(s.modifiers, actor, eq(s.modifiers.isActive, true), notDeleted(s.modifiers)))
      .orderBy(asc(s.modifiers.sortOrder), asc(s.modifiers.name)),
    db
      .select()
      .from(s.modifierAllergens)
      .where(inOrg(s.modifierAllergens, actor, notDeleted(s.modifierAllergens))),
    db
      .select()
      .from(s.availabilityRules)
      .where(
        inOrg(
          s.availabilityRules,
          actor,
          or(
            isNull(s.availabilityRules.locationId),
            eq(s.availabilityRules.locationId, locationId),
          ),
          notDeleted(s.availabilityRules),
        ),
      ),
    db
      .select()
      .from(s.channelPrices)
      .where(
        inOrg(
          s.channelPrices,
          actor,
          or(isNull(s.channelPrices.locationId), eq(s.channelPrices.locationId, locationId)),
          notDeleted(s.channelPrices),
        ),
      ),
    db
      .select()
      .from(s.productLocationSettings)
      .where(inLocation(s.productLocationSettings, scoped, notDeleted(s.productLocationSettings))),
    db
      .select()
      .from(s.productStationRoutes)
      .where(inLocation(s.productStationRoutes, scoped, notDeleted(s.productStationRoutes))),
    loadTranslations(db, actor, [...TRANSLATABLE_ENTITIES]),
  ]);

  return {
    locationId,
    timeZone: location.timezone,
    locationLanguage: asContentLanguage(location.defaultLanguage),
    catalogLanguage: asContentLanguage(organization?.defaultLanguage ?? 'de'),
    categories: categories.map((c) => ({
      id: c.id,
      parentId: c.parentId,
      name: c.name,
      description: c.description,
      imageUrl: c.imageUrl,
    })),
    products: products.map(({ product: p, taxCategoryKey }) => ({
      id: p.id,
      categoryId: p.categoryId,
      taxCategoryId: p.taxCategoryId,
      taxCategoryKey: taxCategoryKey as TaxCategoryKey,
      sku: p.sku,
      name: p.name,
      description: p.description,
      imageUrl: p.imageUrl,
      defaultCourse: p.defaultCourse,
      basePriceRappen: p.basePriceRappen,
      isActive: p.isActive,
      publishQr: p.publishQr,
      publishWeb: p.publishWeb,
      allergensComplete: p.allergensComplete,
      requiresOrigin: p.requiresOrigin,
    })),
    variants: variants.map((v) => ({
      id: v.id,
      productId: v.productId,
      name: v.name,
      priceRappen: v.priceRappen,
      isDefault: v.isDefault,
    })),
    allergens: allergens.map((a) => ({
      productId: a.productId,
      allergen: a.allergen,
      presence: a.presence,
    })),
    origins: origins.map((o) => ({
      productId: o.productId,
      kind: o.kind,
      species: o.species,
      country: o.country,
    })),
    productModifierGroups: links.map((l) => ({
      productId: l.productId,
      modifierGroupId: l.modifierGroupId,
    })),
    modifierGroups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
    })),
    modifiers: modifiers.map((m) => ({
      id: m.id,
      modifierGroupId: m.modifierGroupId,
      name: m.name,
      priceDeltaRappen: m.priceDeltaRappen,
    })),
    modifierAllergens: modifierAllergens.map((a) => ({
      modifierId: a.modifierId,
      allergen: a.allergen,
      presence: a.presence,
    })),
    availabilityRules: rules.map((r): AvailabilityRuleRecord => ({
      locationId: r.locationId,
      productId: r.productId,
      categoryId: r.categoryId,
      channel: r.channel as Channel | null,
      daysOfWeek: r.daysOfWeek,
      startTime: r.startTime,
      endTime: r.endTime,
      validFrom: r.validFrom,
      validTo: r.validTo,
    })),
    channelPrices: prices.map((p) => ({
      productId: p.productId,
      channel: p.channel as Channel,
      locationId: p.locationId,
      variantId: p.variantId,
      priceRappen: p.priceRappen,
    })),
    locationSettings: settings.map((row) => ({
      productId: row.productId,
      isActive: row.isActive,
      priceRappen: row.priceRappen,
      soldOutAt: row.soldOutAt?.toISOString() ?? null,
      soldOutUntil: row.soldOutUntil?.toISOString() ?? null,
    })),
    productStations: stations.map((row) => ({
      productId: row.productId,
      kitchenStationId: row.kitchenStationId,
    })),
    translations: Object.fromEntries(translations),
  };
}
