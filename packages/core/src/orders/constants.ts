/** Order lifecycle (RF-C16, RN-12). */
export const ORDER_STATUSES = ['open', 'closed', 'voided'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Preparation status per item (PA-05). `voided` is reachable from any status. */
export const ITEM_PREP_STATUSES = [
  'pending',
  'sent',
  'preparing',
  'ready',
  'served',
  'voided',
] as const;
export type ItemPrepStatus = (typeof ITEM_PREP_STATUSES)[number];

/** Payment status per order, independent of preparation (PA-05). */
export const ORDER_PAYMENT_STATUSES = ['unpaid', 'partial', 'paid', 'refunded'] as const;
export type OrderPaymentStatus = (typeof ORDER_PAYMENT_STATUSES)[number];

/** Discounts per item or per order, as a percentage (bp) or an amount (Rp) (RF-C11). */
export const DISCOUNT_KINDS = ['percent', 'amount'] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];
