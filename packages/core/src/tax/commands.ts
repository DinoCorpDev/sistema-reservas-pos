import { z } from 'zod';
import { CONSUMPTION_TYPES } from '../shared/channels';
import { TAX_RATE_CODES } from './constants';

/**
 * Input schemas of the MWST commands (RF-B12, RF-B13, RN-02), shared by the REST API and the
 * backoffice forms. Rates are data with a validity period: nothing here holds a percentage.
 */

/** Calendar date `YYYY-MM-DD` (validity periods are inclusive on both ends). */
const isoDate = z.iso.date();

const validity = {
  validFrom: isoDate,
  /** null = open-ended (the rate or rule in force until a newer one closes it). */
  validTo: isoDate.nullable().default(null),
  /**
   * Closes the currently open period of the same code (or category + consumption type) the day
   * before `validFrom`, so a new rate can be scheduled without overlapping the current one.
   */
  closePrevious: z.boolean().default(false),
};

const endNotBeforeStart = (value: { validFrom: string; validTo: string | null }) =>
  value.validTo === null || value.validTo >= value.validFrom;
const endNotBeforeStartIssue = { path: ['validTo'], message: 'validTo cannot be before validFrom' };

export const updateTaxCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export type UpdateTaxCategoryInput = z.infer<typeof updateTaxCategorySchema>;

export const createTaxRateSchema = z
  .object({
    code: z.enum(TAX_RATE_CODES),
    /** Basis points: 8.1 % = 810. */
    rateBp: z.int().min(0).max(10000),
    ...validity,
  })
  .refine(endNotBeforeStart, endNotBeforeStartIssue);
export type CreateTaxRateInput = z.output<typeof createTaxRateSchema>;

export const createTaxRuleSchema = z
  .object({
    taxCategoryId: z.uuid(),
    consumptionType: z.enum(CONSUMPTION_TYPES),
    rateCode: z.enum(TAX_RATE_CODES),
    ...validity,
  })
  .refine(endNotBeforeStart, endNotBeforeStartIssue);
export type CreateTaxRuleInput = z.output<typeof createTaxRuleSchema>;
