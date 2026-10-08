import { describe, expect, it } from 'vitest';
import type { Operation } from '../orders/operations';
import { foldOperations } from '../orders/reducer';
import {
  beer,
  CONTEXT,
  Device,
  freshId,
  line,
  STATION,
  TABLE,
  TERMINAL,
  USER,
} from '../orders/test-kit';
import { readyToServe, serviceGroupOf } from './ready';

/**
 * What the POS header counts for a waiter (DEC-034): open orders with something ready at the
 * pass, per place, tables once.
 */

const kitchen = { stationIds: [STATION.kitchen] };

/** An order of `waiter` with a dish the kitchen marked ready; returns its operations. */
function readyOrder(
  waiter: Device,
  cook: Device,
  fields: Parameters<Device['open']>[1] = {},
  number = 1,
) {
  const open = waiter.open(freshId(), fields, number);
  const dish = line(kitchen);
  const ops: Operation[] = [
    open,
    waiter.add(open.orderId, dish),
    waiter.sendTo(open.orderId, [STATION.kitchen], dish.itemId),
  ];
  cook.sees(...ops);
  ops.push(cook.kitchen('kitchen.ready', open.orderId, STATION.kitchen, dish.itemId));
  waiter.sees(...ops);
  return { ops, orderId: open.orderId, dish };
}

const count = (ops: Operation[], userId: string = USER.waiter) =>
  readyToServe(foldOperations(ops, CONTEXT), userId);

describe('serviceGroupOf (DEC-034)', () => {
  it('a table first, then the bar, everything else is taken away', () => {
    expect(serviceGroupOf({ channel: 'table', tableId: TABLE.t1 })).toBe('tables');
    expect(serviceGroupOf({ channel: 'qr', tableId: TABLE.t1 })).toBe('tables');
    expect(serviceGroupOf({ channel: 'bar', tableId: TABLE.t2 })).toBe('tables');
    expect(serviceGroupOf({ channel: 'bar', tableId: null })).toBe('bar');
    expect(serviceGroupOf({ channel: 'takeaway', tableId: null })).toBe('takeaway');
    expect(serviceGroupOf({ channel: 'web', tableId: null })).toBe('takeaway');
  });
});

describe('readyToServe (DEC-034)', () => {
  it('a table with a ready dish counts until it is served', () => {
    const waiter = new Device(TERMINAL.H1);
    const cook = new Device(TERMINAL.D1, USER.cook);
    const { ops, orderId, dish } = readyOrder(waiter, cook);
    expect(count(ops)).toEqual({ tables: 1, bar: 0, takeaway: 0 });
    ops.push(waiter.serve(orderId, dish.itemId));
    expect(count(ops)).toEqual({ tables: 0, bar: 0, takeaway: 0 });
  });

  it('only sent or pending items: nothing to hand over', () => {
    const waiter = new Device(TERMINAL.H1);
    const open = waiter.open();
    const dish = line(kitchen);
    const ops: Operation[] = [
      open,
      waiter.add(open.orderId, dish, beer()),
      waiter.sendTo(open.orderId, [STATION.kitchen], dish.itemId),
    ];
    expect(count(ops)).toEqual({ tables: 0, bar: 0, takeaway: 0 });
  });

  it('counts only the waiter’s own orders', () => {
    const waiter = new Device(TERMINAL.H1);
    const cook = new Device(TERMINAL.D1, USER.cook);
    const { ops } = readyOrder(waiter, cook);
    expect(count(ops, USER.waiter2)).toEqual({ tables: 0, bar: 0, takeaway: 0 });
  });

  it('two orders at the same table count as one table (RF-C05)', () => {
    const waiter = new Device(TERMINAL.H1);
    const cook = new Device(TERMINAL.D1, USER.cook);
    const first = readyOrder(waiter, cook, { tableId: TABLE.t1 }, 1);
    const second = readyOrder(waiter, cook, { tableId: TABLE.t1 }, 2);
    const third = readyOrder(waiter, cook, { tableId: TABLE.t2 }, 3);
    expect(count([...first.ops, ...second.ops, ...third.ops])).toEqual({
      tables: 2,
      bar: 0,
      takeaway: 0,
    });
  });

  it('bar and take-away orders count in their own group', () => {
    const waiter = new Device(TERMINAL.H1);
    const cook = new Device(TERMINAL.D1, USER.cook);
    const atBar = readyOrder(waiter, cook, { channel: 'bar', tableId: null, guestCount: null }, 1);
    const togo = readyOrder(
      waiter,
      cook,
      { channel: 'takeaway', consumptionType: 'takeaway', tableId: null, guestCount: null },
      2,
    );
    const togo2 = readyOrder(
      waiter,
      cook,
      { channel: 'takeaway', consumptionType: 'takeaway', tableId: null, guestCount: null },
      3,
    );
    expect(count([...atBar.ops, ...togo.ops, ...togo2.ops])).toEqual({
      tables: 0,
      bar: 1,
      takeaway: 2,
    });
  });

  it('a ready dish that was voided does not count', () => {
    const waiter = new Device(TERMINAL.H1);
    const cook = new Device(TERMINAL.D1, USER.cook);
    const { ops, orderId, dish } = readyOrder(waiter, cook);
    ops.push(
      waiter.op(
        'item.void',
        orderId,
        {
          itemId: dish.itemId,
          quantity: 1,
          voidedItemId: freshId(),
          reason: 'kitchen_error',
          reasonText: null,
        },
        { approval: { approverUserId: USER.manager, permissions: ['approval.grant'] } },
      ),
    );
    expect(count(ops)).toEqual({ tables: 0, bar: 0, takeaway: 0 });
  });

  it('a voided order does not count', () => {
    const waiter = new Device(TERMINAL.H1);
    const cook = new Device(TERMINAL.D1, USER.cook);
    const { ops, orderId } = readyOrder(waiter, cook);
    ops.push(
      waiter.op(
        'order.void',
        orderId,
        { reason: 'kitchen_error', reasonText: null },
        { approval: { approverUserId: USER.manager, permissions: ['approval.grant'] } },
      ),
    );
    expect(count(ops)).toEqual({ tables: 0, bar: 0, takeaway: 0 });
  });
});
