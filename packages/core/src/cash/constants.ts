import type { Currency } from '../shared/money';

/**
 * Who collects cash, as configured by the location (RF-D12, RN-19, DEC-038):
 * - `terminal`: only at the till; the shift belongs to the POS or handheld, phones take no cash;
 * - `cashier`: every person has their own wallet, a personal shift on any device;
 * - `mixed`: both at once; the till's shift on a POS or handheld, the waiter's wallet on a phone.
 */
export const SHIFT_MODES = ['terminal', 'cashier', 'mixed'] as const;
export type ShiftMode = (typeof SHIFT_MODES)[number];

/** Whose cash a shift is: a terminal's drawer or a person's wallet. */
export const SHIFT_SCOPES = ['terminal', 'personal'] as const;
export type ShiftScope = (typeof SHIFT_SCOPES)[number];

export const SHIFT_STATUSES = ['open', 'closed'] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

/** Cash movements (RF-D13). `correction` references a closing already done (RF-D17, RN-21). */
export const CASH_MOVEMENT_KINDS = ['cash_in', 'cash_out', 'expense', 'correction'] as const;
export type CashMovementKind = (typeof CASH_MOVEMENT_KINDS)[number];

/** CHF denominations in circulation, in rappen, for the cash count (RF-D14). */
export const CHF_DENOMINATIONS = [
  5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 100000,
] as const;
export type ChfDenomination = (typeof CHF_DENOMINATIONS)[number];

/**
 * COP denominations in circulation, in centavos (DEC-047): coins of $50 to $1.000, notes of
 * $2.000 to $100.000.
 */
export const COP_DENOMINATIONS = [
  5_000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000,
  10_000_000,
] as const;
export type CopDenomination = (typeof COP_DENOMINATIONS)[number];

/** The smallest banknote of each currency: below it, coins (for the count screen). */
export const FIRST_BANKNOTE: Readonly<Record<Currency, number>> = { CHF: 1_000, COP: 200_000 };

export function denominationsOf(currency: Currency): readonly number[] {
  return currency === 'COP' ? COP_DENOMINATIONS : CHF_DENOMINATIONS;
}
