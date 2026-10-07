import { z } from 'zod';
import { PERMISSIONS } from '../organization/permissions';
import { PAYMENT_ADAPTERS, PAYMENT_METHODS } from '../payments/constants';
import { receiptContentSchema } from '../receipts/content';
import { CHANNELS, CONSUMPTION_TYPES } from '../shared/channels';
import { isHlc } from '../shared/hlc';
import { CONTENT_LANGUAGES } from '../shared/languages';
import { TAX_CATEGORY_KEYS, TAX_RATE_CODES } from '../tax/constants';
import { DISCOUNT_KINDS, MAX_COURSE, MIN_COURSE, VOID_REASONS } from './constants';

/**
 * Operations of the order engine (docs/SYNC.md §2, DEC-021). Every POS action is one immutable
 * operation; the state of the orders is the fold of their operations in canonical order.
 * Payloads are FROZEN: they carry every new id, the prices and MWST already calculated and any
 * other input that is not deterministic, so every node folds to the same result.
 */

export const OPERATION_SCHEMA_VERSION = 1;

const id = z.uuid();
const isoDate = z.iso.date();
const nonNegative = z.int().min(0);
const positive = z.int().min(1);
const shortText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable();

/** The order number assigned when an order is opened (RN-16, RF-C15, DEC-022). */
export const orderNumberSchema = z.object({
  businessDate: isoDate,
  number: positive,
  /** Empty when the location's authority numbered it; the terminal prefix otherwise. */
  prefix: z.string().regex(/^[A-Z0-9]{0,4}$/),
  display: z.string().min(1).max(12),
});
export type OrderNumber = z.infer<typeof orderNumberSchema>;

/** A sold line exactly as it is stored: price, rate and tax frozen at the sale (RN-04). */
export const lineSnapshotSchema = z.object({
  itemId: id,
  productId: id,
  variantId: id.nullable(),
  name: shortText(200),
  variantName: optionalText(100),
  quantity: z.int().min(1).max(999),
  unitPriceRappen: nonNegative,
  modifiers: z
    .array(
      z.object({
        id,
        modifierId: id,
        name: shortText(100),
        priceDeltaRappen: z.int(),
        quantity: z.int().min(1).max(20),
      }),
    )
    .max(30),
  taxCategoryKey: z.enum(TAX_CATEGORY_KEYS),
  taxRateCode: z.enum(TAX_RATE_CODES),
  taxRateBp: z.int().min(0).max(10000),
  course: z.int().min(MIN_COURSE).max(MAX_COURSE),
  seat: z.int().min(1).max(99).nullable(),
  note: optionalText(500),
  /** Kitchen stations the item is routed to (RF-C20), frozen for the KDS of Phase 3. */
  stationIds: z.array(id).max(5),
});
export type LineSnapshot = z.infer<typeof lineSnapshotSchema>;

const receiptSchema = z.object({
  receiptId: id,
  receiptNumber: z.string().min(1).max(32),
  language: z.enum(CONTENT_LANGUAGES),
  content: receiptContentSchema,
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  customerName: optionalText(200),
  customerAddress: optionalText(500),
});

const approvalSchema = z.object({
  approverUserId: id,
  permissions: z.array(z.enum(PERMISSIONS)).min(1).max(5),
});
export type OperationApproval = z.infer<typeof approvalSchema>;

const envelope = {
  id,
  schemaVersion: z.int().min(1).max(OPERATION_SCHEMA_VERSION),
  hlc: z.string().refine(isHlc, 'Invalid HLC'),
  deviceAt: z.iso.datetime({ offset: true }),
  organizationId: id,
  locationId: id,
  terminalId: id,
  userId: id,
  approval: approvalSchema.nullable().default(null),
};

const orderOp = { ...envelope, orderId: id };

export const operationSchema = z.discriminatedUnion('type', [
  z.object({
    ...orderOp,
    type: z.literal('order.open'),
    payload: z.object({
      channel: z.enum(CHANNELS),
      consumptionType: z.enum(CONSUMPTION_TYPES),
      tableId: id.nullable(),
      guestCount: z.int().min(0).max(99).nullable(),
      waiterUserId: id,
      customerName: optionalText(200),
      number: orderNumberSchema,
    }),
  }),
  z.object({
    ...orderOp,
    type: z.literal('order.update'),
    payload: z
      .object({
        guestCount: z.int().min(0).max(99).nullable(),
        waiterUserId: id,
        tableId: id.nullable(),
        /** Tables joined to this order's table (RF-C03); last writer wins on the whole set. */
        joinedTableIds: z.array(id).max(10),
        customerName: optionalText(200),
        note: optionalText(500),
      })
      .partial()
      .refine((fields) => Object.keys(fields).length > 0, 'Nothing to update'),
  }),
  z.object({
    ...orderOp,
    type: z.literal('order.change_channel'),
    payload: z.object({
      channel: z.enum(CHANNELS),
      consumptionType: z.enum(CONSUMPTION_TYPES),
      /** Rate per tax category for the new consumption type on the sale date (RN-05). */
      rates: z
        .array(
          z.object({
            taxCategoryKey: z.enum(TAX_CATEGORY_KEYS),
            taxRateCode: z.enum(TAX_RATE_CODES),
            taxRateBp: z.int().min(0).max(10000),
          }),
        )
        .min(1),
    }),
  }),
  z.object({
    ...orderOp,
    type: z.literal('items.add'),
    payload: z.object({ items: z.array(lineSnapshotSchema).min(1).max(50) }),
  }),
  z.object({
    ...orderOp,
    type: z.literal('item.update'),
    payload: z
      .object({
        itemId: id,
        quantity: z.int().min(1).max(999).optional(),
        note: optionalText(500).optional(),
        seat: z.int().min(1).max(99).nullable().optional(),
        course: z.int().min(MIN_COURSE).max(MAX_COURSE).optional(),
      })
      .refine((fields) => Object.keys(fields).length > 1, 'Nothing to update'),
  }),
  z.object({
    ...orderOp,
    type: z.literal('items.send'),
    payload: z.object({ itemIds: z.array(id).min(1).max(200) }),
  }),
  z.object({
    ...orderOp,
    type: z.literal('items.serve'),
    payload: z.object({ itemIds: z.array(id).min(1).max(200) }),
  }),
  z.object({
    ...orderOp,
    type: z.literal('item.void'),
    payload: z.object({
      itemId: id,
      quantity: z.int().min(1).max(999),
      /** Id of the voided part when only part of the quantity is voided. */
      voidedItemId: id,
      reason: z.enum(VOID_REASONS),
      reasonText: optionalText(500),
    }),
  }),
  z.object({
    ...orderOp,
    type: z.literal('discount.apply'),
    payload: z.object({
      discountId: id,
      /** Null = discount on the whole order. */
      itemId: id.nullable(),
      kind: z.enum(DISCOUNT_KINDS),
      value: z.int().min(1),
      reasonCode: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
      reasonText: optionalText(500),
    }),
  }),
  z.object({
    ...orderOp,
    type: z.literal('discount.remove'),
    payload: z.object({ discountId: id }),
  }),
  z.object({
    ...orderOp,
    type: z.literal('payment.record'),
    payload: z.object({
      paymentId: id,
      method: z.enum(PAYMENT_METHODS),
      adapter: z.enum(PAYMENT_ADAPTERS),
      /** The part that settles the order (the sale); tip and rounding are outside it. */
      amountRappen: positive,
      tipRappen: nonNegative,
      /** The waiter who receives the tip, fixed at payment time (RN-07). */
      tipUserId: id.nullable(),
      roundingRappen: z.int(),
      tenderedRappen: nonNegative.nullable(),
      changeRappen: nonNegative,
      externalReference: optionalText(128),
      splitLabel: optionalText(32),
      receipt: receiptSchema,
    }),
  }),
  z.object({
    ...orderOp,
    type: z.literal('refund.record'),
    payload: z.object({
      refundId: id,
      paymentId: id,
      method: z.enum(PAYMENT_METHODS),
      adapter: z.enum(PAYMENT_ADAPTERS),
      amountRappen: positive,
      tipRappen: nonNegative,
      reason: shortText(500),
      externalReference: optionalText(128),
    }),
  }),
  z.object({
    ...orderOp,
    type: z.literal('receipt.reprint'),
    payload: z.object({ receiptId: id, copyId: id }),
  }),
  z.object({
    ...orderOp,
    type: z.literal('items.transfer'),
    payload: z.object({ itemIds: z.array(id).min(1).max(200), toOrderId: id }),
  }),
  z.object({
    ...orderOp,
    type: z.literal('order.merge'),
    payload: z.object({ intoOrderId: id }),
  }),
  z.object({
    ...orderOp,
    type: z.literal('order.split'),
    payload: z.object({
      newOrderId: id,
      itemIds: z.array(id).min(1).max(200),
      number: orderNumberSchema,
    }),
  }),
  z.object({
    ...orderOp,
    type: z.literal('order.reopen'),
    payload: z.object({ reason: shortText(500) }),
  }),
  z.object({
    ...orderOp,
    type: z.literal('order.void'),
    payload: z.object({ reason: z.enum(VOID_REASONS), reasonText: optionalText(500) }),
  }),
  z.object({
    ...envelope,
    orderId: z.null().default(null),
    type: z.literal('terminal.unlocked'),
    payload: z.object({}),
  }),
  z.object({
    ...envelope,
    orderId: z.null().default(null),
    // Unknown person: the PIN matched nobody, so the operation carries the terminal's user slot.
    userId: id.nullable(),
    type: z.literal('terminal.pin_failed'),
    payload: z.object({ attempt: positive }),
  }),
]);

export type Operation = z.infer<typeof operationSchema>;
export type OperationInput = z.input<typeof operationSchema>;
export type OperationType = Operation['type'];
export type OrderOperation = Exclude<Operation, { orderId: null }>;
export type OperationOf<T extends OperationType> = Extract<Operation, { type: T }>;

/** Orders an operation touches: its own and, for transfer, merge and split, the other one. */
export function operationOrderIds(op: Operation): string[] {
  switch (op.type) {
    case 'terminal.unlocked':
    case 'terminal.pin_failed':
      return [];
    case 'items.transfer':
      return [op.orderId, op.payload.toOrderId];
    case 'order.merge':
      return [op.orderId, op.payload.intoOrderId];
    case 'order.split':
      return [op.orderId, op.payload.newOrderId];
    default:
      return [op.orderId];
  }
}

/** The second order of a two-order operation (`sync_operations.related_entity_id`). */
export function relatedOrderId(op: Operation): string | null {
  return operationOrderIds(op)[1] ?? null;
}
