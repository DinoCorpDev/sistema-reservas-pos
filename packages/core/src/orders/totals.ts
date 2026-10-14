import { type Rappen, rappen } from '../shared/money';
import { allocate, extractTax } from '../tax/calculation';
import type { OrderPaymentStatus } from './constants';
import {
  type DiscountState,
  discountsOf,
  type FoldState,
  itemsOf,
  type OrderItemState,
  type OrderState,
  paymentsOf,
  refundsOf,
} from './state';

/**
 * Money of an order, recalculated from the frozen inputs (RN-01, RN-04, RF-C11, DEC-016):
 * 1. line gross = (unit price + modifiers) × quantity;
 * 2. the item discount (percent or amount) comes off its line;
 * 3. the order discount is spread over the remaining lines with the largest-remainder method,
 *    so the shares add up exactly;
 * 4. MWST is extracted per line from what is left and rounded half up.
 */

/** Percentage of an amount in basis points, rounded half up (1000 bp of 12.35 = 1.24). */
export function percentOf(amount: Rappen, basisPoints: number): Rappen {
  const value = Math.trunc((Math.abs(amount) * basisPoints + 5000) / 10000);
  // `+ 0` turns -0 into 0.
  return rappen((amount < 0 ? -value : value) + 0);
}

/** Amount a discount takes off a base: a percentage, or a fixed amount capped at the base. */
export function discountAmount(
  discount: Pick<DiscountState, 'kind' | 'value'>,
  base: Rappen,
): Rappen {
  if (base <= 0) return rappen(0);
  return discount.kind === 'percent'
    ? percentOf(base, Math.min(discount.value, 10000))
    : rappen(Math.min(discount.value, base));
}

export function modifiersPerUnit(item: Pick<OrderItemState, 'modifiers'>): Rappen {
  return rappen(item.modifiers.reduce((sum, m) => sum + m.priceDeltaRappen * m.quantity, 0));
}

export function lineGross(
  item: Pick<OrderItemState, 'modifiers' | 'unitPriceRappen' | 'quantity'>,
) {
  return rappen(Math.max(0, (item.unitPriceRappen + modifiersPerUnit(item)) * item.quantity));
}

const isActive = (discount: DiscountState) => discount.removedAt === null;

/** Recalculates the lines, discounts and totals of one order in place. */
export function recalculateOrder(state: FoldState, order: OrderState): void {
  const items = itemsOf(state, order.id);
  const discounts = discountsOf(state, order.id).filter(isActive);
  const itemDiscountOf = new Map(
    discounts.filter((d) => d.itemId !== null).map((d) => [d.itemId!, d]),
  );
  const orderDiscount = discounts.find((d) => d.itemId === null) ?? null;

  const valid = items.filter((item) => item.prepStatus !== 'voided');
  const afterItemDiscount = new Map<string, Rappen>();
  for (const item of items) {
    item.modifiersRappen = modifiersPerUnit(item);
    item.grossRappen = lineGross(item);
    const itemDiscount = itemDiscountOf.get(item.id);
    const off =
      item.prepStatus === 'voided' || !itemDiscount
        ? rappen(0)
        : discountAmount(itemDiscount, item.grossRappen);
    if (itemDiscount) itemDiscount.amountRappen = off;
    afterItemDiscount.set(item.id, rappen(item.grossRappen - off));
    item.discountRappen = off;
  }
  // Discounts on items that are voided or left the order take nothing off.
  for (const discount of discounts) {
    if (discount.itemId === null) continue;
    const item = state.items.get(discount.itemId);
    if (!item || item.orderId !== order.id || item.prepStatus === 'voided') {
      discount.amountRappen = rappen(0);
    }
  }

  if (orderDiscount) {
    const weights = valid.map((item) => afterItemDiscount.get(item.id)!);
    const base = rappen(weights.reduce((sum, w) => sum + w, 0));
    const off = discountAmount(orderDiscount, base);
    orderDiscount.amountRappen = off;
    if (valid.length > 0 && off > 0) {
      const shares = allocate(off, weights);
      valid.forEach((item, index) => {
        item.discountRappen = rappen(item.discountRappen + shares[index]!);
      });
    }
  }

  let subtotal = 0;
  let discountTotal = 0;
  let tax = 0;
  for (const item of items) {
    item.lineTotalRappen = rappen(item.grossRappen - item.discountRappen);
    item.taxRappen = extractTax(item.lineTotalRappen, item.taxRateBp);
    if (item.prepStatus === 'voided') continue;
    subtotal += item.grossRappen;
    discountTotal += item.discountRappen;
    tax += item.taxRappen;
  }

  let paid = 0;
  let tips = 0;
  let rounding = 0;
  let paymentCount = 0;
  let refundCount = 0;
  for (const payment of paymentsOf(state, order.id)) {
    paymentCount += 1;
    paid += payment.amountRappen;
    tips += payment.tipRappen;
    rounding += payment.roundingRappen;
  }
  for (const refund of refundsOf(state, order.id)) {
    refundCount += 1;
    paid -= refund.amountRappen;
    tips -= refund.tipRappen;
    // The cash rounding of a refund (RN-06) nets out the rounding collected.
    rounding -= refund.roundingRappen;
  }

  order.subtotalRappen = rappen(subtotal);
  order.discountTotalRappen = rappen(discountTotal);
  order.totalRappen = rappen(subtotal - discountTotal);
  order.taxTotalRappen = rappen(tax);
  order.paidRappen = rappen(paid);
  order.tipTotalRappen = rappen(tips);
  order.roundingTotalRappen = rappen(rounding);
  order.balanceRappen = rappen(order.totalRappen - paid);
  order.paymentStatus = paymentStatusOf({
    totalRappen: order.totalRappen,
    paidRappen: order.paidRappen,
    paymentCount,
    refundCount,
    validItemCount: valid.length,
  });
}

/**
 * Payment status of an order (RF-C16), independent of the kitchen (PA-05). An order whose
 * valid items total zero (e.g. a 100 % courtesy) is paid without any payment.
 */
export function paymentStatusOf(input: {
  totalRappen: Rappen;
  paidRappen: Rappen;
  paymentCount: number;
  refundCount: number;
  validItemCount: number;
}): OrderPaymentStatus {
  const { totalRappen, paidRappen, paymentCount, refundCount, validItemCount } = input;
  if (paymentCount === 0) {
    return validItemCount > 0 && totalRappen <= 0 ? 'paid' : 'unpaid';
  }
  if (refundCount > 0 && paidRappen <= 0) return 'refunded';
  if (paidRappen >= totalRappen) return 'paid';
  return paidRappen > 0 ? 'partial' : 'unpaid';
}

/**
 * RN-12: an order closes by itself when it has at least one valid item, every valid item is
 * served and the payment is complete. An order without valid items is voided, never closed.
 */
export function isReadyToClose(state: FoldState, order: OrderState): boolean {
  if (order.status !== 'open') return false;
  let validItems = 0;
  for (const item of itemsOf(state, order.id)) {
    if (item.prepStatus === 'voided') continue;
    if (item.prepStatus !== 'served') return false;
    validItems += 1;
  }
  return validItems > 0 && order.paidRappen >= order.totalRappen;
}
