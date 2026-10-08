import {
  char,
  index,
  int,
  mysqlTable,
  smallint,
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

/** Ticket sent to a station at a given moment: items, course, send time and status (RF-C20). */
export const kitchenTickets = mysqlTable(
  'kitchen_tickets',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    orderId: uuid('order_id').notNull(),
    kitchenStationId: uuid('kitchen_station_id').notNull(),
    course: smallint('course'),
    status: varchar('status', { length: 16 }).notNull().default('sent'),
    /** Kitchen language frozen at send time (RF-C25). */
    language: char('language', { length: 2 }).notNull(),
    sentAt: utcDatetime('sent_at').notNull(),
    preparingAt: utcDatetime('preparing_at'),
    readyAt: utcDatetime('ready_at'),
    servedAt: utcDatetime('served_at'),
    voidedAt: utcDatetime('voided_at'),
    printedAt: utcDatetime('printed_at'),
    printCount: int('print_count').notNull().default(0),
    sentByUserId: uuid('sent_by_user_id'),
    ...syncColumns(),
    ...timestamps(),
  },
  (t) => [
    index('idx_kitchen_tickets_station_status').on(t.locationId, t.kitchenStationId, t.status),
    index('idx_kitchen_tickets_order').on(t.orderId),
  ],
);

export const kitchenTicketItems = mysqlTable(
  'kitchen_ticket_items',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    kitchenTicketId: uuid('kitchen_ticket_id').notNull(),
    orderItemId: uuid('order_item_id').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('sent'),
    /** Times of the item at this station (DEC-029), for the kitchen reports. */
    preparingAt: utcDatetime('preparing_at'),
    readyAt: utcDatetime('ready_at'),
    ...syncColumns(),
    ...timestamps(),
  },
  (t) => [
    index('idx_kitchen_ticket_items_ticket').on(t.kitchenTicketId),
    uniqueIndex('uq_kitchen_ticket_items_item').on(t.kitchenTicketId, t.orderItemId),
  ],
);
