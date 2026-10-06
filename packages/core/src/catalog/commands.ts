import { z } from 'zod';
import { CHANNELS } from '../shared/channels';
import { CONTENT_LANGUAGES } from '../shared/languages';
import { ALLERGENS, ORIGIN_KINDS } from './constants';

/**
 * Input schemas of the catalog commands (RF-B01…RF-B18), shared by the REST API and the
 * backoffice forms. They only validate; references (category, stations…) are checked by the
 * use case against the tenant. Update schemas have no defaults: a PATCH only touches what it sends.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable();
/** Gross amount in rappen, MWST included (RN-01). */
const priceRappen = z.int().min(0).max(10_000_000);
const localTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Expected HH:MM or HH:MM:SS');
const uniqueBy = <T>(items: readonly T[], key: (item: T) => string) =>
  new Set(items.map(key)).size === items.length;
const uniqueIds = z
  .array(z.uuid())
  .refine((ids) => uniqueBy(ids, (id) => id), 'Duplicate ids');

export const ALLERGEN_PRESENCES = ['contains', 'may_contain'] as const;
export type AllergenPresence = (typeof ALLERGEN_PRESENCES)[number];

// ── Translations (RF-B07) ───────────────────────────────────────────────────

/** `{ fr: { name, description? }, it: …, en: …, de: … }`; a missing language is removed. */
export const textTranslationsSchema = z.partialRecord(
  z.enum(CONTENT_LANGUAGES),
  z.object({ name: text(150), description: optionalText(2000).optional() }),
);
export type TextTranslationsInput = z.infer<typeof textTranslationsSchema>;

/** Name-only translations (modifier groups). */
export const nameTranslationsSchema = z.partialRecord(
  z.enum(CONTENT_LANGUAGES),
  z.object({ name: text(150) }),
);

/** Short form for nested rows (variants, modifiers): `{ fr: 'Menu du jour' }`. */
export const labelTranslationsSchema = z.partialRecord(z.enum(CONTENT_LANGUAGES), text(150));

// ── Categories (RF-B02) ─────────────────────────────────────────────────────

const categoryFields = {
  name: text(150),
  description: optionalText(2000),
  parentId: z.uuid().nullable(),
  imageUrl: optionalText(500),
  sortOrder: z.int().min(0),
  isActive: z.boolean(),
};
export const createCategorySchema = z.object({
  ...categoryFields,
  description: categoryFields.description.default(null),
  parentId: categoryFields.parentId.default(null),
  imageUrl: categoryFields.imageUrl.default(null),
  sortOrder: categoryFields.sortOrder.default(0),
  isActive: categoryFields.isActive.default(true),
});
export const updateCategorySchema = z.object(categoryFields).partial();

// ── Products (RF-B01, RF-B04, RF-B06, RF-B11, RF-B12) ───────────────────────

const productFields = {
  categoryId: z.uuid(),
  taxCategoryId: z.uuid(),
  sku: z.string().trim().min(1).max(64).nullable(),
  name: text(150),
  description: optionalText(2000),
  basePriceRappen: priceRappen,
  /** 0 drinks, 1 starters, 2 mains, 3 desserts (RF-B11). */
  defaultCourse: z.int().min(0).max(9),
  imageUrl: optionalText(500),
  /** Contains meat, poultry or fish: origin required to publish (RN-18). */
  requiresOrigin: z.boolean(),
  publishQr: z.boolean(),
  publishWeb: z.boolean(),
  sortOrder: z.int().min(0),
  isActive: z.boolean(),
};
export const createProductSchema = z.object({
  ...productFields,
  sku: productFields.sku.default(null),
  description: productFields.description.default(null),
  defaultCourse: productFields.defaultCourse.default(1),
  imageUrl: productFields.imageUrl.default(null),
  requiresOrigin: productFields.requiresOrigin.default(false),
  // A new product has no confirmed allergens yet, so it starts unpublished (RN-18).
  publishQr: productFields.publishQr.default(false),
  publishWeb: productFields.publishWeb.default(false),
  sortOrder: productFields.sortOrder.default(0),
  isActive: productFields.isActive.default(true),
});
export const updateProductSchema = z.object(productFields).partial();

export const listProductsQuerySchema = z.object({
  categoryId: z.uuid().optional(),
  search: z.string().trim().max(100).optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
});

/** Variants with their own price (RF-B02). The set is replaced as a whole. */
export const productVariantInputSchema = z.object({
  id: z.uuid().optional(),
  name: text(100),
  priceRappen,
  isDefault: z.boolean().default(false),
  sortOrder: z.int().min(0).optional(),
  isActive: z.boolean().default(true),
  /** Omitted = keep the current translations. */
  translations: labelTranslationsSchema.optional(),
});
export const replaceVariantsSchema = z.object({
  variants: z
    .array(productVariantInputSchema)
    .max(50)
    .refine((v) => v.filter((variant) => variant.isDefault).length <= 1, 'Only one default variant')
    .refine((v) => uniqueBy(v.filter((x) => x.id), (x) => x.id!), 'Duplicate variant ids'),
});

export const allergenEntrySchema = z.object({
  allergen: z.enum(ALLERGENS),
  presence: z.enum(ALLERGEN_PRESENCES).default('contains'),
});
const allergenList = z
  .array(allergenEntrySchema)
  .max(ALLERGENS.length)
  .refine((list) => uniqueBy(list, (a) => a.allergen), 'Duplicate allergens');

/** The 14 allergens (RF-B05); `confirmed` = reviewed and complete, even if empty (RN-18). */
export const replaceAllergensSchema = z.object({ allergens: allergenList, confirmed: z.boolean() });

/** Origin of meat, poultry and fish (RF-B06). */
export const productOriginInputSchema = z.object({
  id: z.uuid().optional(),
  kind: z.enum(ORIGIN_KINDS),
  species: z.string().trim().min(1).max(64).nullable().default(null),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2 country code'),
});
export const replaceOriginsSchema = z.object({
  origins: z
    .array(productOriginInputSchema)
    .max(10)
    .refine((o) => uniqueBy(o.filter((x) => x.id), (x) => x.id!), 'Duplicate origin ids'),
});

/** Modifier groups of the product, in display order (RF-B02). */
export const replaceProductModifierGroupsSchema = z.object({ modifierGroupIds: uniqueIds.max(20) });

/** Availability by time slot, weekday and channel (RF-B08, RN-17). */
export const availabilityRuleInputSchema = z
  .object({
    id: z.uuid().optional(),
    /** null = every location of the organization. */
    locationId: z.uuid().nullable().default(null),
    /** null = every channel. */
    channel: z.enum(CHANNELS).nullable().default(null),
    /** Bitmask: Monday = 1 … Sunday = 64. */
    daysOfWeek: z.int().min(1).max(127).default(127),
    startTime: localTime.nullable().default(null),
    endTime: localTime.nullable().default(null),
    validFrom: z.iso.date().nullable().default(null),
    validTo: z.iso.date().nullable().default(null),
  })
  .refine((r) => (r.startTime === null) === (r.endTime === null), {
    message: 'Set both start and end time, or neither',
    path: ['endTime'],
  })
  .refine((r) => r.startTime === null || r.startTime.slice(0, 5) !== r.endTime?.slice(0, 5), {
    message: 'Start and end time must differ',
    path: ['endTime'],
  })
  .refine((r) => !r.validFrom || !r.validTo || r.validFrom <= r.validTo, {
    message: 'validFrom must not be after validTo',
    path: ['validTo'],
  });
export const replaceAvailabilitySchema = z.object({
  rules: z
    .array(availabilityRuleInputSchema)
    .max(20)
    .refine((r) => uniqueBy(r.filter((x) => x.id), (x) => x.id!), 'Duplicate rule ids'),
});

/** Price per channel, optionally per location and variant (RF-B04). */
export const channelPriceInputSchema = z.object({
  channel: z.enum(CHANNELS),
  locationId: z.uuid().nullable().default(null),
  variantId: z.uuid().nullable().default(null),
  priceRappen,
});
export const replaceChannelPricesSchema = z.object({
  prices: z
    .array(channelPriceInputSchema)
    .max(100)
    .refine(
      (p) => uniqueBy(p, (x) => `${x.channel}|${x.locationId}|${x.variantId}`),
      'One price per channel, location and variant',
    ),
});

/** Kitchen stations of the current location the product is routed to (RF-B11). */
export const replaceProductStationsSchema = z.object({ stationIds: uniqueIds.max(10) });

/** The product at the current location: active and own price (RF-B01). */
export const productLocationSettingsSchema = z.object({
  isActive: z.boolean(),
  /** null = the catalog price. */
  priceRappen: priceRappen.nullable(),
});

/** "86" (RF-B09): until a time, until the next business day (04:00 local) or until restored. */
export const markSoldOutSchema = z
  .object({
    until: z.iso.datetime({ offset: true }).nullable().optional(),
    nextBusinessDay: z.boolean().optional(),
  })
  .refine((v) => !(v.nextBusinessDay && v.until), {
    message: 'Send either until or nextBusinessDay',
    path: ['until'],
  });

// ── Modifier groups (RF-B02, RF-B05) ────────────────────────────────────────

const modifierGroupFields = {
  name: text(100),
  /** > 0 = mandatory group. */
  minSelect: z.int().min(0).max(20),
  maxSelect: z.int().min(1).max(20),
  sortOrder: z.int().min(0),
  isActive: z.boolean(),
};
export const createModifierGroupSchema = z
  .object({
    ...modifierGroupFields,
    minSelect: modifierGroupFields.minSelect.default(0),
    maxSelect: modifierGroupFields.maxSelect.default(1),
    sortOrder: modifierGroupFields.sortOrder.default(0),
    isActive: modifierGroupFields.isActive.default(true),
  })
  .refine((g) => g.minSelect <= g.maxSelect, {
    message: 'minSelect must not exceed maxSelect',
    path: ['minSelect'],
  });
export const updateModifierGroupSchema = z.object(modifierGroupFields).partial();

export const modifierInputSchema = z.object({
  id: z.uuid().optional(),
  name: text(100),
  priceDeltaRappen: priceRappen.default(0),
  sortOrder: z.int().min(0).optional(),
  isActive: z.boolean().default(true),
  allergens: allergenList.default([]),
  /** Omitted = keep the current translations. */
  translations: labelTranslationsSchema.optional(),
});
export const replaceModifiersSchema = z.object({
  modifiers: z
    .array(modifierInputSchema)
    .max(50)
    .refine((m) => uniqueBy(m.filter((x) => x.id), (x) => x.id!), 'Duplicate modifier ids'),
});

// ── Menu (RF-B15, RF-E06, RF-F14) ───────────────────────────────────────────

export const menuQuerySchema = z.object({
  channel: z.enum(CHANNELS).default('table'),
  /** Default: the location's language. */
  language: z.enum(CONTENT_LANGUAGES).optional(),
  /** Moment to evaluate availability at; default now. */
  at: z.iso.datetime({ offset: true }).optional(),
});
