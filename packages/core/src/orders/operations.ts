import { z } from 'zod';
import { CASH_MOVEMENT_KINDS, SHIFT_SCOPES } from '../cash/constants';
import { countTotal, denominationCountSchema } from '../cash/count';
import { shiftReportSchema } from '../cash/report';
import { ALLERGENS } from '../catalog/constants';
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

/**
 * Version 2 (Phase 3): `items.send` carries the kitchen tickets it creates, and the kitchen,
 * printing and cash drawer operations exist.
 * Version 3 (Phase 4, DEC-038): shifts and cash movements; payments and refunds name their shift
 * and business day, and a refund carries its cash rounding. Older operations are still accepted.
 * Version 4 (DEC-054): the staff clock in and out (`staff.clock_in`, `staff.clock_out`).
 */
export const OPERATION_SCHEMA_VERSION = 4;

const id = z.uuid();
const isoDate = z.iso.date();
const nonNegative = z.int().min(0);
const positive = z.int().min(1);
const shortText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable();

/** Allergies at the table (DEC-037): the 14 allergens and/or free text such as "kiwi". */
export const orderAllergiesSchema = z.object({
  allergens: z
    .array(z.enum(ALLERGENS))
    .max(ALLERGENS.length)
    .refine((list) => new Set(list).size === list.length, 'Duplicate allergens'),
  note: optionalText(200),
});

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
  /** Kitchen stations the item is routed to (RF-C21), frozen at the sale. */
  stationIds: z.array(id).max(10),
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

/** Items of one ticket at one station: what the kitchen operations act on (RF-C22). */
const kitchenItems = z.object({ stationId: id, itemIds: z.array(id).min(1).max(200) });

/** Operations about a shift: they belong to no order (DEC-038). */
const shiftOp = { ...envelope, orderId: z.null().default(null) };

/**
 * Since version 3, the money of a payment or refund names the shift whose drawer or wallet it
 * went into (null without one: a card payment on a device with no shift open, or an operation
 * of version 2) and the business day it counts for: the shift's, so a drawer is counted in one
 * Z only (DEC-038). Stored version-2 rows lack both; readers use `?? null`.
 */
const shiftOfMoney = {
  shiftId: id.nullable().default(null),
  businessDate: isoDate.nullable().default(null),
};

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
        /** A guest's allergies, warned on every kitchen ticket (DEC-037); null clears them. */
        allergies: orderAllergiesSchema.nullable(),
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
    payload: z.object({
      itemIds: z.array(id).min(1).max(200),
      /**
       * Since version 2: one ticket per active station that receives items of this send, with
       * its id and the kitchen language frozen on the device (RF-C21, RF-C25, DEC-029). The
       * items only go to these stations; version 1 sends route to all of an item's stations.
       */
      tickets: z
        .array(
          z.object({
            ticketId: id,
            stationId: id,
            language: z.enum(CONTENT_LANGUAGES),
            /**
             * Stations this ticket stands in for: nobody was there, so their items come here
             * (DEC-033). Empty = only the station's own items.
             */
            replaces: z.array(id).max(10).default([]),
          }),
        )
        .max(10)
        .default([]),
    }),
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
      ...shiftOfMoney,
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
      /** Since version 3: the CHF 0.05 rounding of a cash refund (RN-06, DEC-038). */
      roundingRappen: z.int().default(0),
      reason: shortText(500),
      externalReference: optionalText(128),
      ...shiftOfMoney,
    }),
  }),
  z.object({
    ...orderOp,
    type: z.literal('receipt.reprint'),
    payload: z.object({
      receiptId: id,
      copyId: id,
      /** Since version 2: the hub prints the copy (otherwise the POS printed it, DEC-031). */
      hubPrint: z.boolean().default(false),
    }),
  }),
  z.object({
    ...orderOp,
    /** Prints the original receipt on the terminal's printer through the hub (DEC-031). */
    type: z.literal('receipt.print'),
    payload: z.object({ receiptId: id }),
  }),
  z.object({
    ...orderOp,
    /** The station started preparing these items (RF-C22). */
    type: z.literal('kitchen.start'),
    payload: kitchenItems,
  }),
  z.object({
    ...orderOp,
    /** These items are ready at the station (RF-C22, RF-C23). */
    type: z.literal('kitchen.ready'),
    payload: kitchenItems,
  }),
  z.object({
    ...orderOp,
    /** Recall: ready items go back to the station's board (RF-C28). */
    type: z.literal('kitchen.recall'),
    payload: kitchenItems,
  }),
  z.object({
    ...orderOp,
    /** Prints a ticket again at its station (RF-C26). A ticket is a send at a station. */
    type: z.literal('kitchen.reprint'),
    payload: z.object({ sendOperationId: id, stationId: id }),
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
  z.object({
    ...envelope,
    orderId: z.null().default(null),
    /**
     * The person on the terminal starts their working time (RF-A09, DEC-054). Who and when come
     * from the envelope (`userId`, `deviceAt`); the entry id is made on the device.
     */
    type: z.literal('staff.clock_in'),
    payload: z.object({ timeEntryId: id }),
  }),
  z.object({
    ...envelope,
    orderId: z.null().default(null),
    /** Ends the working time started by `staff.clock_in` with the same entry (DEC-054). */
    type: z.literal('staff.clock_out'),
    payload: z.object({ timeEntryId: id }),
  }),
  z.object({
    ...envelope,
    orderId: z.null().default(null),
    /** Opens the cash drawer without a sale (RF-D18): permission or a manager's approval. */
    type: z.literal('drawer.open'),
    payload: z.object({ reason: optionalText(200).default(null) }),
  }),
  z.object({
    ...shiftOp,
    /**
     * Opens a shift with its counted float (RF-D12): the till's (owner: the terminal of the
     * operation) or a person's wallet (owner: `cashierUserId`). One open per owner (RN-19).
     */
    type: z.literal('shift.open'),
    payload: z
      .object({
        shiftId: id,
        scope: z.enum(SHIFT_SCOPES),
        cashierUserId: id.nullable(),
        /** Frozen at the opening: all the shift's money counts for this day (DEC-038). */
        businessDate: isoDate,
        openingFloatRappen: nonNegative,
        openingCount: denominationCountSchema.nullable().default(null),
      })
      .refine(
        (p) => (p.scope === 'personal') === (p.cashierUserId !== null),
        'A wallet names its person; a till does not',
      )
      .refine(
        (p) => p.openingCount === null || countTotal(p.openingCount) === p.openingFloatRappen,
        'The float is what was counted',
      ),
  }),
  z.object({
    ...shiftOp,
    /** Cash in, cash out or a small expense during a shift (RF-D13); a correction after a Z (RN-21). */
    type: z.literal('cash.movement'),
    payload: z
      .object({
        movementId: id,
        shiftId: id,
        businessDate: isoDate,
        kind: z.enum(CASH_MOVEMENT_KINDS),
        /** Signed: + goes into the drawer, − comes out of it. */
        amountRappen: z.int().refine((value) => value !== 0, 'A movement moves money'),
        reason: shortText(500),
        /** The Z this corrects (RF-D17, RN-21); only for corrections. */
        dailyClosingId: id.nullable().default(null),
      })
      .refine(
        (p) =>
          p.kind === 'correction' ||
          (p.kind === 'cash_in' ? p.amountRappen > 0 : p.amountRappen < 0),
        'Cash in adds money; cash out and expenses take it out',
      )
      .refine(
        (p) => (p.kind === 'correction') === (p.dailyClosingId !== null),
        'A correction names the closing it corrects',
      ),
  }),
  z.object({
    ...shiftOp,
    /**
     * Closes a shift with the cash count (RF-D14, RF-D15). The expected cash and the report are
     * frozen as the device computed them; a difference needs a comment.
     */
    type: z.literal('shift.close'),
    payload: z
      .object({
        shiftId: id,
        businessDate: isoDate,
        countByDenomination: denominationCountSchema,
        countedCashRappen: nonNegative,
        expectedCashRappen: z.int(),
        differenceComment: optionalText(500).default(null),
        /** The hub prints the closing report on the terminal's printer (DEC-031). */
        hubPrint: z.boolean().default(false),
        report: shiftReportSchema,
      })
      .refine(
        (p) => countTotal(p.countByDenomination) === p.countedCashRappen,
        'The counted cash is the sum of the count',
      )
      .refine(
        (p) => p.countedCashRappen === p.expectedCashRappen || Boolean(p.differenceComment),
        'A difference needs a comment',
      ),
  }),
]);

/**
 * An operation of a schema newer than this code knows: a device updated before the hub. The hub
 * only keeps and forwards it (it does not fold), so it is checked as far as storing needs: the
 * envelope. Losing it would lose a sale; the cloud, always the newest, validates it fully.
 */
export const newerOperationSchema = z.looseObject({
  ...envelope,
  schemaVersion: z.int().min(OPERATION_SCHEMA_VERSION + 1),
  userId: id.nullable(),
  orderId: id.nullable().default(null),
  type: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/),
  payload: z.record(z.string(), z.unknown()),
});

export type Operation = z.infer<typeof operationSchema>;
export type OperationInput = z.input<typeof operationSchema>;
export type OperationType = Operation['type'];
export type OrderOperation = Exclude<Operation, { orderId: null }>;
export type OperationOf<T extends OperationType> = Extract<Operation, { type: T }>;

const SHIFT_OPERATION_TYPES = new Set<OperationType>([
  'shift.open',
  'cash.movement',
  'shift.close',
]);

/** The clock of the staff: working time, not money (DEC-054). */
export const isTimeOperation = (type: string): boolean =>
  type === 'staff.clock_in' || type === 'staff.clock_out';

/** Operations about a shift itself (not the payments that go into it). */
export const isShiftOperation = (type: string): boolean =>
  SHIFT_OPERATION_TYPES.has(type as OperationType);

/** The shift an operation belongs to or puts money into (`sync_operations.shift_id`). */
export function operationShiftId(op: Operation): string | null {
  switch (op.type) {
    case 'shift.open':
    case 'cash.movement':
    case 'shift.close':
      return op.payload.shiftId;
    case 'payment.record':
    case 'refund.record':
      return op.payload.shiftId ?? null;
    default:
      return null;
  }
}

/** The business day the money of an operation counts for, when it carries one (DEC-038). */
export function operationBusinessDate(op: Operation): string | null {
  switch (op.type) {
    case 'shift.open':
    case 'cash.movement':
    case 'shift.close':
      return op.payload.businessDate;
    case 'payment.record':
    case 'refund.record':
      return op.payload.businessDate ?? null;
    default:
      return null;
  }
}

/** Orders an operation touches: its own and, for transfer, merge and split, the other one. */
export function operationOrderIds(op: Operation): string[] {
  switch (op.type) {
    case 'terminal.unlocked':
    case 'terminal.pin_failed':
    case 'staff.clock_in':
    case 'staff.clock_out':
    case 'drawer.open':
    case 'shift.open':
    case 'cash.movement':
    case 'shift.close':
      return [];
    case 'items.transfer':
      return [op.orderId, op.payload.toOrderId];
    case 'order.merge':
      return [op.orderId, op.payload.intoOrderId];
    case 'order.split':
      return [op.orderId, op.payload.newOrderId];
    default:
      // An operation of a newer schema kept by the hub may have no order.
      return op.orderId ? [op.orderId] : [];
  }
}

/** The second order of a two-order operation (`sync_operations.related_entity_id`). */
export function relatedOrderId(op: Operation): string | null {
  return operationOrderIds(op)[1] ?? null;
}
