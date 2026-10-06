/**
 * MWST vocabulary (RF-B12, RN-02, RN-03).
 *
 * There are NO percentages here: rates and rules are data with a validity date that live in
 * the database (`tax_rates`, `tax_rules`) and are edited from the backoffice (RF-B13). The
 * calculation (Phase 1) receives that data as parameters.
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

/** A rate is expressed in basis points (1 bp = 0.01 %): 8.1 % = 810 bp. Always an integer. */
export type BasisPoints = number;
