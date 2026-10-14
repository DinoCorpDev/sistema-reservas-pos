import type { OrderAllergies } from '@pos/core';
import {
  date,
  index,
  int,
  json,
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
  rappen,
  syncColumns,
  timestamps,
  utcDatetime,
  uuid,
} from '../columns';

/**
 * Order: a bill with two independent statuses, preparation per item and payment per order
 * (PA-05, RF-C16). Short readable number per location and day besides the UUID (RF-C15, RN-16).
 */
export const orders = mysqlTable(
  'orders',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    terminalId: uuid('terminal_id'),
    businessDate: date('business_date', { mode: 'string' }).notNull(),
    orderNumber: int('order_number').notNull(),
    /** Terminal prefix when it numbered offline (RN-16); empty if the hub or cloud numbered it. */
    orderNumberPrefix: varchar('order_number_prefix', { length: 4 }).notNull().default(''),
    /** Number called out loud and printed: `0042` or `H1-0042`. */
    displayNumber: varchar('display_number', { length: 12 }).notNull(),
    channel: varchar('channel', { length: 16 }).notNull(),
    consumptionType: varchar('consumption_type', { length: 16 }).notNull(),
    tableId: uuid('table_id'),
    /** Tables joined to `table_id` for this order (RF-C03). */
    joinedTableIds: json('joined_table_ids').$type<string[]>(),
    visitId: uuid('visit_id'),
    customerId: uuid('customer_id'),
    waiterUserId: uuid('waiter_user_id'),
    guestCount: smallint('guest_count'),
    status: varchar('status', { length: 16 }).notNull().default('open'),
    paymentStatus: varchar('payment_status', { length: 16 }).notNull().default('unpaid'),
    /** Takeaway pickup time (RF-E11). */
    pickupAt: utcDatetime('pickup_at'),
    customerName: varchar('customer_name', { length: 200 }),
    note: text('note'),
    /** A guest's allergies, warned on every kitchen ticket of the order (DEC-037). */
    allergies: json('allergies').$type<OrderAllergies>(),
    /** Totals in rappen, MWST included. The tip is separate and is not a sale (RN-07). */
    subtotalRappen: rappen('subtotal_rappen'),
    discountTotalRappen: rappen('discount_total_rappen'),
    totalRappen: rappen('total_rappen'),
    taxTotalRappen: rappen('tax_total_rappen'),
    paidTotalRappen: rappen('paid_total_rappen'),
    tipTotalRappen: rappen('tip_total_rappen'),
    openedAt: utcDatetime('opened_at').notNull(),
    closedAt: utcDatetime('closed_at'),
    voidedAt: utcDatetime('voided_at'),
    voidReason: text('void_reason'),
    reopenedAt: utcDatetime('reopened_at'),
    mergedIntoOrderId: uuid('merged_into_order_id'),
    splitFromOrderId: uuid('split_from_order_id'),
    createdByUserId: uuid('created_by_user_id'),
    ...syncColumns(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_orders_location_day_number').on(t.locationId, t.businessDate, t.displayNumber),
    index('idx_orders_location_status').on(t.locationId, t.status),
    index('idx_orders_location_table').on(t.locationId, t.tableId),
  ],
);

/**
 * Order line. Price, rate and tax are frozen at sale time (RN-04): a later change of rates
 * or prices does not recalculate it. Voiding marks the line, never deletes it (RF-C10, RN-11).
 */
export const orderItems = mysqlTable(
  'order_items',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    orderId: uuid('order_id').notNull(),
    productId: uuid('product_id').notNull(),
    variantId: uuid('variant_id'),
    nameSnapshot: varchar('name_snapshot', { length: 200 }).notNull(),
    variantNameSnapshot: varchar('variant_name_snapshot', { length: 100 }),
    quantity: smallint('quantity').notNull().default(1),
    unitPriceRappen: rappen('unit_price_rappen'),
    modifiersRappen: rappen('modifiers_rappen'),
    discountRappen: rappen('discount_rappen'),
    lineTotalRappen: rappen('line_total_rappen'),
    taxCategoryKey: varchar('tax_category_key', { length: 32 }).notNull(),
    taxRateCode: varchar('tax_rate_code', { length: 16 }).notNull(),
    taxRateBp: int('tax_rate_bp').notNull(),
    taxRappen: rappen('tax_rappen'),
    course: smallint('course').notNull().default(1),
    seat: smallint('seat'),
    note: text('note'),
    prepStatus: varchar('prep_status', { length: 16 }).notNull().default('pending'),
    sentAt: utcDatetime('sent_at'),
    preparingAt: utcDatetime('preparing_at'),
    readyAt: utcDatetime('ready_at'),
    servedAt: utcDatetime('served_at'),
    voidedAt: utcDatetime('voided_at'),
    voidReason: text('void_reason'),
    voidedByUserId: uuid('voided_by_user_id'),
    voidAuthorizedByUserId: uuid('void_authorized_by_user_id'),
    addedByUserId: uuid('added_by_user_id'),
    transferredFromOrderId: uuid('transferred_from_order_id'),
    ...syncColumns(),
    ...timestamps(),
  },
  (t) => [index('idx_order_items_order').on(t.orderId)],
);

export const orderItemModifiers = mysqlTable(
  'order_item_modifiers',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    orderItemId: uuid('order_item_id').notNull(),
    modifierId: uuid('modifier_id').notNull(),
    nameSnapshot: varchar('name_snapshot', { length: 100 }).notNull(),
    priceDeltaRappen: rappen('price_delta_rappen'),
    quantity: smallint('quantity').notNull().default(1),
    ...syncColumns(),
    ...timestamps(),
  },
  (t) => [index('idx_order_item_modifiers_item').on(t.orderItemId)],
);

/** Item or order discount, in % (bp) or amount (Rp), with reason and authorizer (RF-C11, RN-15). */
export const discounts = mysqlTable(
  'discounts',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    orderId: uuid('order_id').notNull(),
    orderItemId: uuid('order_item_id'),
    kind: varchar('kind', { length: 16 }).notNull(),
    /** bp if `kind = percent`, rappen if `kind = amount`. */
    value: int('value').notNull(),
    amountRappen: rappen('amount_rappen'),
    reasonCode: varchar('reason_code', { length: 32 }).notNull(),
    reasonText: text('reason_text'),
    appliedByUserId: uuid('applied_by_user_id').notNull(),
    authorizedByUserId: uuid('authorized_by_user_id'),
    ...syncColumns(),
    ...timestamps(),
  },
  (t) => [index('idx_discounts_order').on(t.orderId)],
);
