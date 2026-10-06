/**
 * The 14 allergens that must be declared in Switzerland and the EU (RF-B05).
 * Fixed reference data: the catalog stores the key and the UI translates it.
 */
export const ALLERGENS = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soy',
  'milk',
  'tree_nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const;
export type Allergen = (typeof ALLERGENS)[number];

/** Animal protein kinds whose origin (country) is mandatory (RF-B06, RN-18). */
export const ORIGIN_KINDS = ['meat', 'poultry', 'fish'] as const;
export type OriginKind = (typeof ORIGIN_KINDS)[number];

/** Catalog entities that have translations (RF-B07). */
export const TRANSLATABLE_ENTITIES = [
  'category',
  'product',
  'product_variant',
  'modifier_group',
  'modifier',
] as const;
export type TranslatableEntity = (typeof TRANSLATABLE_ENTITIES)[number];

export const TRANSLATABLE_FIELDS = ['name', 'description'] as const;
export type TranslatableField = (typeof TRANSLATABLE_FIELDS)[number];
