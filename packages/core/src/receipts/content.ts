import { z } from 'zod';
import { PAYMENT_METHODS } from '../payments/constants';
import { CONTENT_LANGUAGES } from '../shared/languages';
import { TAX_RATE_CODES } from '../tax/constants';

const amount = z.int();
const text = (max: number) => z.string().max(max);

/**
 * Frozen content of a customer receipt (RF-D20, RN-08, DEC-024): exactly what was printed,
 * built on the device at payment time and stored as is. Labels are stored resolved in the
 * receipt language, so a copy prints the same words years later (RN-10).
 */
export const receiptContentSchema = z.object({
  version: z.literal(1),
  language: z.enum(CONTENT_LANGUAGES),
  labels: z.record(z.string(), z.string()),
  location: z.object({
    name: text(200),
    legalName: text(200).nullable(),
    street: text(200),
    postalCode: text(16),
    city: text(100),
    /** UID with the MWST/TVA/IVA suffix, e.g. "CHE-123.456.789 MWST". */
    vatNumber: text(40),
    header: text(500).nullable(),
    footer: text(500).nullable(),
  }),
  receiptNumber: text(32),
  orderNumber: text(12),
  tableLabel: text(40).nullable(),
  issuedAt: z.iso.datetime({ offset: true }),
  timeZone: text(64),
  servedBy: text(100).nullable(),
  lines: z
    .array(
      z.object({
        name: text(200),
        variantName: text(100).nullable(),
        quantity: z.int().min(1),
        unitPriceRappen: amount,
        modifiers: z.array(
          z.object({ name: text(100), priceDeltaRappen: amount, quantity: z.int().min(1) }),
        ),
        discountRappen: amount,
        totalRappen: amount,
        taxRateCode: z.enum(TAX_RATE_CODES),
        taxRateBp: z.int().min(0).max(10000),
      }),
    )
    .max(300),
  totals: z.object({ grossRappen: amount, discountRappen: amount, totalRappen: amount }),
  /** MWST per rate of what THIS payment covers (the whole order for a single full payment). */
  taxes: z.array(
    z.object({
      rateCode: z.enum(TAX_RATE_CODES),
      rateBp: z.int().min(0).max(10000),
      grossRappen: amount,
      taxRappen: amount,
      netRappen: amount,
    }),
  ),
  payment: z.object({
    method: z.enum(PAYMENT_METHODS),
    amountRappen: amount,
    tipRappen: amount,
    roundingRappen: amount,
    collectedRappen: amount,
    tenderedRappen: amount.nullable(),
    changeRappen: amount,
    splitLabel: text(32).nullable(),
  }),
  /** Present when the payment does not settle the whole order alone (RF-D02, RF-C12). */
  partial: z.object({ paidBeforeRappen: amount, balanceAfterRappen: amount }).nullable(),
  /** Mandatory from CHF 400 (RN-08, DEC-009); the address is optional (RF-D22). */
  customer: z.object({ name: text(200), address: text(500).nullable() }).nullable(),
});

export type ReceiptContent = z.infer<typeof receiptContentSchema>;
