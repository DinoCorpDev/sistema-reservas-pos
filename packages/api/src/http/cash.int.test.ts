import { newId } from '@pos/core';
import { schema as s } from '@pos/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOtherOrganization,
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
    // Closing it is a late fact too: kept, flagged, and the wallet is closed.
    const close = phone.closeShift(made.payload.shiftId as string, 0);
    const closing = { ...close, payload: { ...close.payload, businessDate: day } };
    await push(phone, [closing]);
    expect((await shiftRow(made.payload.shiftId as string))?.status).toBe('closed');
  });
});

/** A device of the same terminal living on another business day (tests of past days). */
const onDay = (device: TestDevice, day: string) =>
  Object.assign(new TestDevice(scope, device.terminal, device.userId), { businessDate: day });

type Json = Record<string, unknown>;
const call = async <T = Json>(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) => {
  const response = await api.request(method, path, { headers, body });
  return { status: response.status, body: (await response.json()) as T };
};

describe('closing the business day (Z, RF-D11, RF-D15, RF-D19, RN-20, RN-21)', () => {
  const DAY = '2025-03-10';
  let manager: Record<string, string>;
  let dayTill: TestDevice;
  let shiftId: string;
  let tableOrder: ReturnType<typeof order>;
  let closingId: string;

  beforeAll(async () => {
    manager = api.as(demoSession(demo, 'manager'));
    dayTill = onDay(till, DAY);
    shiftId = newId();
    tableOrder = order(dayTill);
    const paid = order(dayTill);
    await push(dayTill, [
      dayTill.openShift(shiftId, 20000),
      tableOrder.open,
      tableOrder.add,
      paid.open,
      paid.add,
      await dayTill.cashPay(paid.open.orderId, 2450, shiftId, 30),
    ]);
  });

  it('lists what stops the day: an open shift and an open order', async () => {
    const preview = await call<Json & { blockers: Json; canClose: boolean }>(
      'GET',
      `/cash/day-close/preview?businessDate=${DAY}`,
      manager,
    );
    expect(preview.status).toBe(200);
    expect(preview.body.canClose).toBe(false);
    expect(preview.body.blockers).toMatchObject({
      openShifts: [{ id: shiftId, scope: 'terminal' }],
      openOrders: [{ id: tableOrder.open.orderId, totalRappen: 2450, balanceRappen: 2450 }],
      previousDayOpen: null,
      future: false,
    });
    const refused = await call('POST', '/cash/day-close', manager, { businessDate: DAY });
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain('blocked');
  });

  it('a waiter cannot close the day; a future day cannot close', async () => {
    const waiter = api.as(demoSession(demo, 'waiter'));
    expect((await call('POST', '/cash/day-close', waiter, { businessDate: DAY })).status).toBe(403);
    const future = await call<{ blockers: { future: boolean } }>(
      'GET',
      '/cash/day-close/preview?businessDate=2999-01-01',
      manager,
    );
    expect(future.body.blockers.future).toBe(true);
  });

  it('once resolved, needs the card terminal total and a reason for a difference', async () => {
    // The table pays by card; the cashier counts the drawer and closes the shift.
    await push(dayTill, [
      await dayTill.pay(tableOrder.open.orderId, 2450, {
        shiftId,
        businessDate: DAY,
        tipRappen: 50,
      }),
      dayTill.closeShift(shiftId, 20000 + 2480, 20000 + 2480),
    ]);
    const preview = await call<Json & { canClose: boolean; toReconcile: Json[] }>(
      'GET',
      `/cash/day-close/preview?businessDate=${DAY}`,
      manager,
    );
    expect(preview.body.canClose).toBe(true);
    expect(preview.body.toReconcile).toEqual([{ method: 'card', posTotalRappen: 2500 }]);

    const missing = await call('POST', '/cash/day-close', manager, { businessDate: DAY });
    expect(missing.status).toBe(422);
    expect(JSON.stringify(missing.body)).toContain('reconciliation_missing');
    const noReason = await call('POST', '/cash/day-close', manager, {
      businessDate: DAY,
      reconciliations: [{ method: 'card', terminalTotalRappen: 2450 }],
    });
    expect(noReason.status).toBe(422);
    expect(JSON.stringify(noReason.body)).toContain('reason_required');
  });

  it('closes the day from the POS with a manager PIN: an immutable, sealed Z', async () => {
    const unlocked = await api.request('POST', '/terminals/unlock', {
      headers: { 'x-terminal-token': till.terminal.deviceToken },
      body: { pin: '2000' },
    });
    const { token } = (await unlocked.json()) as { token: string };
    const pos = { authorization: `Bearer ${token}`, 'x-terminal-token': till.terminal.deviceToken };
    const numbers = (
      await api.db.select({ n: s.dailyClosings.closingNumber }).from(s.dailyClosings)
    ).map((r) => r.n);
    const closed = await call<Json & { id: string; closingNumber: number; totals: Json }>(
      'POST',
      '/cash/day-close',
      pos,
      {
        businessDate: DAY,
        reconciliations: [
          { method: 'card', terminalTotalRappen: 2450, reason: 'Trinkgeld bar ausbezahlt' },
        ],
      },
    );
    expect(closed.status).toBe(200);
    expect(closed.body.closingNumber).toBe(Math.max(0, ...numbers) + 1);
    expect(closed.body.totals).toMatchObject({
      grossSalesRappen: 4900,
      tipsRappen: 80,
      paymentCount: 2,
      orderCount: 2,
      byPaymentMethod: [
        { method: 'cash', salesRappen: 2450, tipsRappen: 30, totalRappen: 2480 },
        { method: 'card', salesRappen: 2450, tipsRappen: 50, totalRappen: 2500 },
      ],
      cash: {
        openingFloatRappen: 20000,
        collectedRappen: 2480,
        expectedRappen: 22480,
        countedRappen: 22480,
        differenceRappen: 0,
      },
      reconciliations: [
        { method: 'card', posTotalRappen: 2500, terminalTotalRappen: 2450, differenceRappen: -50 },
      ],
    });
    closingId = closed.body.id;
    const gross = (closed.body.totals.byTaxRate as { grossRappen: number }[]).reduce(
      (sum, rate) => sum + rate.grossRappen,
      0,
    );
    expect(gross).toBe(4900);

    // Closing again returns the same Z.
    const again = await call<{ id: string }>('POST', '/cash/day-close', manager, {
      businessDate: DAY,
      reconciliations: [],
    });
    expect(again.body.id).toBe(closingId);
    // The database itself refuses to change it (RN-10).
    await expect(
      api.db
        .update(s.dailyClosings)
        .set({ closingNumber: 999 })
        .where(eq(s.dailyClosings.id, closingId)),
    ).rejects.toThrow();
    const detail = await call<{ intact: boolean; corrections: unknown }>(
      'GET',
      `/cash/closings/${closingId}`,
      manager,
    );
    expect(detail.body).toMatchObject({ intact: true, corrections: null });
    const reconciliations = await api.db
      .select()
      .from(s.paymentReconciliations)
      .where(eq(s.paymentReconciliations.businessDate, DAY));
    expect(reconciliations).toMatchObject([{ method: 'card', differenceRappen: -50 }]);
    const audit = await auditsOf(closingId);
    expect(audit.map((a) => a.action)).toEqual(['day.closed']);
    expect((await eventsOf(closingId)).map((e) => e.type)).toEqual(['day.closed']);
  });

  it('money that arrives after the Z is kept and listed as its correction', async () => {
    const extra = order(dayTill);
    const late = await dayTill.cashPay(extra.open.orderId, 100, shiftId);
    const { results } = await push(dayTill, [extra.open, extra.add, late]);
    expect(results[2]!.conflicts.map((c) => c.code).sort()).toEqual(['day_closed', 'shift_closed']);
    const detail = await call<{ intact: boolean; corrections: { count: number; totals: Json } }>(
      'GET',
      `/cash/closings/${closingId}`,
      manager,
    );
    expect(detail.body.intact).toBe(true);
    expect(detail.body.corrections).toMatchObject({ count: 1, totals: { grossSalesRappen: 100 } });
  });

  it('the cash book lists the day with its running balance (RF-D16)', async () => {
    const book = await call<{
      lines: { kind: string; balanceRappen: number }[];
      endBalanceRappen: number;
    }>('GET', `/cash/book?businessDate=${DAY}`, manager);
    expect(book.status).toBe(200);
    expect(book.body.lines.map((l) => l.kind)).toEqual(['opening', 'sale', 'sale']);
    expect(book.body.lines.map((l) => l.balanceRappen)).toEqual([20000, 22480, 22580]);
  });

  it('another organization never sees the closing (RNF-12)', async () => {
    const other = await createOtherOrganization(api.db, 'Cash Other');
    const headers = api.as(other.session);
    expect((await call('GET', `/cash/closings/${closingId}`, headers)).status).toBe(404);
    const list = await call<unknown[]>('GET', '/cash/closings', headers);
    expect(list.body).toEqual([]);
  });
});
