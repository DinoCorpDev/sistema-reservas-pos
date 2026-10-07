/**
 * Audit actions written by the Core (RF-F11, RF-B17, RF-A10). Every record stores user, approver,
 * terminal, location, time, before/after state and reason. This is the reference list for the
 * audit query filters; a new sensitive operation adds its action here.
 */
export const AUDIT_ACTIONS = [
  // orders, payments and cash (Phases 2 and 4)
  'order.item_voided',
  'order.voided',
  'order.discount_applied',
  'order.discount_removed',
  'order.reopened',
  'order.channel_changed',
  'order.items_transferred',
  'order.merged',
  'order.split',
  'payment.refunded',
  'receipt.reprinted',
  'cash.drawer_opened',
  'shift.closed',
  'day.closed',
  // catalog and tax
  'catalog.price_changed',
  'catalog.availability_changed',
  'catalog.product_updated',
  'tax.rule_changed',
  'tax.category_renamed',
  // organization, people and devices
  'organization.created',
  'location.updated',
  'location.settings_changed',
  'operation.activated',
  'user.created',
  'user.changed',
  'role.permissions_changed',
  'user.pin_changed',
  'user.password_changed',
  'user.two_factor_enabled',
  'user.two_factor_disabled',
  'terminal.created',
  'terminal.changed',
  'terminal.pairing_code_issued',
  'terminal.paired',
  'terminal.unlocked',
  'terminal.pin_failed',
  'approval.granted',
  'api_key.created',
  'api_key.revoked',
  'support.access_granted',
  'support.access_revoked',
  // customers (revDSG)
  'customer.created',
  'customer.updated',
  'customer.consent_recorded',
  'customer.exported',
  'customer.anonymized',
  // sync (Phase 2)
  'sync.conflict_resolved',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
