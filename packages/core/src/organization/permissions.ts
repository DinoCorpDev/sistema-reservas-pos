/**
 * Roles and permissions (RF-A04, RF-A05, RNF-10).
 *
 * Permissions are fixed keys in the code; per-role assignments live in the database
 * (`role_permissions`) and can be adjusted per organization. Every check happens on the
 * server and in the domain, never only on screen.
 */
export const PERMISSIONS = [
  // orders
  'order.create',
  'order.void_item',
  'order.void',
  'order.discount',
  'order.reopen',
  'order.transfer',
  /** Work on any table's order when tables belong to their waiter (DEC-039). */
  'order.any_table',
  /** Hand a table to another waiter, e.g. at a change of shift (DEC-039). */
  'order.reassign',
  // payments and receipts
  'payment.take',
  'payment.refund',
  'receipt.reprint',
  // cash
  'cash.open_drawer',
  'cash.movement',
  'shift.open',
  'shift.close',
  'day.close',
  // kitchen and catalog
  'kitchen.operate',
  'catalog.sold_out',
  'catalog.manage',
  'catalog.price_change',
  'tax.manage',
  /** Raw materials, recipes and stock movements (DEC-051). */
  'inventory.manage',
  // floor, reservations and customers
  'reservation.checkin',
  'reservation.manage',
  'customer.manage',
  'customer.anonymize',
  // administration
  'location.manage',
  'user.manage',
  'report.view',
  'audit.view',
  'sync.resolve_conflicts',
  'support.grant_access',
  // approvals: authorize actions above the location thresholds with PIN (RN-15)
  'approval.grant',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_KEYS = ['admin', 'manager', 'cashier', 'waiter', 'kitchen'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** Default permissions of the predefined roles; the seed and organization setup copy them. */
export const DEFAULT_ROLE_PERMISSIONS: Readonly<Record<RoleKey, readonly Permission[]>> = {
  admin: PERMISSIONS,
  // The manager runs the restaurant like the owner and needs every module (DEC-050). The owner
  // can still narrow it per organization in the backoffice.
  manager: PERMISSIONS,
  cashier: [
    'order.create',
    'order.transfer',
    'order.any_table',
    'payment.take',
    'receipt.reprint',
    'cash.movement',
    'shift.open',
    'shift.close',
    'catalog.sold_out',
    'customer.manage',
  ],
  waiter: [
    'order.create',
    'order.void_item',
    'order.discount',
    'order.transfer',
    'payment.take',
    // Their own wallet when the location collects cash per person (DEC-038).
    'shift.open',
    'shift.close',
    'catalog.sold_out',
    'reservation.checkin',
    'customer.manage',
  ],
  kitchen: ['kitchen.operate', 'catalog.sold_out'],
};
