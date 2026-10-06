/**
 * Sensitive operations that always leave an append-only `AuditEvent` (RF-F11, RF-B17).
 * Each record stores user, authorizer, terminal, location, time, before/after state and reason.
 */
export const AUDIT_ACTIONS = [
  'order.item_voided',
  'order.voided',
  'order.discount_applied',
  'order.reopened',
  'order.channel_changed',
  'payment.refunded',
  'receipt.reprinted',
  'cash.drawer_opened',
  'shift.closed',
  'day.closed',
  'catalog.price_changed',
  'catalog.availability_changed',
  'catalog.product_updated',
  'tax.rule_changed',
  'user.changed',
  'support.access_started',
  'support.access_ended',
  'customer.anonymized',
  'sync.conflict_resolved',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
