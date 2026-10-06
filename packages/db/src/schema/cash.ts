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

/** Conteo del arqueo: denominación en rappen → cantidad de piezas (RF-D14). */
export type DenominationCount = Record<string, number>;

/** Turno de caja por terminal o por cajero; uno abierto a la vez (RF-D12, RN-19). */
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
    /** Obligatorio si hay diferencia (RF-D14). */
    differenceComment: text('difference_comment'),
    ...syncColumns(),
    ...timestamps(),
  },
  (t) => [index('idx_shifts_location_status').on(t.locationId, t.status)],
);

/**
 * Movimiento de caja: ingreso, retiro, gasto o corrección (RF-D13). Una corrección posterior a un
 * cierre referencia el cierre afectado y nunca lo edita (RF-D17, RN-21).
 */
export const cashMovements = mysqlTable(
  'cash_movements',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    shiftId: uuid('shift_id'),
    kind: varchar('kind', { length: 16 }).notNull(),
    /** Con signo: positivo entra a la caja, negativo sale. */
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

/** Conciliación del total del POS por medio contra el cierre del terminal de pago (RF-D11). */
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

/** Totales congelados del cierre Z (RF-D15). */
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
 * Cierre Z del día: inalterable (RF-D17, RN-21). APPEND-ONLY: la migración instala triggers
 * que rechazan UPDATE y DELETE (RN-10).
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
    /** SHA-256 del contenido, para detectar alteraciones fuera de la aplicación. */
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
 * Contador del número corto de orden por sede, día y prefijo (RN-16). Los números nunca se
 * reutilizan; cada nodo que numera sin conexión usa su propio prefijo.
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
