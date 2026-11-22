import {
  char,
  index,
  mysqlTable,
  smallint,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { json, locationId, organizationId, primaryId, utcDatetime, uuid } from '../columns';

/**
 * Issued receipt with its content frozen exactly as printed (RF-D20, RN-08).
 * Each reprint is a new row with the same number and `copyNumber` > 0 (RF-D24, RN-09).
 * APPEND-ONLY: the migration installs triggers that reject UPDATE and DELETE (RN-10).
 */
export const receipts = mysqlTable(
  'receipts',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    orderId: uuid('order_id').notNull(),
    paymentId: uuid('payment_id'),
    receiptNumber: varchar('receipt_number', { length: 32 }).notNull(),
    /** 0 = original; 1, 2… = copies. */
    copyNumber: smallint('copy_number').notNull().default(0),
    language: char('language', { length: 2 }).notNull(),
    /** Receipt JSON exactly as issued. */
    content: json('content').$type<Record<string, unknown>>().notNull(),
    /** SHA-256 of the content, to detect tampering outside the application. */
    contentHash: char('content_hash', { length: 64 }).notNull(),
    customerName: varchar('customer_name', { length: 200 }),
    customerAddress: text('customer_address'),
    terminalId: uuid('terminal_id'),
    issuedByUserId: uuid('issued_by_user_id'),
    /** Device time at issue. */
    issuedAt: utcDatetime('issued_at').notNull(),
    createdAt: utcDatetime('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_receipts_number_copy').on(t.locationId, t.receiptNumber, t.copyNumber),
    index('idx_receipts_order').on(t.orderId),
  ],
);
