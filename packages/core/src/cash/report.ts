import { z } from 'zod';
import { PAYMENT_METHODS } from '../payments/constants';
import { TAX_RATE_CODES } from '../tax/constants';
import { CASH_MOVEMENT_KINDS, SHIFT_SCOPES } from './constants';

const amount = z.int();
const nonNegative = z.int().min(0);
const count = z.int().min(0);

/**
 * The report of a shift (X while it runs, closing report at the end, RF-D15), frozen in
 * `shift.close` like a receipt (DEC-024): what was printed and signed is what stays. Every
 * amount in rappen; the sale part of payments and refunds is separate from tips and rounding.
 */
export const shiftReportSchema = z.object({
  version: z.literal(1),
  scope: z.enum(SHIFT_SCOPES),
  /** The person of a wallet, or the terminal of a till, as named when it closed. */
  ownerName: z.string().max(100),
  businessDate: z.iso.date(),
  openedAt: z.iso.datetime({ offset: true }),
  closedAt: z.iso.datetime({ offset: true }),
  timeZone: z.string().min(1).max(64),
  payments: z
    .array(
      z.object({
        method: z.enum(PAYMENT_METHODS),
        count,
        amountRappen: amount,
        tipRappen: amount,
        roundingRappen: amount,
        collectedRappen: amount,
      }),
    )
    .max(PAYMENT_METHODS.length),
  refunds: z
    .array(
      z.object({
        method: z.enum(PAYMENT_METHODS),
        count,
        amountRappen: amount,
        tipRappen: amount,
        roundingRappen: amount,
        paidOutRappen: amount,
      }),
    )
    .max(PAYMENT_METHODS.length),
  /** MWST of the sales net of refunds, per rate (RF-D15). */
  taxes: z
    .array(
      z.object({
        rateCode: z.enum(TAX_RATE_CODES),
        rateBp: z.int().min(0).max(10000),
        grossRappen: amount,
        taxRappen: amount,
        netRappen: amount,
      }),
    )
    .max(10),
  discountsRappen: nonNegative,
  discountCount: count,
  voidsRappen: nonNegative,
  voidCount: count,
  movements: z
    .array(z.object({ kind: z.enum(CASH_MOVEMENT_KINDS), count, amountRappen: amount }))
    .max(CASH_MOVEMENT_KINDS.length),
  cash: z.object({
    openingFloatRappen: nonNegative,
    /** Cash collected: sale + tip + rounding of the cash payments. */
    collectedRappen: amount,
    /** Cash paid back by refunds. */
    paidOutRappen: amount,
    /** Σ movements, signed. */
    movementsRappen: amount,
    expectedRappen: amount,
  }),
});
export type ShiftReport = z.infer<typeof shiftReportSchema>;
