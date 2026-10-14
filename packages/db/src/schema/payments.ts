import { char, date, index, mysqlTable, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
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
 * Payment of an order through an adapter (PA-04). Amount charged = `amount + rounding + tip`.
 * A completed payment is never modified: if it is wrong, refund it and record another (RN-14).
 * `idempotencyKey` prevents duplicates during sync (RNF-03).
 */
export const payments = mysqlTable(
  'payments',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    orderId: uuid('order_id').notNull(),
    shiftId: uuid('shift_id'),
    /** The business day it counts for (the shift's, DEC-038): the Z it belongs to. */
    businessDate: date('business_date', { mode: 'string' }),
    terminalId: uuid('terminal_id'),
    userId: uuid('user_id').notNull(),
    method: varchar('method', { length: 16 }).notNull(),
    adapter: varchar('adapter', { length: 32 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    currency: char('currency', { length: 3 }).notNull().default('CHF'),
    /** Part of the sale settled by this payment. */
    amountRappen: rappen('amount_rappen'),
    /** Cash rounding to CHF 0.05; never a discount (RN-06). */
    roundingRappen: rappen('rounding_rappen'),
    /** Tip: outside the sale and without MWST (RN-07). */
    tipRappen: rappen('tip_rappen'),
    tenderedRappen: rappen('tendered_rappen'),
    changeRappen: rappen('change_rappen'),
    /** Actual provider behind the adapter (worldline, wallee, sumup, twint…). */
    provider: varchar('provider', { length: 32 }),
    externalReference: varchar('external_reference', { length: 128 }),
    /** Label of the part when the bill was split (seat 2, 1/3…) (RF-C12). */
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
    index('idx_payments_day').on(t.locationId, t.businessDate),
  ],
);

/** Refund linked to the original payment, with reason and authorizer (RF-D07). */
export const refunds = mysqlTable(
  'refunds',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    paymentId: uuid('payment_id').notNull(),
    orderId: uuid('order_id').notNull(),
    shiftId: uuid('shift_id'),
    businessDate: date('business_date', { mode: 'string' }),
    terminalId: uuid('terminal_id'),
    method: varchar('method', { length: 16 }).notNull(),
    adapter: varchar('adapter', { length: 32 }).notNull(),
    amountRappen: rappen('amount_rappen'),
    tipRappen: rappen('tip_rappen'),
    /** CHF 0.05 rounding of a cash refund (RN-06): paid out = amount + tip + rounding. */
    roundingRappen: rappen('rounding_rappen'),
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
    index('idx_refunds_shift').on(t.shiftId),
    index('idx_refunds_day').on(t.locationId, t.businessDate),
  ],
);

/** Tip assigned to the order's waiter and reported per person (RF-D06, RF-F07). */
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
