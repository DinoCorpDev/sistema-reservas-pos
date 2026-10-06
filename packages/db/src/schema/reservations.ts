import {
  boolean,
  index,
  mysqlTable,
  smallint,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import {
  locationId,
  organizationId,
  primaryId,
  syncColumns,
  timestamps,
  utcDatetime,
  uuid,
} from '../columns';

/*
 * Operational tables: created on the device and synced. No hard FKs (sync can arrive
 * out of order); the domain validates integrity. See docs/ARQUITECTURA.md.
 */

/** Reservation linked to real Core tables (RF-E01, RF-E03). `externalRef` = id in Zitas. */
export const reservations = mysqlTable(
  'reservations',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    customerId: uuid('customer_id'),
    externalRef: varchar('external_ref', { length: 64 }),
    source: varchar('source', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    startsAt: utcDatetime('starts_at').notNull(),
    durationMinutes: smallint('duration_minutes').notNull().default(120),
    partySize: smallint('party_size').notNull(),
    areaId: uuid('area_id'),
    guestName: varchar('guest_name', { length: 200 }),
    guestPhone: varchar('guest_phone', { length: 20 }),
    notes: text('notes'),
    /** The manager holds it even after the no-show time has passed (RN-22). */
    heldByManager: boolean('held_by_manager').notNull().default(false),
    confirmedAt: utcDatetime('confirmed_at'),
    seatedAt: utcDatetime('seated_at'),
    completedAt: utcDatetime('completed_at'),
    noShowAt: utcDatetime('no_show_at'),
    cancelledAt: utcDatetime('cancelled_at'),
    ...syncColumns(),
    ...timestamps(),
  },
  (t) => [
    index('idx_reservations_location_starts').on(t.locationId, t.startsAt),
    uniqueIndex('uq_reservations_location_external').on(t.locationId, t.externalRef),
  ],
);

export const reservationTables = mysqlTable(
  'reservation_tables',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    reservationId: uuid('reservation_id').notNull(),
    tableId: uuid('table_id').notNull(),
    ...syncColumns(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_reservation_tables').on(t.reservationId, t.tableId)],
);

/** Actual visit to the restaurant, with or without a reservation (walk-in) (RF-E02, RF-E03). */
export const visits = mysqlTable(
  'visits',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    reservationId: uuid('reservation_id'),
    customerId: uuid('customer_id'),
    tableId: uuid('table_id'),
    waiterUserId: uuid('waiter_user_id'),
    partySize: smallint('party_size').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    startedAt: utcDatetime('started_at').notNull(),
    endedAt: utcDatetime('ended_at'),
    ...syncColumns(),
    ...timestamps(),
  },
  (t) => [index('idx_visits_location_customer').on(t.locationId, t.customerId)],
);
