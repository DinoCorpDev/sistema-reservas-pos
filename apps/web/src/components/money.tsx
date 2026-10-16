'use client';

import { type Currency, formatMoney, parseMoney, type Rappen, rappen } from '@pos/core';
import { createContext, type ReactNode, useContext, useMemo } from 'react';

/**
 * The currency of the location on screen (DEC-047): CHF or COP. The backoffice layout provides
 * the current location's; components format and read amounts with `useMoney()`.
 */
const CurrencyContext = createContext<Currency>('CHF');

export function MoneyProvider({ currency, children }: { currency: Currency; children: ReactNode }) {
  return <CurrencyContext.Provider value={currency}>{children}</CurrencyContext.Provider>;
}

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

export function useMoney(): Money {
  const currency = useContext(CurrencyContext);
  return useMemo(() => moneyOf(currency), [currency]);
}
