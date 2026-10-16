import {
  asCurrency,
  cashRoundingStep,
  type CashRounding,
  type Currency,
  formatMoney,
  parseMoney,
  type Rappen,
  roundCash,
} from '@pos/core';
import { getPos } from '@/device/store';

/**
 * Money on the POS and the KDS (DEC-047): a device serves one location, so the currency is the
 * bootstrap's. Same shapes as `formatChf`, `parseChf` and `roundCashTo5`.
 */
export const posCurrency = (): Currency => asCurrency(getPos().bootstrap?.location.currency);

export function formatPosMoney(amount: Rappen, options: { currency?: boolean } = {}): string {
  return formatMoney(amount, posCurrency(), { symbol: options.currency ?? true });
}

export const parsePosMoney = (input: string): Rappen => parseMoney(input, posCurrency());

/** The cash rounding of the location's currency (RN-06): CHF 0.05 or $50. */
export const roundPosCash = (amount: Rappen): CashRounding =>
  roundCash(amount, cashRoundingStep(posCurrency()));

export const posRoundingStep = (): number => cashRoundingStep(posCurrency());

/** The location's tax name (`INC`, `IVA`) when it has one; null keeps the language's (DEC-047). */
export const posTaxName = (): string | null =>
  getPos().bootstrap?.location.settings.tax?.label ?? null;
