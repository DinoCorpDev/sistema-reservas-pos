import {
  char,
  index,
  json,
  mysqlTable,
  smallint,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { locationId, organizationId, primaryId, utcDatetime, uuid } from '../columns';

/**
 * Recibo emitido con su contenido congelado tal como se imprimió (RF-D20, RN-08).
 * Cada reimpresión es una fila nueva con el mismo número y `copyNumber` > 0 (RF-D24, RN-09).
 * APPEND-ONLY: la migración instala triggers que rechazan UPDATE y DELETE (RN-10).
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
    /** 0 = original; 1, 2… = copias. */
    copyNumber: smallint('copy_number').notNull().default(0),
    language: char('language', { length: 2 }).notNull(),
    /** JSON del recibo exactamente como se emitió. */
    content: json('content').$type<Record<string, unknown>>().notNull(),
    /** SHA-256 del contenido, para detectar alteraciones fuera de la aplicación. */
    contentHash: char('content_hash', { length: 64 }).notNull(),
    customerName: varchar('customer_name', { length: 200 }),
    customerAddress: text('customer_address'),
    terminalId: uuid('terminal_id'),
    issuedByUserId: uuid('issued_by_user_id'),
    /** Hora del dispositivo al emitir. */
    issuedAt: utcDatetime('issued_at').notNull(),
    createdAt: utcDatetime('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_receipts_number_copy').on(t.locationId, t.receiptNumber, t.copyNumber),
    index('idx_receipts_order').on(t.orderId),
  ],
);
