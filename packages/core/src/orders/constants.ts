/** Ciclo de vida de la orden (RF-C16, RN-12). */
export const ORDER_STATUSES = ['open', 'closed', 'voided'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Estado de preparación por ítem (PA-05). `voided` es alcanzable desde cualquier estado. */
export const ITEM_PREP_STATUSES = [
  'pending',
  'sent',
  'preparing',
  'ready',
  'served',
  'voided',
] as const;
export type ItemPrepStatus = (typeof ITEM_PREP_STATUSES)[number];

/** Estado de pago por orden, independiente de la preparación (PA-05). */
export const ORDER_PAYMENT_STATUSES = ['unpaid', 'partial', 'paid', 'refunded'] as const;
export type OrderPaymentStatus = (typeof ORDER_PAYMENT_STATUSES)[number];

/** Descuentos por ítem o por orden, en porcentaje (bp) o monto (Rp) (RF-C11). */
export const DISCOUNT_KINDS = ['percent', 'amount'] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];
