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

/** Standard discount reasons; a location can add its own codes as presets (RF-C11). */
export const STANDARD_DISCOUNT_REASONS = ['staff', 'courtesy', 'promotion', 'other'] as const;

/** Mandatory reason when an item or an order is voided (RF-C10, RN-11). */
export const VOID_REASONS = [
  'entry_error',
  'guest_changed_mind',
  'kitchen_error',
  'quality',
  'not_available',
  'other',
] as const;
export type VoidReason = (typeof VOID_REASONS)[number];

/** Courses are numbered 0…9 (DEC-011): 0 = drinks (go at once), 1 = starters, 2 = mains… */
export const MIN_COURSE = 0;
export const MAX_COURSE = 9;
