import { char, index, mysqlTable, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import {
  locationId,
  organizationId,
  primaryId,
  rappen,
  syncColumns,
  timestamps,
  utcDatetime,
  uuid,
} from '../columns';

/**
 * Pago de una orden por un adaptador (PA-04). Lo cobrado = `amount + rounding + tip`.
 * Un pago completado no se modifica: si está mal, se devuelve y se registra otro (RN-14).
 * `idempotencyKey` impide duplicarlo al sincronizar (RNF-03).
 */
export const payments = mysqlTable(
  'payments',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    orderId: uuid('order_id').notNull(),
    shiftId: uuid('shift_id'),
    terminalId: uuid('terminal_id'),
    userId: uuid('user_id').notNull(),
    method: varchar('method', { length: 16 }).notNull(),
    adapter: varchar('adapter', { length: 32 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    currency: char('currency', { length: 3 }).notNull().default('CHF'),
    /** Parte de la venta que salda este pago. */
    amountRappen: rappen('amount_rappen'),
    /** Redondeo a 0,05 CHF en efectivo; nunca es descuento (RN-06). */
    roundingRappen: rappen('rounding_rappen'),
    /** Propina: fuera de la venta y sin MWST (RN-07). */
    tipRappen: rappen('tip_rappen'),
    tenderedRappen: rappen('tendered_rappen'),
    changeRappen: rappen('change_rappen'),
    /** Proveedor real detrás del adaptador (worldline, wallee, sumup, twint…). */
    provider: varchar('provider', { length: 32 }),
    externalReference: varchar('external_reference', { length: 128 }),
    /** Etiqueta de la parte cuando la cuenta se dividió (asiento 2, 1/3…) (RF-C12). */
    splitLabel: varchar('split_label', { length: 32 }),
    idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull(),
    completedAt: utcDatetime('completed_at'),
    failedAt: utcDatetime('failed_at'),
    failureReason: text('failure_reason'),
    ...syncColumns(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_payments_idempotency').on(t.organizationId, t.idempotencyKey),
    index('idx_payments_order').on(t.orderId),
    index('idx_payments_shift').on(t.shiftId),
  ],
);

/** Devolución ligada al pago original, con motivo y autorizador (RF-D07). */
export const refunds = mysqlTable(
  'refunds',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    paymentId: uuid('payment_id').notNull(),
    orderId: uuid('order_id').notNull(),
    shiftId: uuid('shift_id'),
    method: varchar('method', { length: 16 }).notNull(),
    adapter: varchar('adapter', { length: 32 }).notNull(),
    amountRappen: rappen('amount_rappen'),
    tipRappen: rappen('tip_rappen'),
    reason: text('reason').notNull(),
    userId: uuid('user_id').notNull(),
    authorizedByUserId: uuid('authorized_by_user_id'),
    externalReference: varchar('external_reference', { length: 128 }),
    idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull(),
    refundedAt: utcDatetime('refunded_at').notNull(),
    ...syncColumns(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_refunds_idempotency').on(t.organizationId, t.idempotencyKey),
    index('idx_refunds_payment').on(t.paymentId),
  ],
);

/** Propina asignada al mesero de la orden y reportada por persona (RF-D06, RF-F07). */
export const tips = mysqlTable(
  'tips',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    paymentId: uuid('payment_id').notNull(),
    orderId: uuid('order_id').notNull(),
    userId: uuid('user_id').notNull(),
    amountRappen: rappen('amount_rappen'),
    ...syncColumns(),
    ...timestamps(),
  },
  (t) => [index('idx_tips_user').on(t.locationId, t.userId)],
);
