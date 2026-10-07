import {
  buildMenu,
  type Channel,
  type ConsumptionType,
  type ContentLanguage,
  type Menu,
  type MenuProduct,
  resolveTaxRate,
  type TaxCategoryKey,
  type TaxRateCode,
} from '@pos/core';
import { correctedNow } from './clock';
import { currentBusinessDate } from './numbers';
import { getPos } from './store';

/**
 * The menu and tax data on the device, from the offline snapshot (docs/SYNC.md §6.4): the same
 * `buildMenu()` the cloud uses, evaluated at the device's corrected time (RN-17 availability
 * windows keep working offline).
 */

const cache = new Map<string, { at: number; version: string; menu: Menu }>();
const MENU_TTL_MS = 30_000;

export function menuFor(channel: Channel, language?: ContentLanguage): Menu | null {
  const { bootstrap } = getPos();
  if (!bootstrap) return null;
  const key = `${channel}:${language ?? ''}`;
  const now = correctedNow();
  const hit = cache.get(key);
  if (hit && hit.version === bootstrap.configVersion && now - hit.at < MENU_TTL_MS) return hit.menu;
  const menu = buildMenu(bootstrap.catalog, { channel, language, at: new Date(now) });
  cache.set(key, { at: now, version: bootstrap.configVersion, menu });
  return menu;
}

export function findProduct(menu: Menu, productId: string): MenuProduct | undefined {
  for (const category of menu.categories) {
    const product = category.products.find((p) => p.id === productId);
    if (product) return product;
  }
  return undefined;
}

/** Tax rate per tax category for a consumption type today (RN-03, RN-05 channel change). */
export function ratesFor(consumptionType: ConsumptionType) {
  const { bootstrap } = getPos();
  if (!bootstrap) return [];
  const saleDate = currentBusinessDate();
  return bootstrap.tax.categories.flatMap((category) => {
    try {
      const rate = resolveTaxRate({
        taxCategoryKey: category.key,
        consumptionType,
        saleDate,
        rules: bootstrap.tax.rules,
        rates: bootstrap.tax.rates,
      });
      return [
        {
          taxCategoryKey: category.key as TaxCategoryKey,
          taxRateCode: rate.rateCode as TaxRateCode,
          taxRateBp: rate.rateBp,
        },
      ];
    } catch {
      return [];
    }
  });
}

/** Name of a catalog entity in a content language, for receipts (RF-D23, RF-B07). */
export function translatedName(
  entityId: string | null,
  fallback: string,
  language: ContentLanguage,
) {
  const { bootstrap } = getPos();
  if (!bootstrap || !entityId) return fallback;
  return bootstrap.catalog.translations[entityId]?.[language]?.name ?? fallback;
}
