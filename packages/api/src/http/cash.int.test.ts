import { newId } from '@pos/core';
import { schema as s } from '@pos/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApi,
  type DemoContext,
  demoSession,
  loadDemo,
  pairTerminal,
  TestDevice,
  testLine,
} from '../testing';

/**
 * Shifts and cash in the cloud (DEC-038, RN-19, RF-D12…RF-D15): the refold of shifts projects
 * shifts and movements, flags what breaks the rules without losing money, and announces every
 * fact once. Against MySQL.
 */

const api = createTestApi();
let demo: DemoContext;
let scope: { organizationId: string; locationId: string };
let till: TestDevice;
let phone: TestDevice;

type PushResponse = {
  results: { id: string; status: string; conflicts: { code: string; entityId: string | null }[] }[];
};

const push = async (device: TestDevice, operations: unknown[]) => {
  const response = await api.request('POST', '/sync/push', {
    headers: device.headers,
    body: { operations },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as PushResponse;
};

const operationRow = async (id: string) => {
  const [row] = await api.db
    .select({ status: s.syncOperations.status, conflict: s.syncOperations.conflict })
    .from(s.syncOperations)
    .where(eq(s.syncOperations.id, id));
  return {
    status: row!.status,
    codes: ((row!.conflict as { code: string }[] | null) ?? []).map((c) => c.code),
  };
};

const shiftRow = async (id: string) => {
  const [row] = await api.db.select().from(s.shifts).where(eq(s.shifts.id, id));
  return row;
};

const eventsOf = (aggregateId: string) =>
  api.db.select().from(s.outboxEvents).where(eq(s.outboxEvents.aggregateId, aggregateId));

const auditsOf = (entityId: string) =>
  api.db.select().from(s.auditEvents).where(eq(s.auditEvents.entityId, entityId));

/** An open order with one CHF 24.50 line, ready to be paid. */
function order(device: TestDevice) {
  const open = device.open(newId(), 1);
  return { open, add: device.op('items.add', open.orderId, { items: [testLine()] }) };
}

beforeAll(async () => {
  demo = await loadDemo(api.db);
  scope = { organizationId: demo.organizationId, locationId: demo.locationId };
  const admin = api.as(demoSession(demo, 'admin'));
  till = new TestDevice(
    scope,
    await pairTerminal(api, admin, { prefix: 'C1' }),
    demo.users.cashier.id,
  );
  phone = new TestDevice(
    scope,
    await pairTerminal(api, admin, { prefix: 'C2', type: 'handheld' }),
    demo.users.waiter.id,
  );
});

afterAll(async () => {
  await api.close();
});

describe('the refold of shifts (DEC-038)', () => {
  it('projects a shift with its cash, movements and closing, announced once', async () => {
    const shiftId = newId();
    const { open, add } = order(till);
    const ops = [
      till.openShift(shiftId, 20000),
      open,
      add,
      await till.cashPay(open.orderId, 2450, shiftId),
      till.movement(shiftId, 'expense', -1250, 'Blumen'),
    ];
    const close = till.closeShift(shiftId, 20000 + 2450 - 1250, 21150);
    const { results } = await push(till, [...ops, close]);
    expect(results.map((r) => r.status)).toEqual(Array(6).fill('applied'));

    expect(await shiftRow(shiftId)).toMatchObject({
      scope: 'terminal',
      terminalId: till.terminal.id,
      status: 'closed',
      openingFloatRappen: 20000,
      expectedCashRappen: 21200,
      countedCashRappen: 21150,
      differenceRappen: -50,
      differenceComment: 'Differenz',
      businessDate: till.businessDate,
    });
    const movements = await api.db
      .select()
      .from(s.cashMovements)
      .where(eq(s.cashMovements.shiftId, shiftId));
    expect(movements).toMatchObject([
      { kind: 'expense', amountRappen: -1250, reason: 'Blumen', businessDate: till.businessDate },
    ]);
    const [payment] = await api.db
      .select()
      .from(s.payments)
      .where(eq(s.payments.orderId, open.orderId));
    expect(payment).toMatchObject({ shiftId, businessDate: till.businessDate, method: 'cash' });

    const types = async () => (await eventsOf(shiftId)).map((e) => e.type).sort();
    expect(await types()).toEqual(['cash.movement_recorded', 'shift.closed', 'shift.opened']);
    const actions = async () => (await auditsOf(shiftId)).map((a) => a.action).sort();
    expect(await actions()).toEqual(['cash.movement_recorded', 'shift.closed', 'shift.opened']);

    // The same batch again (a retry): nothing new.
    const again = await push(till, [...ops, close]);
    expect(again.results.every((r) => r.status === 'duplicate')).toBe(true);
    expect(await types()).toHaveLength(3);
    expect(await actions()).toHaveLength(3);
  });

  it('flags cash into a closed shift and keeps it through later refolds of the order', async () => {
    const shiftId = newId();
    const { open, add } = order(till);
    await push(till, [till.openShift(shiftId, 0), open, add, till.closeShift(shiftId, 0)]);
    const late = await till.cashPay(open.orderId, 1000, shiftId);
    const { results } = await push(till, [late]);
    expect(results[0]).toMatchObject({ status: 'conflict' });
    expect(results[0]!.conflicts.map((c) => c.code)).toEqual(['shift_closed']);
    // A later operation on the same order refolds the orders: the shift conflict stays.
    await push(till, [till.op('items.add', open.orderId, { items: [testLine()] })]);
    expect(await operationRow(late.id as string)).toEqual({
      status: 'conflict',
      codes: ['shift_closed'],
    });
  });

  it('a payment the closing device did not see makes the close a count mismatch', async () => {
    const shiftId = newId();
    const other = new TestDevice(scope, till.terminal, demo.users.cashier.id);
    const opening = till.openShift(shiftId, 0);
    const { open, add } = order(till);
    other.sees(opening, open, add);
    const paid = await other.cashPay(open.orderId, 2450, shiftId);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const close = till.sees(paid).closeShift(shiftId, 0);
    // The close arrives first; the payment that sorts before it comes later.
    await push(till, [opening, open, add, close]);
    expect((await operationRow(close.id as string)).codes).toEqual([]);
    await push(other, [paid]);
    expect(await operationRow(close.id as string)).toEqual({
      status: 'conflict',
      codes: ['shift_count_mismatch'],
    });
    expect(await operationRow(paid.id as string)).toEqual({ status: 'applied', codes: [] });
    // The signed expected cash stays as the cashier saw it.
    expect((await shiftRow(shiftId))?.expectedCashRappen).toBe(0);
  });

  it('RN-19: the second wallet of a person is flagged, whichever arrives first', async () => {
    const first = phone.openShift(newId(), 0, demo.users.waiter.id);
    const otherPhone = new TestDevice(scope, till.terminal, demo.users.waiter.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = otherPhone.openShift(newId(), 0, demo.users.waiter.id);
    // The later one reaches the cloud first: it looks fine until the earlier one arrives.
    expect((await push(otherPhone, [second])).results[0]!.status).toBe('applied');
    await push(phone, [first]);
    expect(await operationRow(second.id as string)).toEqual({
      status: 'conflict',
      codes: ['shift_already_open'],
    });
    expect(await operationRow(first.id as string)).toEqual({ status: 'applied', codes: [] });
    const conflictEvents = await eventsOf(second.id as string);
    expect(conflictEvents.map((e) => e.type)).toEqual(['sync.conflict_detected']);
  });

  it('flags cash without a shift and money into someone else’s shift, keeping the money', async () => {
    const shiftId = newId();
    const { open, add } = order(till);
    await push(till, [till.openShift(shiftId, 0), open, add]);
    const noShift = await till.cashPay(open.orderId, 500, null);
    phone.sees(open, add);
    const foreign = await phone.cashPay(open.orderId, 500, shiftId);
    expect((await push(till, [noShift])).results[0]!.conflicts.map((c) => c.code)).toEqual([
      'cash_without_shift',
    ]);
    expect((await push(phone, [foreign])).results[0]!.conflicts.map((c) => c.code)).toEqual([
      'shift_mismatch',
    ]);
    const payments = await api.db
      .select()
      .from(s.payments)
      .where(eq(s.payments.orderId, open.orderId));
    expect(payments).toHaveLength(2);
  });

  it('money for a day already closed is kept and flagged with its closing (RN-21)', async () => {
    const closingId = newId();
    const day = '2020-01-06';
    await api.db.insert(s.dailyClosings).values({
      id: closingId,
      organizationId: scope.organizationId,
      locationId: scope.locationId,
      businessDate: day,
      closingNumber: 900_001,
      totals: {} as never,
      contentHash: '0'.repeat(64),
      closedByUserId: demo.users.manager.id,
      closedAt: new Date(),
      createdAt: new Date(),
    });
    const made = phone.openShift(newId(), 0, demo.users.waiter2.id);
    const opening = { ...made, payload: { ...made.payload, businessDate: day } };
    const { results } = await push(phone, [opening]);
    expect(results[0]!.conflicts).toEqual([
      { code: 'day_closed', entityId: closingId, stored: true },
    ]);
    expect(await operationRow(opening.id as string)).toEqual({
      status: 'conflict',
      codes: ['day_closed'],
    });
  });
});
