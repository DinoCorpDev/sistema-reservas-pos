import 'server-only';
import { locations } from '@pos/api';
import { asCurrency, type Currency } from '@pos/core';
import { cache } from 'react';
import { moneyOf } from '@/components/money';
import { currentActor, deps } from './actor';

/** The currency of the backoffice's current location (DEC-047), once per request. */
export const currentCurrency = cache(async (): Promise<Currency> => {
  const actor = await currentActor();
  if (!actor.locationId) return 'CHF';
  const location = await locations.getLocation(deps(), actor, actor.locationId);
  return asCurrency(location.currency);
});

/** Formatting for server components, in the current location's currency. */
export const currentMoney = async () => moneyOf(await currentCurrency());

/** `chf`-style formatter of the current location's currency, for server components. */
export async function currentFormatter(
  options: { symbol?: boolean } = {},
): Promise<(value: number) => string> {
  const money = await currentMoney();
  return (value) => money.format(value, options);
}
