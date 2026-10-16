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

/**
 * Currencies of the locations (DEC-047). Amounts are always integers in the minor unit
 * (ISO 4217, exponent 2): rappen for CHF, centavos for COP. Only display and cash rounding
 * depend on the currency.
 */
export const CURRENCIES = ['CHF', 'COP'] as const;
export type Currency = (typeof CURRENCIES)[number];

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);
}

/** The currency stored for a location; anything unknown is CHF, as before DEC-047. */
export const asCurrency = (value: unknown): Currency => (isCurrency(value) ? value : 'CHF');

const groupThousands = (value: number, separator: string) =>
  String(value).replace(/\B(?=(\d{3})+(?!\d))/g, separator);

/**
 * Colombian format: `$ 15.000`, dot as thousands separator; centavos with a comma only when
 * there are any (`$ 1.111,11`), as tax extraction may leave them.
 */
function formatCop(amount: number, symbol: boolean): string {
  const negative = amount < 0;
  const absolute = Math.abs(amount);
  const pesos = Math.trunc(absolute / 100);
  const centavos = absolute % 100;
  const number = `${negative ? '-' : ''}${groupThousands(pesos, '.')}${
    centavos === 0 ? '' : `,${String(centavos).padStart(2, '0')}`
  }`;
  return symbol ? `$ ${number}` : number;
}

/** An amount in its currency's local format, with the symbol by default. */
export function formatMoney(
  amount: Rappen,
  currency: Currency = 'CHF',
  options: { symbol?: boolean } = {},
): string {
  const symbol = options.symbol ?? true;
  return currency === 'COP' ? formatCop(amount, symbol) : formatChf(amount, { currency: symbol });
}

const COP_INPUT = /^(-)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

/**
 * Reads an amount typed in its currency's format, without going through float. COP: `15000`,
 * `15.000`, `15.000,50`, with or without `$`.
 */
export function parseMoney(input: string, currency: Currency = 'CHF'): Rappen {
  if (currency !== 'COP') return parseChf(input);
  const match = COP_INPUT.exec(input.trim().replace(/^(COP|\$)\s*/i, ''));
  if (!match) throw new MoneyError(`Invalid COP amount: "${input}"`);
  const [, sign, pesosRaw = '0', centavosRaw = ''] = match;
  const value = Number(pesosRaw.replaceAll('.', '')) * 100 + Number(centavosRaw.padEnd(2, '0'));
  return rappen(sign ? -value : value);
}

/**
 * Step of the cash rounding in minor units (RN-06, DEC-047): CHF 0.05, and $50 in pesos (the
 * smallest coin in circulation).
 */
export function cashRoundingStep(currency: Currency): number {
  return currency === 'COP' ? 5_000 : 5;
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
  return roundCash(amount, 5);
}

/**
 * Commercial rounding of a cash total to `step` minor units (RN-06, DEC-047): below half a step
 * rounds down, from half up; symmetric for negative amounts (refunds). With step 5 it is the
 * Swiss rule: 1-2 Rp down, 3-4 Rp up.
 */
export function roundCash(amount: Rappen, step: number): CashRounding {
  if (!Number.isSafeInteger(step) || step < 1) {
    throw new MoneyError(`The rounding step must be a positive integer, got ${step}`);
  }
  const magnitude = Math.abs(amount);
  const remainder = magnitude % step;
  const roundedMagnitude =
    remainder * 2 < step ? magnitude - remainder : magnitude + (step - remainder);
  // `+ 0` normalizes -0 to 0 (e.g. -2 Rp rounds to 0, not -0).
  const payable = rappen((amount < 0 ? -roundedMagnitude : roundedMagnitude) + 0);
  return { payable, rounding: subtractRappen(payable, amount) };
}
