import { z } from 'zod';
import { PAYMENT_METHODS } from '../payments/constants';

/**
 * Closing the business day (Z, RF-D15, RF-D11): the day and, for every method paid through a
 * payment terminal, the total its own closing shows. A difference needs a reason.
 */
export const dayCloseSchema = z.object({
  businessDate: z.iso.date(),
  reconciliations: z
    .array(
      z.object({
        method: z.enum(PAYMENT_METHODS).exclude(['cash']),
        terminalTotalRappen: z.int().min(0).max(100_000_000),
        reason: z.string().trim().max(500).nullable().default(null),
      }),
    )
    .max(PAYMENT_METHODS.length)
    .refine(
      (list) => new Set(list.map((r) => r.method)).size === list.length,
      'One reconciliation per method',
    )
    .default([]),
});
export type DayCloseInput = z.input<typeof dayCloseSchema>;

export const businessDayQuerySchema = z.object({ businessDate: z.iso.date() });
