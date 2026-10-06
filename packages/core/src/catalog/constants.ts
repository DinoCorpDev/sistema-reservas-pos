/**
 * Los 14 alérgenos de declaración obligatoria en Suiza y la UE (RF-B05).
 * Son datos de referencia fijos: el catálogo guarda la clave y la UI la traduce.
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

/** Tipos de proteína animal cuyo origen (país) es obligatorio (RF-B06, RN-18). */
export const ORIGIN_KINDS = ['meat', 'poultry', 'fish'] as const;
export type OriginKind = (typeof ORIGIN_KINDS)[number];

/** Entidades del catálogo que tienen traducciones (RF-B07). */
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
