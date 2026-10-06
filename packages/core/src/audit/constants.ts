/**
 * Operaciones sensibles que siempre dejan un `AuditEvent` append-only (RF-F11, RF-B17).
 * Cada registro lleva usuario, autorizador, terminal, sede, hora, estado anterior y nuevo, y motivo.
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
