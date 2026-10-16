import { type Currency, formatMoney, parseMoney, type Rappen, rappen } from '@pos/core';

/**
 * Formatting and reading of amounts in one currency (DEC-047). Plain functions, so server
 * components (`@/server/currency`) and client components (`useMoney`) share them.
 */
export interface Money {
  currency: Currency;
  /** `CHF 12.50` / `$ 15.000`; `{ symbol: false }` for the number only. */
  format: (amount: Rappen | number, options?: { symbol?: boolean }) => string;
  /** Throws `MoneyError` on input that is not an amount in this currency. */
  parse: (input: string) => Rappen;
}

export function moneyOf(currency: Currency): Money {
  return {
    currency,
    format: (amount, options) => formatMoney(rappen(amount), currency, options),
    parse: (input) => parseMoney(input, currency),
  };
}
