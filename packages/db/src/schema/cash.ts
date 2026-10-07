import {
  char,
  date,
  index,
  int,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
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

/** Cash count: denomination in rappen → number of pieces (RF-D14). */
export type DenominationCount = Record<string, number>;

/** Cash shift per terminal or per cashier; one open at a time (RF-D12, RN-19). */
export const shifts = mysqlTable(
  'shifts',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    terminalId: uuid('terminal_id'),
    cashierUserId: uuid('cashier_user_id'),
    businessDate: date('business_date', { mode: 'string' }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('open'),
    openedAt: utcDatetime('opened_at').notNull(),
    openedByUserId: uuid('opened_by_user_id').notNull(),
    openingFloatRappen: rappen('opening_float_rappen'),
    closedAt: utcDatetime('closed_at'),
    closedByUserId: uuid('closed_by_user_id'),
    expectedCashRappen: int('expected_cash_rappen'),
    countedCashRappen: int('counted_cash_rappen'),
    differenceRappen: int('difference_rappen'),
    countByDenomination: json('count_by_denomination').$type<DenominationCount>(),
    /** Required when there is a difference (RF-D14). */
    differenceComment: text('difference_comment'),
    ...syncColumns(),
    ...timestamps(),
  },
  (t) => [index('idx_shifts_location_status').on(t.locationId, t.status)],
);

/**
 * Cash movement: cash in, cash out, expense or correction (RF-D13). A correction made after a
 * closing references the affected closing and never edits it (RF-D17, RN-21).
 */
export const cashMovements = mysqlTable(
  'cash_movements',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    shiftId: uuid('shift_id'),
    kind: varchar('kind', { length: 16 }).notNull(),
    /** Signed: positive goes into the drawer, negative comes out. */
    amountRappen: rappen('amount_rappen'),
    reason: text('reason').notNull(),
    attachmentUrl: varchar('attachment_url', { length: 500 }),
    userId: uuid('user_id').notNull(),
    dailyClosingId: uuid('daily_closing_id'),
    occurredAt: utcDatetime('occurred_at').notNull(),
    ...syncColumns(),
    ...timestamps(),
  },
  (t) => [index('idx_cash_movements_shift').on(t.shiftId)],
);

/** Reconciliation of the POS total per method against the payment terminal closing (RF-D11). */
export const paymentReconciliations = mysqlTable(
  'payment_reconciliations',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    businessDate: date('business_date', { mode: 'string' }).notNull(),
    shiftId: uuid('shift_id'),
    method: varchar('method', { length: 16 }).notNull(),
    posTotalRappen: rappen('pos_total_rappen'),
    terminalTotalRappen: rappen('terminal_total_rappen'),
    differenceRappen: rappen('difference_rappen'),
    reason: text('reason'),
    userId: uuid('user_id').notNull(),
    reconciledAt: utcDatetime('reconciled_at').notNull(),
    ...syncColumns(),
    ...timestamps(),
  },
  (t) => [index('idx_payment_reconciliations_day').on(t.locationId, t.businessDate)],
);

/** Frozen totals of the Z closing (RF-D15). */
export interface DailyClosingTotals {
  grossSalesRappen: number;
  byPaymentMethod: Record<string, number>;
  byTaxRate: Record<string, { rateBp: number; grossRappen: number; taxRappen: number }>;
  tipsRappen: number;
  discountsRappen: number;
  voidsRappen: number;
  refundsRappen: number;
  roundingRappen: number;
  orderCount: number;
}

/**
 * Daily Z closing: immutable (RF-D17, RN-21). APPEND-ONLY: the migration installs triggers
 * that reject UPDATE and DELETE (RN-10).
 */
export const dailyClosings = mysqlTable(
  'daily_closings',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    businessDate: date('business_date', { mode: 'string' }).notNull(),
    closingNumber: int('closing_number').notNull(),
    totals: json('totals').$type<DailyClosingTotals>().notNull(),
    /** SHA-256 of the content, to detect tampering outside the application. */
    contentHash: char('content_hash', { length: 64 }).notNull(),
    closedByUserId: uuid('closed_by_user_id').notNull(),
    closedAt: utcDatetime('closed_at').notNull(),
    createdAt: utcDatetime('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_daily_closings_location_day').on(t.locationId, t.businessDate),
    uniqueIndex('uq_daily_closings_location_number').on(t.locationId, t.closingNumber),
  ],
);

/**
 * Counter for the short order number per location, day and prefix (RN-16). Numbers are never
 * reused; each node that numbers offline uses its own prefix.
 */
export const orderNumberSequences = mysqlTable(
  'order_number_sequences',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    businessDate: date('business_date', { mode: 'string' }).notNull(),
    prefix: varchar('prefix', { length: 4 }).notNull().default(''),
    lastNumber: int('last_number').notNull().default(0),
    updatedAt: utcDatetime('updated_at').notNull(),
  },
  (t) => [uniqueIndex('uq_order_number_sequences').on(t.locationId, t.businessDate, t.prefix)],
);

/**
 * Number handed out by the location's authority for an order (docs/SYNC.md §6.3). The id is the
 * order id, so asking twice for the same order returns the same number.
 */
export const orderNumberClaims = mysqlTable('order_number_claims', {
  id: uuid('id').primaryKey(),
  organizationId: organizationId(),
  locationId: locationId(),
  businessDate: date('business_date', { mode: 'string' }).notNull(),
  orderNumber: int('order_number').notNull(),
  createdAt: utcDatetime('created_at').notNull(),
});
