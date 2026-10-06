import * as s from './schema';

/**
 * Clasificación de cada tabla. Los tests de invariantes (schema.test.ts) verifican que todas
 * estén clasificadas y que cada grupo cumpla sus reglas (multi-tenant, soft delete, sync, append-only).
 */
export const TABLE_GROUPS = {
  /** Raíz del multi-tenant. */
  root: [s.organizations],
  /** Configuración de la sede: FK, soft delete, `location_id` obligatorio (salvo `locations`). */
  config: [s.locations, s.areas, s.diningTables, s.terminals, s.kitchenStations, s.printers],
  /** Datos maestros de la organización: FK, soft delete; `location_id` solo si aplica. */
  master: [
    s.users,
    s.userLocations,
    s.roles,
    s.userRoles,
    s.rolePermissions,
    s.taxCategories,
    s.taxRates,
    s.taxRules,
    s.categories,
    s.products,
    s.productVariants,
    s.modifierGroups,
    s.modifiers,
    s.productModifierGroups,
    s.productAllergens,
    s.modifierAllergens,
    s.productOrigins,
    s.translations,
    s.availabilityRules,
    s.channelPrices,
    s.productLocationSettings,
    s.productStationRoutes,
    s.customers,
    s.consents,
  ],
  /** Operación diaria sincronizable: org + sede obligatorias, sin FK duras, soft delete, versión. */
  operational: [
    s.reservations,
    s.reservationTables,
    s.visits,
    s.orders,
    s.orderItems,
    s.orderItemModifiers,
    s.discounts,
    s.kitchenTickets,
    s.kitchenTicketItems,
    s.payments,
    s.refunds,
    s.tips,
    s.shifts,
    s.cashMovements,
    s.paymentReconciliations,
  ],
  /** Solo se agrega; triggers MySQL rechazan UPDATE y DELETE (RN-10). */
  appendOnly: [s.auditEvents, s.receipts, s.dailyClosings],
  /** Infraestructura de eventos, sincronización y numeración. */
  infrastructure: [s.outboxEvents, s.syncOperations, s.orderNumberSequences],
} as const;

/** Tablas append-only por nombre SQL, usadas por la migración de triggers. */
export const APPEND_ONLY_TABLE_NAMES = ['audit_events', 'receipts', 'daily_closings'] as const;
