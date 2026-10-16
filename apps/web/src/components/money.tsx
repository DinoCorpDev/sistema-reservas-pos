'use client';

import type { Currency } from '@pos/core';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { type Money, moneyOf } from './money-format';

/**
 * The currency of the location on screen (DEC-047): CHF or COP. The backoffice layout provides
 * the current location's; client components format and read amounts with `useMoney()`.
 */
const CurrencyContext = createContext<Currency>('CHF');

export function MoneyProvider({ currency, children }: { currency: Currency; children: ReactNode }) {
  return <CurrencyContext.Provider value={currency}>{children}</CurrencyContext.Provider>;
}

export type { Money };

export function useMoney(): Money {
  const currency = useContext(CurrencyContext);
  return useMemo(() => moneyOf(currency), [currency]);
}
