/**
 * Roles y permisos (RF-A04, RF-A05, RNF-10).
 *
 * Los permisos son claves fijas del código; las asignaciones por rol viven en la base
 * (`role_permissions`) y se pueden ajustar por organización. Toda verificación ocurre en el
 * servidor y en el dominio, nunca solo en pantalla.
 */
export const PERMISSIONS = [
  // órdenes
  'order.create',
  'order.void_item',
  'order.void',
  'order.discount',
  'order.reopen',
  'order.transfer',
  // pagos y recibos
  'payment.take',
  'payment.refund',
  'receipt.reprint',
  // caja
  'cash.open_drawer',
  'cash.movement',
  'shift.open',
  'shift.close',
  'day.close',
  // cocina y catálogo
  'kitchen.operate',
  'catalog.sold_out',
  'catalog.manage',
  'catalog.price_change',
  'tax.manage',
  // sala, reservas y clientes
  'reservation.checkin',
  'reservation.manage',
  'customer.manage',
  'customer.anonymize',
  // administración
  'location.manage',
  'user.manage',
  'report.view',
  'audit.view',
  'sync.resolve_conflicts',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_KEYS = ['admin', 'manager', 'cashier', 'waiter', 'kitchen'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

const MANAGER_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter(
  (permission) =>
    ![
      'catalog.manage',
      'catalog.price_change',
      'tax.manage',
      'location.manage',
      'user.manage',
      'customer.anonymize',
    ].includes(permission),
);

/** Permisos por defecto de los roles predefinidos; el seed y el montaje de una organización los copian. */
export const DEFAULT_ROLE_PERMISSIONS: Readonly<Record<RoleKey, readonly Permission[]>> = {
  admin: PERMISSIONS,
  manager: MANAGER_PERMISSIONS,
  cashier: [
    'order.create',
    'order.transfer',
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
    'catalog.sold_out',
    'reservation.checkin',
    'customer.manage',
  ],
  kitchen: ['kitchen.operate', 'catalog.sold_out'],
};
