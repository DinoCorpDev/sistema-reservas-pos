import type { Channel } from '../shared/channels';
import { CONTENT_LANGUAGES, type ContentLanguage } from '../shared/languages';
import { type Rappen, rappen } from '../shared/money';
import { localMoment } from '../shared/time';
import type { TaxCategoryKey } from '../tax/constants';
import { ALLERGENS } from './constants';
import {
  type AvailabilityRuleRecord,
  type ChannelPriceRecord,
  checkOrderable,
  checkPublishable,
  resolvePrice,
  translate,
  type UnavailableReason,
} from './rules';

/**
 * The menu of a location (RF-B15, RF-E06, RF-F14), built from a raw catalog snapshot. The same
 * function feeds the API (`GET /catalog/menu`) and the POS, which keeps the snapshot offline and
 * evaluates prices, availability and translations itself (docs/SYNC.md §6.4).
 */

type Texts = Partial<Record<ContentLanguage, { name?: string; description?: string }>>;

/** Raw, JSON-safe catalog data of one location: active rows, already sorted for display. */
export interface CatalogSnapshot {
  locationId: string;
  timeZone: string;
  locationLanguage: ContentLanguage;
  /** Language of the catalog texts (the organization's default language). */
  catalogLanguage: ContentLanguage;
  categories: {
    id: string;
    parentId: string | null;
    name: string;
    description: string | null;
    imageUrl: string | null;
  }[];
  products: {
    id: string;
    categoryId: string;
    taxCategoryId: string;
    taxCategoryKey: TaxCategoryKey;
    sku: string | null;
    name: string;
    description: string | null;
    imageUrl: string | null;
    defaultCourse: number;
    basePriceRappen: number;
    isActive: boolean;
    publishQr: boolean;
    publishWeb: boolean;
    allergensComplete: boolean;
    requiresOrigin: boolean;
  }[];
  variants: {
    id: string;
    productId: string;
    name: string;
    priceRappen: number;
    isDefault: boolean;
  }[];
  allergens: { productId: string; allergen: string; presence: string }[];
  origins: { productId: string; kind: string; species: string | null; country: string }[];
  productModifierGroups: { productId: string; modifierGroupId: string }[];
  modifierGroups: { id: string; name: string; minSelect: number; maxSelect: number }[];
  modifiers: { id: string; modifierGroupId: string; name: string; priceDeltaRappen: number }[];
  modifierAllergens: { modifierId: string; allergen: string; presence: string }[];
  availabilityRules: AvailabilityRuleRecord[];
  channelPrices: ({ productId: string } & Omit<ChannelPriceRecord, 'priceRappen'> & {
      priceRappen: number;
    })[];
  locationSettings: {
    productId: string;
    isActive: boolean;
    priceRappen: number | null;
    soldOutAt: string | null;
    soldOutUntil: string | null;
  }[];
  productStations: { productId: string; kitchenStationId: string }[];
  /** Translations by entity id (RF-B07). */
  translations: Record<string, Texts>;
}

export interface MenuModifier {
  id: string;
  name: string;
  priceDeltaRappen: Rappen;
  allergens: { allergen: string; presence: string }[];
}

export interface MenuModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: MenuModifier[];
}

export interface MenuProduct {
  id: string;
  categoryId: string;
  taxCategoryId: string;
  taxCategoryKey: TaxCategoryKey;
  sku: string | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  defaultCourse: number;
  priceRappen: Rappen;
  variants: { id: string; name: string; priceRappen: Rappen; isDefault: boolean }[];
  allergens: { allergen: string; presence: string }[];
  origins: { kind: string; species: string | null; country: string }[];
  modifierGroups: MenuModifierGroup[];
  stationIds: string[];
  orderable: boolean;
  reason: UnavailableReason | null;
}

export interface Menu {
  locationId: string;
  channel: Channel;
  language: ContentLanguage;
  at: string;
  categories: {
    id: string;
    parentId: string | null;
    name: string;
    description: string | null;
    imageUrl: string | null;
    products: MenuProduct[];
  }[];
}

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
const allergenList = (rows: readonly { allergen: string; presence: string }[] = []) =>
  rows
    .map(({ allergen, presence }) => ({ allergen, presence }))
    .sort((a, b) => allergenOrder(a.allergen) - allergenOrder(b.allergen));

const asDate = (value: string | null) => (value === null ? null : new Date(value));

/**
 * Builds the menu for one channel and language at one moment. Each product carries its gross
 * price per variant (RF-B04), allergens and origin (RF-B05, RF-B06), its kitchen stations and
 * whether it can be ordered right now and why not (RN-17). QR and web only list products that
 * may be published (RN-18).
 */
export function buildMenu(
  snapshot: CatalogSnapshot,
  options: { channel: Channel; language?: ContentLanguage; at: Date },
): Menu {
  const { channel, at } = options;
  const { locationId, locationLanguage, catalogLanguage } = snapshot;
  const language = options.language ?? locationLanguage;
  const moment = localMoment(at, snapshot.timeZone);

  /** RF-B07: requested language → location language → catalog text. */
  const textOf = (id: string, field: 'name' | 'description', catalogText: string | null) => {
    const entry = snapshot.translations[id] ?? {};
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

  const variantsOf = groupBy(snapshot.variants, (v) => v.productId);
  const allergensOf = groupBy(snapshot.allergens, (a) => a.productId);
  const originsOf = groupBy(snapshot.origins, (o) => o.productId);
  const linksOf = groupBy(snapshot.productModifierGroups, (l) => l.productId);
  const modifiersOf = groupBy(snapshot.modifiers, (m) => m.modifierGroupId);
  const modifierAllergensOf = groupBy(snapshot.modifierAllergens, (a) => a.modifierId);
  const pricesOf = groupBy(
    snapshot.channelPrices.filter((p) => p.channel === channel),
    (p) => p.productId,
  );
  const stationsOf = groupBy(snapshot.productStations, (s) => s.productId);
  const productRules = groupBy(
    snapshot.availabilityRules.filter((r) => r.productId),
    (r) => r.productId!,
  );
  const categoryRules = groupBy(
    snapshot.availabilityRules.filter((r) => r.categoryId),
    (r) => r.categoryId!,
  );
  const settingOf = new Map(snapshot.locationSettings.map((row) => [row.productId, row]));
  const groupById = new Map(snapshot.modifierGroups.map((g) => [g.id, g]));

  const modifierGroup = (groupId: string): MenuModifierGroup[] => {
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
          priceDeltaRappen: rappen(m.priceDeltaRappen),
          allergens: allergenList(modifierAllergensOf.get(m.id)),
        })),
      },
    ];
  };

  type ProductRow = CatalogSnapshot['products'][number];
  const isListed = (product: ProductRow) => {
    if (!product.isActive) return false;
    if (settingOf.get(product.id)?.isActive === false) return false;
    if (channel !== 'qr' && channel !== 'web') return true;
    if (!(channel === 'qr' ? product.publishQr : product.publishWeb)) return false;
    return checkPublishable({
      allergensComplete: product.allergensComplete,
      requiresOrigin: product.requiresOrigin,
      origins: originsOf.get(product.id) ?? [],
    }).publishable;
  };

  const menuProduct = (product: ProductRow): MenuProduct => {
    const setting = settingOf.get(product.id) ?? null;
    const channelPrices: ChannelPriceRecord[] = (pricesOf.get(product.id) ?? []).map((p) => ({
      channel: p.channel,
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
    const orderability = checkOrderable({
      product: { id: product.id, categoryId: product.categoryId, isActive: product.isActive },
      locationSetting: setting && {
        isActive: setting.isActive,
        soldOutAt: asDate(setting.soldOutAt),
        soldOutUntil: asDate(setting.soldOutUntil),
      },
      rules: [
        ...(productRules.get(product.id) ?? []),
        ...(categoryRules.get(product.categoryId) ?? []),
      ],
      channel,
      locationId,
      at: moment,
    });
    return {
      id: product.id,
      categoryId: product.categoryId,
      taxCategoryId: product.taxCategoryId,
      taxCategoryKey: product.taxCategoryKey,
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
      allergens: allergenList(allergensOf.get(product.id)),
      origins: (originsOf.get(product.id) ?? []).map((o) => ({
        kind: o.kind,
        species: o.species,
        country: o.country,
      })),
      modifierGroups: (linksOf.get(product.id) ?? []).flatMap((l) =>
        modifierGroup(l.modifierGroupId),
      ),
      stationIds: (stationsOf.get(product.id) ?? []).map((s) => s.kitchenStationId),
      orderable: orderability.orderable,
      reason: orderability.orderable ? null : orderability.reason,
    };
  };

  const productsOf = groupBy(snapshot.products.filter(isListed), (p) => p.categoryId);
  return {
    locationId,
    channel,
    language,
    at: at.toISOString(),
    categories: snapshot.categories
      .filter((category) => productsOf.has(category.id))
      .map((category) => ({
        id: category.id,
        parentId: category.parentId,
        name: nameOf(category.id, category.name),
        description: textOf(category.id, 'description', category.description),
        imageUrl: category.imageUrl,
        products: productsOf.get(category.id)!.map(menuProduct),
      })),
  };
}
