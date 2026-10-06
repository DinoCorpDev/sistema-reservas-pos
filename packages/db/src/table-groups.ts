import * as s from './schema';

/**
 * Classification of every table. The invariant tests (schema.test.ts) check that all tables are
 * classified and that each group follows its rules (multi-tenant, soft delete, sync, append-only).
 */
export const TABLE_GROUPS = {
  /** Multi-tenant root. */
  root: [s.organizations],
  /** Location configuration: FK, soft delete, required `location_id` (except `locations`). */
  config: [s.locations, s.areas, s.diningTables, s.terminals, s.kitchenStations, s.printers],
  /** Organization master data: FK, soft delete; `location_id` only when applicable. */
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
  /** Syncable daily operations: required org + location, no hard FKs, soft delete, version. */
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
  /** Insert-only; MySQL triggers reject UPDATE and DELETE (RN-10). */
  appendOnly: [s.auditEvents, s.receipts, s.dailyClosings],
  /** Infrastructure for events, sync and numbering. */
  infrastructure: [s.outboxEvents, s.syncOperations, s.orderNumberSequences],
} as const;

/** Append-only tables by SQL name, used by the triggers migration. */
export const APPEND_ONLY_TABLE_NAMES = ['audit_events', 'receipts', 'daily_closings'] as const;
