/**
 * Vocabulario de MWST (RF-B12, RN-02, RN-03).
 *
 * Aquí NO hay porcentajes: las tasas y las reglas son datos con fecha de vigencia que viven en
 * la base (`tax_rates`, `tax_rules`) y se editan desde el backoffice (RF-B13). El cálculo
 * (Fase 1) recibe esos datos como parámetros.
 */
export const TAX_CATEGORY_KEYS = [
  'food',
  'non_alcoholic_beverage',
  'alcoholic_beverage',
  'accommodation',
  'other',
] as const;
export type TaxCategoryKey = (typeof TAX_CATEGORY_KEYS)[number];

export const TAX_RATE_CODES = ['normal', 'reduced', 'accommodation'] as const;
export type TaxRateCode = (typeof TAX_RATE_CODES)[number];

/** Una tasa se expresa en puntos básicos (1 bp = 0,01 %): 8,1 % = 810 bp. Siempre entero. */
export type BasisPoints = number;
