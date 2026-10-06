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
 * Tablas operativas: se crean en el dispositivo y se sincronizan. Sin FK duras (la sincronización
 * puede llegar fuera de orden); la integridad la valida el dominio. Ver docs/ARQUITECTURA.md.
 */

/** Reserva vinculada a mesas reales del Core (RF-E01, RF-E03). `externalRef` = id en Zitas. */
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
    /** El gerente la mantiene aunque pase el tiempo de no-show (RN-22). */
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

/** Visita real al restaurante, con o sin reserva (walk-in) (RF-E02, RF-E03). */
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
