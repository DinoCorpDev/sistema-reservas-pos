import {
  ALLERGENS,
  type AvailabilityRuleRecord,
  type Channel,
  type ChannelPriceRecord,
  checkOrderable,
  checkPublishable,
  CONTENT_LANGUAGES,
  type ContentLanguage,
  localMoment,
  type menuQuerySchema,
  rappen,
  resolvePrice,
  TRANSLATABLE_ENTITIES,
  translate,
} from '@pos/core';
import { inLocation, inOrg, notDeleted, schema as s } from '@pos/db';
import { asc, eq, isNull, or } from 'drizzle-orm';
import type { z } from 'zod';
import { type Actor, requireLocationId } from '../../actor';
import type { ServiceDeps } from '../shared';
import {
  asContentLanguage,
  assertCatalogRead,
  loadActorLocation,
  loadTranslations,
} from './common';

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(key(row));
    if (list) list.push(row);
    else map.set(key(row), [row]);
  }
  return map;
}

const allergenOrder = (allergen: string) => (ALLERGENS as readonly string[]).indexOf(allergen);
const allergenDtos = (rows: readonly { allergen: string; presence: string }[] = []) =>
  rows
    .map(({ allergen, presence }) => ({ allergen, presence }))
    .sort((a, b) => allergenOrder(a.allergen) - allergenOrder(b.allergen));

/**
 * The menu of the current location for one channel and language (RF-B15, RF-E06, RF-F14): one
 * catalog feeds POS, QR and web. Each product carries its resolved gross price per variant
 * (RF-B04), allergens and origin (RF-B05, RF-B06) and whether it can be ordered right now and why
 * not (RN-17). QR and web only show products that may be published (RN-18).
 */
export async function getMenu(
  deps: ServiceDeps,
  actor: Actor,
  query: z.output<typeof menuQuerySchema>,
) {
  assertCatalogRead(actor);
  const locationId = requireLocationId(actor);
  const { db } = deps;
  const location = await loadActorLocation(db, actor, locationId);
  const [organization] = await db
    .select({ defaultLanguage: s.organizations.defaultLanguage })
    .from(s.organizations)
    .where(eq(s.organizations.id, actor.organizationId));
  const locationLanguage = asContentLanguage(location.defaultLanguage);
  const catalogLanguage = asContentLanguage(organization?.defaultLanguage ?? 'de');
  const language: ContentLanguage = query.language ?? locationLanguage;
  const channel: Channel = query.channel;
  const at = query.at ? new Date(query.at) : new Date();
  const moment = localMoment(at, location.timezone);

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
    translations,
  ] = await Promise.all([
    db
      .select()
      .from(s.categories)
      .where(inOrg(s.categories, actor, eq(s.categories.isActive, true), notDeleted(s.categories)))
      .orderBy(asc(s.categories.sortOrder), asc(s.categories.name)),
    db
      .select()
      .from(s.products)
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
          eq(s.channelPrices.channel, channel),
          or(isNull(s.channelPrices.locationId), eq(s.channelPrices.locationId, locationId)),
          notDeleted(s.channelPrices),
        ),
      ),
    db
      .select()
      .from(s.productLocationSettings)
      .where(inLocation(s.productLocationSettings, actor, notDeleted(s.productLocationSettings))),
    loadTranslations(db, actor, [...TRANSLATABLE_ENTITIES]),
  ]);

  /** RF-B07: requested language → location language → catalog text (organization language). */
  const textOf = (id: string, field: 'name' | 'description', catalogText: string | null) => {
    const entry = translations.get(id) ?? {};
    const texts: Partial<Record<ContentLanguage, string>> = {};
    for (const lang of CONTENT_LANGUAGES) {
      const value = entry[lang]?.[field];
      if (value) texts[lang] = value;
    }
    if (catalogText && !texts[catalogLanguage]) texts[catalogLanguage] = catalogText;
    const value = translate(texts, catalogText ?? '', language, locationLanguage);
    return value === '' ? null : value;
  };
  const nameOf = (id: string, name: string) => textOf(id, 'name', name) ?? name;

  const variantsOf = groupBy(variants, (v) => v.productId);
  const allergensOf = groupBy(allergens, (a) => a.productId);
  const originsOf = groupBy(origins, (o) => o.productId);
  const linksOf = groupBy(links, (l) => l.productId);
  const modifiersOf = groupBy(modifiers, (m) => m.modifierGroupId);
  const modifierAllergensOf = groupBy(modifierAllergens, (a) => a.modifierId);
  const pricesOf = groupBy(prices, (p) => p.productId);
  const productRules = groupBy(
    rules.filter((r) => r.productId),
    (r) => r.productId!,
  );
  const categoryRules = groupBy(
    rules.filter((r) => r.categoryId),
    (r) => r.categoryId!,
  );
  const settingOf = new Map(settings.map((row) => [row.productId, row]));
  const groupById = new Map(groups.map((g) => [g.id, g]));

  const modifierGroupDto = (groupId: string) => {
    const group = groupById.get(groupId);
    if (!group) return [];
    return [
      {
        id: group.id,
        name: nameOf(group.id, group.name),
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        modifiers: (modifiersOf.get(group.id) ?? []).map((m) => ({
          id: m.id,
          name: nameOf(m.id, m.name),
          priceDeltaRappen: m.priceDeltaRappen,
          allergens: allergenDtos(modifierAllergensOf.get(m.id)),
        })),
      },
    ];
  };

  type ProductRow = (typeof products)[number];
  const isListed = (product: ProductRow) => {
    if (settingOf.get(product.id)?.isActive === false) return false;
    if (channel !== 'qr' && channel !== 'web') return true;
    if (!(channel === 'qr' ? product.publishQr : product.publishWeb)) return false;
    return checkPublishable({
      allergensComplete: product.allergensComplete,
      requiresOrigin: product.requiresOrigin,
      origins: originsOf.get(product.id) ?? [],
    }).publishable;
  };

  const productDto = (product: ProductRow) => {
    const setting = settingOf.get(product.id) ?? null;
    const channelPrices: ChannelPriceRecord[] = (pricesOf.get(product.id) ?? []).map((p) => ({
      channel: p.channel as Channel,
      locationId: p.locationId,
      variantId: p.variantId,
      priceRappen: rappen(p.priceRappen),
    }));
    const priceOf = (variant: { id: string; priceRappen: number } | null) =>
      resolvePrice({
        basePriceRappen: rappen(product.basePriceRappen),
        locationPriceRappen:
          setting && setting.priceRappen !== null ? rappen(setting.priceRappen) : null,
        variant: variant ? { id: variant.id, priceRappen: rappen(variant.priceRappen) } : null,
        channelPrices,
        channel,
        locationId,
      });
    const productVariants = variantsOf.get(product.id) ?? [];
    const defaultVariant = productVariants.find((v) => v.isDefault) ?? productVariants[0] ?? null;
    const availability: AvailabilityRuleRecord[] = [
      ...(productRules.get(product.id) ?? []),
      ...(categoryRules.get(product.categoryId) ?? []),
    ].map((r) => ({
      locationId: r.locationId,
      productId: r.productId,
      categoryId: r.categoryId,
      channel: r.channel as Channel | null,
      daysOfWeek: r.daysOfWeek,
      startTime: r.startTime,
      endTime: r.endTime,
      validFrom: r.validFrom,
      validTo: r.validTo,
    }));
    const orderability = checkOrderable({
      product: { id: product.id, categoryId: product.categoryId, isActive: product.isActive },
      locationSetting: setting,
      rules: availability,
      channel,
      locationId,
      at: moment,
    });
    return {
      id: product.id,
      categoryId: product.categoryId,
      taxCategoryId: product.taxCategoryId,
      sku: product.sku,
      name: nameOf(product.id, product.name),
      description: textOf(product.id, 'description', product.description),
      imageUrl: product.imageUrl,
      defaultCourse: product.defaultCourse,
      priceRappen: priceOf(defaultVariant),
      variants: productVariants.map((v) => ({
        id: v.id,
        name: nameOf(v.id, v.name),
        priceRappen: priceOf(v),
        isDefault: v.id === defaultVariant?.id,
      })),
      allergens: allergenDtos(allergensOf.get(product.id)),
      origins: (originsOf.get(product.id) ?? []).map((o) => ({
        kind: o.kind,
        species: o.species,
        country: o.country,
      })),
      modifierGroups: (linksOf.get(product.id) ?? []).flatMap((l) =>
        modifierGroupDto(l.modifierGroupId),
      ),
      orderable: orderability.orderable,
      reason: orderability.orderable ? null : orderability.reason,
    };
  };

  const productsOf = groupBy(products.filter(isListed), (p) => p.categoryId);
  return {
    locationId,
    channel,
    language,
    at: at.toISOString(),
    categories: categories
      .filter((category) => productsOf.has(category.id))
      .map((category) => ({
        id: category.id,
        parentId: category.parentId,
        name: nameOf(category.id, category.name),
        description: textOf(category.id, 'description', category.description),
        imageUrl: category.imageUrl,
        products: productsOf.get(category.id)!.map(productDto),
      })),
  };
}
export type MenuDto = Awaited<ReturnType<typeof getMenu>>;
