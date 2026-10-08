import { describe, expect, it } from 'vitest';
import type { Operation } from '../orders/operations';
import { foldOperations } from '../orders/reducer';
import { ticketKey } from '../orders/state';
import {
  beer,
  CONTEXT,
  Device,
  freshId,
  line,
  STATION,
  T0,
  TERMINAL,
  USER,
} from '../orders/test-kit';
import { stationBoard, ticketView } from './board';
import { ticketProgress } from './tickets';

/**
 * Kitchen state in the order fold (DEC-029, RF-C20…RF-C28, RN-13): tickets per send and station,
 * per-station progress, the derived item status, and the races between kitchen and floor.
 */

const at = (ms: number) => new Date(T0 + ms).toISOString();

function service() {
  const waiter = new Device(TERMINAL.H1, USER.waiter);
  const kds = new Device(TERMINAL.D1, USER.cook);
  const open = waiter.open();
  const orderId = open.orderId;
  const rosti = line({ stationIds: [STATION.kitchen] });
  const beers = beer({ quantity: 2, course: 0, stationIds: [STATION.bar] });
  const menu = line({ name: 'Tagesmenü', stationIds: [STATION.kitchen, STATION.dessert] });
  const water = line({ name: 'Wasser', stationIds: [] });
  const add = waiter.add(orderId, rosti, beers, menu, water);
  const send = waiter.sendTo(
    orderId,
    [STATION.kitchen, STATION.bar, STATION.dessert],
    rosti.itemId,
    beers.itemId,
    menu.itemId,
    water.itemId,
  );
  kds.sees(open, add, send);
  return { waiter, kds, orderId, rosti, beers, menu, water, ops: [open, add, send] as Operation[] };
}

describe('kitchen tickets (RF-C20, RF-C21, DEC-029)', () => {
  it('one send creates one ticket per station, with the id and language frozen on the device', () => {
    const { ops, orderId, rosti, beers, menu, water } = service();
    const send = ops[2] as Extract<Operation, { type: 'items.send' }>;
    const state = foldOperations(ops, CONTEXT);
    expect(state.tickets.size).toBe(3);
    const kitchen = state.tickets.get(ticketKey(send.id, STATION.kitchen))!;
    const frozen = send.payload.tickets.find((t) => t.stationId === STATION.kitchen)!;
    expect(kitchen).toMatchObject({
      id: frozen.ticketId,
      orderId,
      language: 'de',
      sentAt: send.deviceAt,
      sentByUserId: USER.waiter,
      itemIds: [rosti.itemId, menu.itemId],
    });
    expect(state.tickets.get(ticketKey(send.id, STATION.bar))!.itemIds).toEqual([beers.itemId]);
    expect(state.tickets.get(ticketKey(send.id, STATION.dessert))!.itemIds).toEqual([menu.itemId]);
    // An item without a station reaches no screen: it stays "sent" until it is served.
    expect(state.items.get(water.itemId)).toMatchObject({ prepStatus: 'sent', kitchen: {} });
  });

  it('a version 2 send only routes to the stations it names (inactive ones are left out)', () => {
    const waiter = new Device(TERMINAL.H1);
    const open = waiter.open();
    const menu = line({ stationIds: [STATION.kitchen, STATION.dessert] });
    const ops = [
      open,
      waiter.add(open.orderId, menu),
      waiter.sendTo(open.orderId, [STATION.kitchen], menu.itemId),
    ];
    const state = foldOperations(ops, CONTEXT);
    expect(Object.keys(state.items.get(menu.itemId)!.kitchen)).toEqual([STATION.kitchen]);
    expect(state.tickets.size).toBe(1);
  });

  it('a version 1 send (no tickets) routes to all stations of the item, without ticket ids', () => {
    const waiter = new Device(TERMINAL.H1);
    const open = waiter.open();
    const menu = line({ stationIds: [STATION.kitchen, STATION.dessert] });
    const add = waiter.add(open.orderId, menu);
    const send = waiter.op('items.send', open.orderId, { itemIds: [menu.itemId] } as never, {
      schemaVersion: 1,
    });
    const state = foldOperations([open, add, send], CONTEXT);
    expect([...state.tickets.values()].map((t) => [t.stationId, t.id, t.language])).toEqual([
      [STATION.kitchen, null, null],
      [STATION.dessert, null, null],
    ]);
  });

  it('marching a course later creates a new ticket at the same station (RF-C09)', () => {
    const waiter = new Device(TERMINAL.H1);
    const open = waiter.open();
    const starter = line({ course: 1, stationIds: [STATION.kitchen] });
    const main = line({ course: 2, stationIds: [STATION.kitchen] });
    const ops = [
      open,
      waiter.add(open.orderId, starter, main),
      waiter.sendTo(open.orderId, [STATION.kitchen], starter.itemId),
      waiter.wait(600_000).sendTo(open.orderId, [STATION.kitchen], main.itemId),
    ];
    const state = foldOperations(ops, CONTEXT);
    const tickets = [...state.tickets.values()];
    expect(tickets.map((t) => t.itemIds)).toEqual([[starter.itemId], [main.itemId]]);
    // Sending again what was already sent creates nothing.
    const again = foldOperations(
      [...ops, waiter.sendTo(open.orderId, [STATION.kitchen], starter.itemId)],
      CONTEXT,
    );
    expect(again.tickets.size).toBe(2);
  });
});

describe('kitchen progress (RF-C22, RF-C16)', () => {
  it('start → preparing, ready → ready, per item and derived for the ticket', () => {
    const { kds, orderId, rosti, menu, ops } = service();
    const start = kds.kitchen('kitchen.start', orderId, STATION.kitchen, rosti.itemId);
    let state = foldOperations([...ops, start], CONTEXT);
    expect(state.items.get(rosti.itemId)).toMatchObject({
      prepStatus: 'preparing',
      preparingAt: start.deviceAt,
    });
    const key = ticketKey(ops[2]!.id, STATION.kitchen);
    expect(ticketProgress(state, state.tickets.get(key)!).status).toBe('preparing');

    const ready = kds.kitchen('kitchen.ready', orderId, STATION.kitchen, rosti.itemId, menu.itemId);
    state = foldOperations([...ops, start, ready], CONTEXT);
    expect(state.items.get(rosti.itemId)).toMatchObject({
      prepStatus: 'ready',
      readyAt: ready.deviceAt,
    });
    expect(ticketProgress(state, state.tickets.get(key)!)).toMatchObject({
      status: 'ready',
      preparingAt: start.deviceAt,
      readyAt: ready.deviceAt,
      finishedAt: ready.deviceAt,
    });
    expect([...state.outcomes.values()].every((o) => o === 'applied')).toBe(true);
  });

  it('an item at two stations is ready only when both are (RF-C21)', () => {
    const { kds, orderId, menu, ops } = service();
    const kitchenReady = kds.kitchen('kitchen.ready', orderId, STATION.kitchen, menu.itemId);
    let state = foldOperations([...ops, kitchenReady], CONTEXT);
    expect(state.items.get(menu.itemId)!.prepStatus).toBe('preparing');
    const dessertReady = kds.kitchen('kitchen.ready', orderId, STATION.dessert, menu.itemId);
    state = foldOperations([...ops, kitchenReady, dessertReady], CONTEXT);
    expect(state.items.get(menu.itemId)).toMatchObject({
      prepStatus: 'ready',
      readyAt: dessertReady.deviceAt,
    });
  });

  it('repeating a step changes nothing; recall brings a ready item back (RF-C28)', () => {
    const { kds, orderId, rosti, ops } = service();
    const ready = kds.kitchen('kitchen.ready', orderId, STATION.kitchen, rosti.itemId);
    const again = kds.kitchen('kitchen.ready', orderId, STATION.kitchen, rosti.itemId);
    const start = kds.kitchen('kitchen.start', orderId, STATION.kitchen, rosti.itemId);
    let state = foldOperations([...ops, ready, again, start], CONTEXT);
    // Start after ready does not move it back: only a recall does.
    expect(state.items.get(rosti.itemId)).toMatchObject({
      prepStatus: 'ready',
      readyAt: ready.deviceAt,
    });
    expect(state.conflicts).toEqual([]);

    const recall = kds.kitchen('kitchen.recall', orderId, STATION.kitchen, rosti.itemId);
    state = foldOperations([...ops, ready, again, start, recall], CONTEXT);
    expect(state.items.get(rosti.itemId)).toMatchObject({
      prepStatus: 'preparing',
      readyAt: null,
      preparingAt: ready.deviceAt,
    });
    expect(state.items.get(rosti.itemId)!.kitchen[STATION.kitchen]!.status).toBe('preparing');
  });

  it('the floor serving or voiding first is the normal race: no conflict, no change', () => {
    const { waiter, kds, orderId, rosti, beers, ops } = service();
    const serve = waiter.serve(orderId, beers.itemId);
    const voidRosti = waiter.op(
      'item.void',
      orderId,
      {
        itemId: rosti.itemId,
        quantity: 1,
        voidedItemId: freshId(),
        reason: 'guest_changed_mind',
        reasonText: null,
      },
      {
        approval: {
          approverUserId: USER.manager,
          permissions: ['order.void_item', 'approval.grant'],
        },
      },
    );
    kds.sees(serve, voidRosti);
    const late = [
      kds.kitchen('kitchen.ready', orderId, STATION.bar, beers.itemId),
      kds.kitchen('kitchen.start', orderId, STATION.kitchen, rosti.itemId),
    ];
    const state = foldOperations([...ops, serve, voidRosti, ...late], CONTEXT);
    expect(state.items.get(beers.itemId)!.prepStatus).toBe('served');
    expect(state.items.get(rosti.itemId)!.prepStatus).toBe('voided');
    expect(late.map((op) => state.outcomes.get(op.id))).toEqual(['applied', 'applied']);
  });

  it('a kitchen operation on an item not sent, or at a wrong station, is a conflict', () => {
    const waiter = new Device(TERMINAL.H1);
    const kds = new Device(TERMINAL.D1, USER.cook);
    const open = waiter.open();
    const pending = line({ stationIds: [STATION.kitchen] });
    const sent = line({ stationIds: [STATION.kitchen] });
    const base = [
      open,
      waiter.add(open.orderId, pending, sent),
      waiter.sendTo(open.orderId, [STATION.kitchen], sent.itemId),
    ];
    kds.sees(...base);
    const notSent = kds.kitchen('kitchen.ready', open.orderId, STATION.kitchen, pending.itemId);
    const wrongStation = kds.kitchen('kitchen.ready', open.orderId, STATION.bar, sent.itemId);
    const unknown = kds.kitchen('kitchen.ready', open.orderId, STATION.kitchen, freshId());
    const state = foldOperations([...base, notSent, wrongStation, unknown], CONTEXT);
    expect(state.conflicts.map((c) => c.code)).toEqual([
      'item_state',
      'item_state',
      'item_not_found',
    ]);
    expect(state.items.get(sent.itemId)!.prepStatus).toBe('sent');
  });

  it('only the kitchen moves kitchen items; the kitchen may also serve (RF-C22, RNF-10)', () => {
    const { waiter, kds, orderId, rosti, beers, ops } = service();
    const byWaiter = waiter.kitchen('kitchen.ready', orderId, STATION.kitchen, rosti.itemId);
    const serveByCook = kds.serve(orderId, beers.itemId);
    const state = foldOperations([...ops, byWaiter, serveByCook], CONTEXT);
    // Applied (it happened) but marked for the manager.
    expect(state.conflicts.map((c) => [c.opId, c.code])).toEqual([
      [byWaiter.id, 'approval_invalid'],
    ]);
    expect(state.items.get(beers.itemId)!.prepStatus).toBe('served');
  });

  it('the order still closes only when everything is served and paid (RN-12)', () => {
    const { waiter, kds, orderId, rosti, beers, menu, water, ops } = service();
    const all = [rosti.itemId, beers.itemId, menu.itemId, water.itemId];
    const ready = kds.kitchen('kitchen.ready', orderId, STATION.kitchen, rosti.itemId, menu.itemId);
    waiter.sees(ready);
    let state = foldOperations([...ops, ready, waiter.pay(orderId, 9200)], CONTEXT);
    expect(state.orders.get(orderId)!.status).toBe('open');
    state = foldOperations(
      [...ops, ready, waiter.serve(orderId, ...all), waiter.pay(orderId, 9200)],
      CONTEXT,
    );
    expect(state.orders.get(orderId)!.status).toBe('closed');
  });
});

describe('voids after sending (RN-13, RF-C10)', () => {
  it('a partial void keeps the voided part on the ticket, struck through', () => {
    const waiter = new Device(TERMINAL.H1);
    const open = waiter.open();
    const rosti = line({ quantity: 3, stationIds: [STATION.kitchen] });
    const add = waiter.add(open.orderId, rosti);
    const send = waiter.sendTo(open.orderId, [STATION.kitchen], rosti.itemId);
    const voidedItemId = freshId();
    const voidOne = waiter.op(
      'item.void',
      open.orderId,
      {
        itemId: rosti.itemId,
        quantity: 1,
        voidedItemId,
        reason: 'guest_changed_mind',
        reasonText: null,
      },
      {
        approval: {
          approverUserId: USER.manager,
          permissions: ['order.void_item', 'approval.grant'],
        },
      },
    );
    const state = foldOperations([open, add, send, voidOne], CONTEXT);
    const ticket = state.tickets.get(ticketKey(send.id, STATION.kitchen))!;
    expect(ticket.itemIds).toEqual([rosti.itemId, voidedItemId]);
    const view = ticketView(state, ticket, { now: at(60_000), alertAfterMinutes: 12 });
    expect(view.hasStorno).toBe(true);
    expect(view.items.map((i) => [i.quantity, i.status])).toEqual([
      [2, 'sent'],
      [1, 'voided'],
    ]);
    expect(view.status).toBe('sent');
  });

  it('a ticket with everything voided is voided and leaves the board', () => {
    const waiter = new Device(TERMINAL.H1);
    const open = waiter.open();
    const rosti = line({ stationIds: [STATION.kitchen] });
    const add = waiter.add(open.orderId, rosti);
    const send = waiter.sendTo(open.orderId, [STATION.kitchen], rosti.itemId);
    const voidOrder = waiter.op(
      'order.void',
      open.orderId,
      { reason: 'guest_changed_mind', reasonText: null },
      { approval: { approverUserId: USER.manager, permissions: ['order.void', 'approval.grant'] } },
    );
    const state = foldOperations([open, add, send, voidOrder], CONTEXT);
    const board = stationBoard(state, STATION.kitchen, { now: at(120_000), alertAfterMinutes: 12 });
    expect(board.active).toEqual([]);
    expect(board.done.map((t) => [t.status, t.finishedAt])).toEqual([
      ['voided', voidOrder.deviceAt],
    ]);
  });
});

describe('station board (RF-C20, RF-C24, RF-C28)', () => {
  it('lists active tickets oldest first and alerts exactly at the threshold', () => {
    const waiter = new Device(TERMINAL.H1);
    const first = waiter.open(freshId(), {}, 1);
    const second = waiter.open(freshId(), {}, 2);
    const a = line({ stationIds: [STATION.kitchen] });
    const b = line({ stationIds: [STATION.kitchen] });
    const ops = [
      first,
      second,
      waiter.add(first.orderId, a),
      waiter.add(second.orderId, b),
      waiter.sendTo(second.orderId, [STATION.kitchen], b.itemId),
      waiter.wait(60_000).sendTo(first.orderId, [STATION.kitchen], a.itemId),
    ];
    const state = foldOperations(ops, CONTEXT);
    const sentAt = Date.parse(ops[4]!.deviceAt);
    const board = (minutes: number) =>
      stationBoard(state, STATION.kitchen, {
        now: new Date(sentAt + minutes * 60_000).toISOString(),
        alertAfterMinutes: 12,
      });
    expect(board(5).active.map((t) => t.displayNumber)).toEqual(['0002', '0001']);
    expect(board(11.99).active.map((t) => t.alert)).toEqual([false, false]);
    // The second one was sent a minute (and a tick) later.
    expect(board(12).active.map((t) => [t.elapsedMinutes, t.alert])).toEqual([
      [12, true],
      [10, false],
    ]);
  });

  it('a finished ticket goes to the recall list for the window, and comes back with a recall', () => {
    const { kds, orderId, beers, ops } = service();
    const ready = kds.kitchen('kitchen.ready', orderId, STATION.bar, beers.itemId);
    const state = foldOperations([...ops, ready], CONTEXT);
    const now = (minutes: number) =>
      new Date(Date.parse(ready.deviceAt) + minutes * 60_000).toISOString();
    const board = stationBoard(state, STATION.bar, { now: now(1), alertAfterMinutes: 5 });
    expect(board.active).toEqual([]);
    expect(board.done.map((t) => [t.status, t.elapsedMinutes])).toEqual([['ready', 0]]);
    // Older than the window: out of the recall list.
    expect(stationBoard(state, STATION.bar, { now: now(181), alertAfterMinutes: 5 }).done).toEqual(
      [],
    );

    const recall = kds.kitchen('kitchen.recall', orderId, STATION.bar, beers.itemId);
    const back = foldOperations([...ops, ready, recall], CONTEXT);
    expect(
      stationBoard(back, STATION.bar, { now: now(2), alertAfterMinutes: 5 }).active,
    ).toHaveLength(1);
  });

  it('shows where an item went after a transfer, without moving the ticket', () => {
    const waiter = new Device(TERMINAL.H1);
    const from = waiter.open(freshId(), {}, 1);
    const to = waiter.open(freshId(), {}, 2);
    const rosti = line({ stationIds: [STATION.kitchen] });
    const add = waiter.add(from.orderId, rosti);
    const send = waiter.sendTo(from.orderId, [STATION.kitchen], rosti.itemId);
    const ops = [
      from,
      to,
      add,
      send,
      waiter.op('items.transfer', from.orderId, { itemIds: [rosti.itemId], toOrderId: to.orderId }),
    ];
    const state = foldOperations(ops, CONTEXT);
    const view = ticketView(state, state.tickets.get(ticketKey(send.id, STATION.kitchen))!, {
      now: at(0),
      alertAfterMinutes: 12,
    });
    expect(view.orderId).toBe(from.orderId);
    expect(view.items[0]!.movedToOrderId).toBe(to.orderId);
  });
});

describe('reprint, receipt print and cash drawer (RF-C26, RF-D18)', () => {
  it('a reprint counts on the ticket and is audited; an unknown ticket is a conflict', () => {
    const { kds, orderId, ops } = service();
    const send = ops[2]!;
    const reprint = kds.op('kitchen.reprint', orderId, {
      sendOperationId: send.id,
      stationId: STATION.kitchen,
    });
    const unknown = kds.op('kitchen.reprint', orderId, {
      sendOperationId: freshId(),
      stationId: STATION.kitchen,
    });
    const state = foldOperations([...ops, reprint, unknown], CONTEXT);
    expect(state.tickets.get(ticketKey(send.id, STATION.kitchen))!.reprintCount).toBe(1);
    expect(state.audits.filter((a) => a.action === 'kitchen.ticket_reprinted')).toHaveLength(1);
    expect(state.conflicts.map((c) => [c.opId, c.code])).toEqual([[unknown.id, 'item_not_found']]);
  });

  it('printing a receipt changes nothing; an unknown receipt is a conflict', () => {
    const cashier = new Device(TERMINAL.K1, USER.cashier);
    const open = cashier.open();
    const item = line();
    const add = cashier.add(open.orderId, item);
    const pay = cashier.pay(open.orderId, 2450);
    const print = cashier.op('receipt.print', open.orderId, {
      receiptId: pay.payload.receipt.receiptId,
    });
    const wrong = cashier.op('receipt.print', open.orderId, { receiptId: freshId() });
    const ops = [open, add, pay];
    const before = foldOperations(ops, CONTEXT);
    const after = foldOperations([...ops, print, wrong], CONTEXT);
    expect(after.orders.get(open.orderId)).toEqual(before.orders.get(open.orderId));
    expect(after.conflicts.map((c) => [c.opId, c.code])).toEqual([[wrong.id, 'item_not_found']]);
  });

  it('opening the drawer without a sale needs the permission or a manager, and is audited', () => {
    const waiter = new Device(TERMINAL.K1, USER.waiter);
    const alone = waiter.op('drawer.open', null, { reason: 'Wechselgeld' });
    const approved = waiter.op(
      'drawer.open',
      null,
      { reason: 'Wechselgeld' },
      { approval: { approverUserId: USER.manager, permissions: ['cash.open_drawer'] } },
    );
    const state = foldOperations([alone, approved], CONTEXT);
    expect(state.conflicts.map((c) => [c.opId, c.code])).toEqual([[alone.id, 'approval_invalid']]);
    expect(state.audits.map((a) => [a.action, a.reason, a.authorizedByUserId])).toEqual([
      ['cash.drawer_opened', 'Wechselgeld', null],
      ['cash.drawer_opened', 'Wechselgeld', USER.manager],
    ]);
  });
});
