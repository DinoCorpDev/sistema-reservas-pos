/**
 * Core POS money (PA-08, RN-06).
 *
 * All amounts are integers in rappen (1 CHF = 100 Rp). Floats are never used for amounts:
 * the only division allowed here is the CHF 0.05 rounding, which returns to an integer at once.
 */

declare const rappenBrand: unique symbol;

/** Integer amount in rappen. Always build it with `rappen()` or `parseChf()`. */
export type Rappen = number & { readonly [rappenBrand]: true };

export class MoneyError extends Error {
  override readonly name = 'MoneyError';
}

export function rappen(value: number): Rappen {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`A Rappen amount must be a safe integer, got ${value}`);
  }
  return value as Rappen;
}

export const ZERO_RAPPEN: Rappen = rappen(0);

export function addRappen(...values: readonly Rappen[]): Rappen {
  return rappen(values.reduce<number>((sum, value) => sum + value, 0));
}

export function subtractRappen(minuend: Rappen, subtrahend: Rappen): Rappen {
  return rappen(minuend - subtrahend);
}

export function multiplyRappen(amount: Rappen, quantity: number): Rappen {
  if (!Number.isSafeInteger(quantity)) {
    throw new MoneyError(`Quantity must be an integer, got ${quantity}`);
  }
  return rappen(amount * quantity);
}

const CHF_INPUT = /^(-)?(\d{1,3}(?:'\d{3})+|\d+)(?:[.,](\d{1,2}))?$/;

/**
 * Converts a CHF string to rappen without going through float.
 * Accepts `12`, `12.5`, `12.50`, `12,50`, `1'234.50` and negatives. Rejects more than 2 decimals.
 */
export function parseChf(input: string): Rappen {
  const match = CHF_INPUT.exec(input.trim().replace(/^CHF\s*/i, ''));
  if (!match) {
    throw new MoneyError(`Invalid CHF amount: "${input}"`);
  }
  const [, sign, francsRaw = '0', centsRaw = ''] = match;
  const francs = Number(francsRaw.replaceAll("'", ''));
  const cents = Number(centsRaw.padEnd(2, '0'));
  const value = francs * 100 + cents;
  return rappen(sign ? -value : value);
}

/** Swiss format with an ASCII apostrophe as thousands separator: `CHF 1'234.50`. */
export function formatChf(amount: Rappen, options: { currency?: boolean } = {}): string {
  const { currency = true } = options;
  const negative = amount < 0;
  const absolute = Math.abs(amount);
  const francs = Math.trunc(absolute / 100);
  const cents = absolute % 100;
  const grouped = String(francs).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  const number = `${negative ? '-' : ''}${grouped}.${String(cents).padStart(2, '0')}`;
  return currency ? `CHF ${number}` : number;
}

export interface CashRounding {
  /** Total to collect in cash, a multiple of 5 Rp. */
  payable: Rappen;
  /** Difference `payable - amount`; recorded as rounding, never as a discount (RN-06). */
  rounding: Rappen;
}

/**
 * Swiss commercial rounding to CHF 0.05. Applied only to the total paid in cash (RN-06).
 * Remainders of 1-2 Rp round down, 3-4 Rp round up; symmetric for negative amounts (refunds).
 */
export function roundCashTo5(amount: Rappen): CashRounding {
  const magnitude = Math.abs(amount);
  const remainder = magnitude % 5;
  const roundedMagnitude = remainder <= 2 ? magnitude - remainder : magnitude + (5 - remainder);
  // `+ 0` normalizes -0 to 0 (e.g. -2 Rp rounds to 0, not -0).
  const payable = rappen((amount < 0 ? -roundedMagnitude : roundedMagnitude) + 0);
  return { payable, rounding: subtractRappen(payable, amount) };
}
