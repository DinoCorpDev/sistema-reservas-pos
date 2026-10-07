import {
  type DiscountKind,
  discountAmount,
  discountsOf,
  type FoldState,
  itemsOf,
  lineGross,
  MAX_COURSE,
  type MenuProduct,
  type Rappen,
  rappen,
} from '@pos/core';

/** Helpers of the order screens: display formats and the facts the approval rules need. */

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Whole minutes since an instant (RF-C19), or null when it never happened. */
export function minutesSince(iso: string | null, now: number): number | null {
  if (iso === null) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 60_000)) : null;
}

/**
 * Course a product goes with by default. Drinks are course 0 in the catalog (DEC-011: they go
 * out at once), but a line only accepts courses 1…9, so they travel with the first send.
 */
export const courseOf = (product: Pick<MenuProduct, 'defaultCourse'>) =>
  clamp(product.defaultCourse, 1, MAX_COURSE);

/** Table labels sorted the way people count: 2 before 10, T1 after 8. */
export const byLabel = (a: { label: string }, b: { label: string }) =>
  a.label.localeCompare(b.label, 'de', { numeric: true });

/** Basis points as a percentage for display: 1000 → "10 %", 1250 → "12.5 %". */
export function formatPercentBp(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const fraction = bp % 100;
  if (fraction === 0) return `${whole} %`;
  return `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')} %`;
}

const PERCENT_INPUT = /^(\d{1,3})(?:[.,](\d{1,2}))?$/;

/** A typed percentage ("10", "12.5", "7,25 %") in basis points, without floats; null if invalid. */
export function parsePercentBp(input: string): number | null {
  const match = PERCENT_INPUT.exec(input.trim().replace(/\s*%$/, ''));
  if (!match) return null;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bp >= 1 && bp <= 10_000 ? bp : null;
}

/**
 * Effective discount over its base in basis points, exactly as the engine checks it against the
 * location threshold (RN-15): an amount discount counts as the percentage it represents.
 */
export function effectivePercentBp(kind: DiscountKind, value: number, base: Rappen): number {
  const amount = discountAmount({ kind, value }, base);
  return base > 0 ? Math.ceil((amount * 10_000) / base) : 0;
}

/** Base of an order discount: the valid lines after their own line discounts. */
export function orderDiscountBase(fold: FoldState, orderId: string): Rappen {
  const lineDiscounts = new Map(
    discountsOf(fold, orderId)
      .filter((discount) => discount.removedAt === null && discount.itemId !== null)
      .map((discount) => [discount.itemId!, discount]),
  );
  let base = 0;
  for (const item of itemsOf(fold, orderId)) {
    if (item.prepStatus === 'voided') continue;
    const gross = lineGross(item);
    const discount = lineDiscounts.get(item.id);
    base += gross - (discount ? discountAmount(discount, gross) : 0);
  }
  return rappen(base);
}
