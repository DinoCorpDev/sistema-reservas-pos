import { describe, expect, it } from 'vitest';
import { buildReceipt } from '../receipts/build';
import { receiptContentHash } from '../receipts/hash';
import { rappen } from '../shared/money';
import { extractTax } from '../tax/calculation';
import { orderNumber } from './numbering';
import {
  isShiftOperation,
  newerOperationSchema,
  type Operation,
  OPERATION_SCHEMA_VERSION,
  operationBusinessDate,
  operationOrderIds,
  operationSchema,
  operationShiftId,
  relatedOrderId,
} from './operations';
import { BUSINESS_DATE, beer, Device, freshId, line, TABLE, TERMINAL, USER } from './test-kit';

/** A real receipt for one CHF 24.50 Rösti paid in cash, as the POS builds it. */
async function realReceipt() {
  const total = rappen(2450);
  const content = buildReceipt({
    language: 'de',
    location: {
      name: 'Restaurant Demo Zürich',
      legalName: null,
      street: 'Bahnhofstrasse 1',
      postalCode: '8001',
      city: 'Zürich',
      vatUid: 'CHE-123.456.789',
      header: null,
      footer: null,
    },
    receiptNumber: 'K1-261006-0012',
    orderNumber: '0042',
    tableLabel: '5',
    servedBy: 'Anna',
    timeZone: 'Europe/Zurich',
    issuedAt: '2026-10-06T18:30:00.000Z',
    order: { subtotalRappen: total, discountTotalRappen: rappen(0), totalRappen: total },
    lines: [
      {
        name: 'Berner Rösti',
        variantName: null,
        quantity: 1,
        unitPriceRappen: total,
        modifiers: [],
        discountRappen: rappen(0),
        lineTotalRappen: total,
        taxRappen: extractTax(total, 810),
        taxRateCode: 'normal',
        taxRateBp: 810,
      },
    ],
    payment: {
      method: 'cash',
      amountRappen: total,
      tipRappen: rappen(0),
      roundingRappen: rappen(0),
      tenderedRappen: rappen(5000),
      changeRappen: rappen(2550),
      splitLabel: null,
    },
    paidBeforeRappen: rappen(0),
    customer: null,
    customerNameFromRappen: 40000,
  });
  return {
    receiptId: freshId(),
    receiptNumber: 'K1-261006-0012',
    language: 'de' as const,
    content,
    contentHash: await receiptContentHash(content),
    customerName: null,
    customerAddress: null,
  };
}

async function cashPayment(device: Device, orderId: string) {
  return device.op('payment.record', orderId, {
    paymentId: freshId(),
    method: 'cash',
    adapter: 'cash',
    amountRappen: 2450,
    tipRappen: 0,
    tipUserId: null,
    roundingRappen: 0,
    tenderedRappen: 5000,
    changeRappen: 2550,
    externalReference: null,
    splitLabel: null,
    receipt: await realReceipt(),
    shiftId: freshId(),
    businessDate: BUSINESS_DATE,
  });
}

/** One operation of every non-payment type, as a terminal produces them. */
function sampleOperations(): Operation[] {
  const d = new Device(TERMINAL.H1, USER.manager);
  const open = d.open();
  const other = d.open(freshId(), { tableId: TABLE.t2 }, 2);
  const id = open.orderId;
  const item = line();
  const drink = beer();
  const discountId = freshId();
  return [
    open,
    d.add(id, item, drink),
    d.op('order.update', id, { guestCount: 4, joinedTableIds: [TABLE.t3], note: 'Geburtstag' }),
    d.op('order.change_channel', id, {
      channel: 'takeaway',
      consumptionType: 'takeaway',
      rates: [{ taxCategoryKey: 'food', taxRateCode: 'reduced', taxRateBp: 260 }],
    }),
    d.op('item.update', id, { itemId: item.itemId, note: 'ohne Zwiebeln', seat: 2 }),
    d.send(id, item.itemId),
    d.serve(id, item.itemId),
    d.op('item.void', id, {
      itemId: drink.itemId,
      quantity: 1,
      voidedItemId: freshId(),
      reason: 'entry_error',
      reasonText: null,
    }),
    d.op('discount.apply', id, {
      discountId,
      itemId: null,
      kind: 'percent',
      value: 1000,
      reasonCode: 'promotion',
      reasonText: null,
    }),
    d.op('discount.remove', id, { discountId }),
    d.op('refund.record', id, {
      refundId: freshId(),
      paymentId: freshId(),
      method: 'card',
      adapter: 'external-terminal',
      amountRappen: 500,
      tipRappen: 0,
      roundingRappen: 0,
      reason: 'Gericht kalt',
      externalReference: 'TRX-1',
      shiftId: null,
      businessDate: BUSINESS_DATE,
    }),
    d.op('receipt.reprint', id, { receiptId: freshId(), copyId: freshId(), hubPrint: false }),
    d.op('items.transfer', id, { itemIds: [item.itemId], toOrderId: other.orderId }),
    d.op('order.merge', other.orderId, { intoOrderId: id }),
    d.op('order.split', id, {
      newOrderId: freshId(),
      itemIds: [item.itemId],
      number: orderNumber('2026-10-06', 3),
    }),
    d.op('order.reopen', id, { reason: 'Falsch abgerechnet' }),
    d.op('order.void', id, { reason: 'other', reasonText: 'Test' }),
    d.op('terminal.unlocked', null, {}),
    d.op('terminal.pin_failed', null, { attempt: 2 }, { userId: null }),
    d.openShift(SHIFT, 20000, { openingCount: { '10000': 2 } }),
    d.movement(SHIFT, 'expense', -1250, 'Blumen'),
    d.closeShift(SHIFT, 18750),
  ];
}

const SHIFT = freshId();

const withoutField = (op: object, field: string) => {
  const copy: Record<string, unknown> = { ...op };
  delete copy[field];
  return copy;
};

describe('operationSchema (docs/SYNC.md §2, DEC-021)', () => {
  it.each(sampleOperations().map((op) => [op.type, op] as const))(
    '%s produced by a terminal parses unchanged',
    (_type, op) => {
      expect(operationSchema.parse(op)).toEqual(op);
    },
  );

  it('rejects an invalid HLC', () => {
    const open = new Device(TERMINAL.H1).open();
    for (const hlc of ['1791309600000', '1791309600000.1', 'abc', '']) {
      const result = operationSchema.safeParse({ ...open, hlc });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['hlc']);
    }
  });

  it('rejects an unknown operation type', () => {
    const open = new Device(TERMINAL.H1).open();
    expect(operationSchema.safeParse({ ...open, type: 'order.explode' }).success).toBe(false);
  });

  it('rejects a schema version from the future', () => {
    const open = new Device(TERMINAL.H1).open();
    const next = OPERATION_SCHEMA_VERSION + 1;
    expect(operationSchema.safeParse({ ...open, schemaVersion: next }).success).toBe(false);
    expect(operationSchema.safeParse({ ...open, schemaVersion: 0 }).success).toBe(false);
  });

  it('only the hub keeps an operation of a newer schema, by its envelope', () => {
    const open = new Device(TERMINAL.H1).open();
    const newer = { ...open, schemaVersion: OPERATION_SCHEMA_VERSION + 1, type: 'table.rotate' };
    expect(newerOperationSchema.safeParse(newer).success).toBe(true);
    // The known schema is not "newer": it goes through the full validation.
    expect(newerOperationSchema.safeParse(open).success).toBe(false);
    expect(newerOperationSchema.safeParse({ ...newer, hlc: 'x' }).success).toBe(false);
  });

  describe('version 3: shifts and cash (DEC-038)', () => {
    const d = new Device(TERMINAL.K1, USER.cashier);

    it('reads a version 2 payment and refund without shift, day or rounding as null and 0', async () => {
      const pay = await cashPayment(d, freshId());
      const v2 = {
        ...pay,
        schemaVersion: 2,
        payload: withoutField(withoutField(pay.payload, 'shiftId'), 'businessDate'),
      };
      const parsed = operationSchema.parse(v2);
      expect(parsed.type === 'payment.record' && parsed.payload).toMatchObject({
        shiftId: null,
        businessDate: null,
      });
      const refund = d.op('refund.record', pay.orderId, {
        refundId: freshId(),
        paymentId: pay.payload.paymentId,
        method: 'card',
        adapter: 'external-terminal',
        amountRappen: 500,
        tipRappen: 0,
        reason: 'kalt',
        externalReference: null,
      });
      const parsedRefund = operationSchema.parse({ ...refund, schemaVersion: 2 });
      expect(parsedRefund.type === 'refund.record' && parsedRefund.payload).toMatchObject({
        roundingRappen: 0,
        shiftId: null,
        businessDate: null,
      });
    });

    it('a wallet names its person and a till does not', () => {
      const wallet = d.openShift(freshId(), 0, { scope: 'personal', cashierUserId: USER.waiter });
      expect(operationSchema.safeParse(wallet).success).toBe(true);
      const noPerson = d.openShift(freshId(), 0, { scope: 'personal' });
      expect(operationSchema.safeParse(noPerson).success).toBe(false);
      const tillWithPerson = d.openShift(freshId(), 0, { cashierUserId: USER.waiter });
      expect(operationSchema.safeParse(tillWithPerson).success).toBe(false);
    });

    it('a counted float must be what was counted', () => {
      const counted = d.openShift(freshId(), 20500, { openingCount: { '10000': 2, '500': 1 } });
      expect(operationSchema.safeParse(counted).success).toBe(true);
      const wrong = d.openShift(freshId(), 20000, { openingCount: { '10000': 1 } });
      expect(operationSchema.safeParse(wrong).success).toBe(false);
    });

    it.each([
      ['cash_in', 5000, true],
      ['cash_in', -5000, false],
      ['cash_out', -5000, true],
      ['cash_out', 5000, false],
      ['expense', -1250, true],
      ['expense', 1250, false],
    ] as const)('a %s of %i is %s', (kind, amount, valid) => {
      expect(operationSchema.safeParse(d.movement(SHIFT, kind, amount)).success).toBe(valid);
    });

    it('a correction names the closing it corrects, and only a correction does', () => {
      const correction = d.movement(SHIFT, 'correction', -300);
      expect(operationSchema.safeParse(correction).success).toBe(false);
      const named = {
        ...correction,
        payload: { ...correction.payload, dailyClosingId: freshId() },
      };
      expect(operationSchema.safeParse(named).success).toBe(true);
      const out = d.movement(SHIFT, 'cash_out', -300);
      const outNamed = { ...out, payload: { ...out.payload, dailyClosingId: freshId() } };
      expect(operationSchema.safeParse(outNamed).success).toBe(false);
      expect(operationSchema.safeParse(d.movement(SHIFT, 'cash_in', 0)).success).toBe(false);
    });

    it('closing: the counted cash is the count, and a difference needs a comment (RF-D14)', () => {
      expect(operationSchema.safeParse(d.closeShift(SHIFT, 18750)).success).toBe(true);
      expect(operationSchema.safeParse(d.closeShift(SHIFT, 18750, 18700)).success).toBe(true);
      expect(operationSchema.safeParse(d.closeShift(SHIFT, 18750, 18700, null)).success).toBe(
        false,
      );
      const close = d.closeShift(SHIFT, 18750);
      const lying = { ...close, payload: { ...close.payload, countedCashRappen: 18755 } };
      expect(operationSchema.safeParse(lying).success).toBe(false);
    });

    it('shift operations touch no order, and name their shift and day', () => {
      for (const op of [
        d.openShift(SHIFT),
        d.movement(SHIFT, 'cash_in', 100),
        d.closeShift(SHIFT, 0),
      ]) {
        expect(operationOrderIds(op)).toEqual([]);
        expect(isShiftOperation(op.type)).toBe(true);
        expect(operationShiftId(op)).toBe(SHIFT);
        expect(operationBusinessDate(op)).toBe(BUSINESS_DATE);
      }
      const pay = d.pay(freshId(), 100, { shiftId: SHIFT, businessDate: BUSINESS_DATE });
      expect(isShiftOperation(pay.type)).toBe(false);
      expect(operationShiftId(pay)).toBe(SHIFT);
      expect(operationBusinessDate(pay)).toBe(BUSINESS_DATE);
      // A stored version 2 row has neither.
      const old = {
        ...pay,
        payload: withoutField(withoutField(pay.payload, 'shiftId'), 'businessDate'),
      };
      expect(operationShiftId(old as Operation)).toBeNull();
      expect(operationBusinessDate(old as Operation)).toBeNull();
    });
  });

  it('accepts a version 1 send without tickets, as an old device sends it', () => {
    const d = new Device(TERMINAL.H1);
    const send = d.op('items.send', freshId(), { itemIds: [freshId()] } as never, {
      schemaVersion: 1,
    });
    const parsed = operationSchema.parse(send);
    expect(parsed.type === 'items.send' && parsed.payload.tickets).toEqual([]);
  });

  it('validates the kitchen, printing and drawer operations (Phase 3)', () => {
    const d = new Device(TERMINAL.H1);
    const orderId = freshId();
    const ok = [
      d.kitchen('kitchen.start', orderId, freshId(), freshId()),
      d.kitchen('kitchen.ready', orderId, freshId(), freshId()),
      d.kitchen('kitchen.recall', orderId, freshId(), freshId()),
      d.op('kitchen.reprint', orderId, { sendOperationId: freshId(), stationId: freshId() }),
      d.op('receipt.print', orderId, { receiptId: freshId() }),
      d.op('drawer.open', null, { reason: 'Wechselgeld' }),
    ];
    for (const op of ok) expect(operationSchema.safeParse(op).success).toBe(true);
    // Kitchen operations name the items; an empty list means nothing.
    expect(
      operationSchema.safeParse(
        d.op('kitchen.ready', orderId, { stationId: freshId(), itemIds: [] }),
      ).success,
    ).toBe(false);
    // The drawer belongs to no order.
    expect(
      operationSchema.safeParse({ ...d.op('drawer.open', null, { reason: null }), orderId })
        .success,
    ).toBe(false);
  });

  it('rejects an item.update that only names the item', () => {
    const d = new Device(TERMINAL.H1);
    const itemId = freshId();
    const empty = d.op('item.update', freshId(), { itemId });
    expect(operationSchema.safeParse(empty).success).toBe(false);
    const quantity = d.op('item.update', empty.orderId, { itemId, quantity: 2 });
    expect(operationSchema.safeParse(quantity).success).toBe(true);
  });

  it('rejects an order.update without fields', () => {
    const d = new Device(TERMINAL.H1);
    const empty = d.op('order.update', freshId(), {});
    expect(operationSchema.safeParse(empty).success).toBe(false);
    const note = d.op('order.update', empty.orderId, { note: null });
    expect(operationSchema.safeParse(note).success).toBe(true);
  });

  it('rejects an items.add line with a negative price or an impossible rate', () => {
    const d = new Device(TERMINAL.H1);
    const orderId = freshId();
    expect(operationSchema.safeParse(d.add(orderId, line({ unitPriceRappen: -1 }))).success).toBe(
      false,
    );
    expect(operationSchema.safeParse(d.add(orderId, line({ taxRateBp: 10001 }))).success).toBe(
      false,
    );
    expect(operationSchema.safeParse(d.add(orderId, line({ course: 10 }))).success).toBe(false);
  });

  describe('approval', () => {
    it('defaults to null when absent', () => {
      const open = new Device(TERMINAL.H1).open();
      expect(operationSchema.parse(withoutField(open, 'approval')).approval).toBeNull();
    });

    it('accepts a manager approval with known permissions only', () => {
      const d = new Device(TERMINAL.H1);
      const approved = d.op(
        'order.void',
        freshId(),
        { reason: 'other', reasonText: null },
        { approval: { approverUserId: USER.manager, permissions: ['approval.grant'] } },
      );
      expect(operationSchema.parse(approved).approval).toEqual({
        approverUserId: USER.manager,
        permissions: ['approval.grant'],
      });
      const empty = { ...approved, approval: { approverUserId: USER.manager, permissions: [] } };
      expect(operationSchema.safeParse(empty).success).toBe(false);
      const unknown = {
        ...approved,
        approval: { approverUserId: USER.manager, permissions: ['everything'] },
      };
      expect(operationSchema.safeParse(unknown).success).toBe(false);
    });
  });

  describe('user', () => {
    it('accepts a failed PIN without a known user', () => {
      const failed = new Device(TERMINAL.H1).op(
        'terminal.pin_failed',
        null,
        { attempt: 1 },
        { userId: null },
      );
      expect(operationSchema.parse(failed).userId).toBeNull();
    });

    it('requires a user on every other operation', () => {
      const d = new Device(TERMINAL.H1);
      const unlocked = d.op('terminal.unlocked', null, {}, { userId: null });
      expect(operationSchema.safeParse(unlocked).success).toBe(false);
      const open = d.open(freshId(), {}, 1);
      expect(operationSchema.safeParse({ ...open, userId: null }).success).toBe(false);
    });
  });

  describe('terminal operations', () => {
    it('have no order: the id defaults to null and a real one is refused', () => {
      const unlocked = new Device(TERMINAL.H1).op('terminal.unlocked', null, {});
      expect(operationSchema.parse(withoutField(unlocked, 'orderId')).orderId).toBeNull();
      expect(operationSchema.safeParse({ ...unlocked, orderId: freshId() }).success).toBe(false);
    });

    it('order operations need an order id', () => {
      const open = new Device(TERMINAL.H1).open();
      expect(operationSchema.safeParse({ ...open, orderId: null }).success).toBe(false);
    });
  });

  describe('payment.record carries its frozen receipt (RN-10, DEC-024)', () => {
    it('parses with a real receipt and its SHA-256', async () => {
      const d = new Device(TERMINAL.K1, USER.cashier);
      const payment = await cashPayment(d, freshId());
      expect(payment.payload.receipt.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(operationSchema.parse(payment)).toEqual(payment);
    });

    it('rejects a receipt whose content is not a receipt', () => {
      const d = new Device(TERMINAL.K1, USER.cashier);
      const dummy = d.pay(freshId(), 2450); // the test kit's opaque `{}` content
      const result = operationSchema.safeParse(dummy);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path.slice(0, 3)).toEqual(['payload', 'receipt', 'content']);
    });

    it('rejects a hash that is not 64 lowercase hex characters', async () => {
      const d = new Device(TERMINAL.K1, USER.cashier);
      const payment = await cashPayment(d, freshId());
      const hash = payment.payload.receipt.contentHash;
      for (const contentHash of [hash.toUpperCase(), hash.slice(1), `${hash}0`, 'z'.repeat(64)]) {
        const tampered = {
          ...payment,
          payload: { ...payment.payload, receipt: { ...payment.payload.receipt, contentHash } },
        };
        expect(operationSchema.safeParse(tampered).success).toBe(false);
      }
    });

    it('rejects a payment that settles nothing', async () => {
      const d = new Device(TERMINAL.K1, USER.cashier);
      const payment = await cashPayment(d, freshId());
      const zero = { ...payment, payload: { ...payment.payload, amountRappen: 0 } };
      expect(operationSchema.safeParse(zero).success).toBe(false);
    });
  });
});

describe('operationOrderIds and relatedOrderId (docs/SYNC.md §4)', () => {
  const d = new Device(TERMINAL.H1, USER.manager);
  const a = freshId();
  const b = freshId();

  it('a plain order operation touches its own order only', () => {
    const add = d.add(a, line());
    expect(operationOrderIds(add)).toEqual([a]);
    expect(relatedOrderId(add)).toBeNull();
  });

  it('a transfer touches the source and the target', () => {
    const transfer = d.op('items.transfer', a, { itemIds: [freshId()], toOrderId: b });
    expect(operationOrderIds(transfer)).toEqual([a, b]);
    expect(relatedOrderId(transfer)).toBe(b);
  });

  it('a merge touches the merged order and the one that absorbs it', () => {
    const merge = d.op('order.merge', a, { intoOrderId: b });
    expect(operationOrderIds(merge)).toEqual([a, b]);
    expect(relatedOrderId(merge)).toBe(b);
  });

  it('a split touches the source and the new child order', () => {
    const split = d.op('order.split', a, {
      newOrderId: b,
      itemIds: [freshId()],
      number: orderNumber('2026-10-06', 9),
    });
    expect(operationOrderIds(split)).toEqual([a, b]);
    expect(relatedOrderId(split)).toBe(b);
  });

  it('terminal operations touch no order', () => {
    const unlocked = d.op('terminal.unlocked', null, {});
    const failed = d.op('terminal.pin_failed', null, { attempt: 1 }, { userId: null });
    for (const op of [unlocked, failed]) {
      expect(operationOrderIds(op)).toEqual([]);
      expect(relatedOrderId(op)).toBeNull();
    }
  });
});
