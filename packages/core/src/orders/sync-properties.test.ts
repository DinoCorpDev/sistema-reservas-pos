import { describe, expect, it } from 'vitest';
import { compareOperations } from '../shared/hlc';
import { operationsOfGroup, orderGroups } from './groups';
import type { Operation } from './operations';
import { applyOperations, foldOperations, sortsAfter } from './reducer';
import { createFoldState, itemsOf } from './state';
import {
  beer,
  CONTEXT,
  Device,
  freshId,
  line,
  projection,
  random,
  shuffle,
  STATION,
  TABLE,
  TERMINAL,
  USER,
} from './test-kit';
import { ticketProgress } from '../kitchen/tickets';

/**
 * Property tests of the sync rules (docs/SYNC.md §4-§5, RNF-03, RNF-04). A random history is
 * produced by three terminals working offline: each one only sees a random part of what the
 * others did (partial pulls) and acts on what it sees. Whatever order the operations then reach
 * a node in, the fold must be identical, nothing may be applied twice and no payment may be lost.
 */

function history(seed: number, steps = 45): Operation[] {
  const next = random(seed);
  const pick = <T>(items: readonly T[]): T | undefined =>
    items.length === 0 ? undefined : items[Math.floor(next() * items.length)];
  const devices = [
    { device: new Device(TERMINAL.K1, USER.cashier), visible: [] as Operation[], seen: 0 },
    { device: new Device(TERMINAL.H1, USER.waiter), visible: [] as Operation[], seen: 0 },
    { device: new Device(TERMINAL.H2, USER.manager), visible: [] as Operation[], seen: 0 },
    // The KDS of the kitchen (Phase 3): it only moves kitchen tickets and serves.
    { device: new Device(TERMINAL.D1, USER.cook), visible: [] as Operation[], seen: 0 },
  ];
  const food = () =>
    line({
      quantity: 1 + Math.floor(next() * 3),
      stationIds: next() < 0.3 ? [STATION.kitchen, STATION.dessert] : [STATION.kitchen],
    });
  const all: Operation[] = [];
  let number = 1;

  for (let step = 0; step < steps; step += 1) {
    const actor = pick(devices)!;
    // Partial pull: the terminal catches up on a random prefix of what happened elsewhere.
    const upTo = actor.seen + Math.floor(next() * (all.length - actor.seen + 1));
    for (const op of all.slice(actor.seen, upTo)) {
      if (!actor.visible.includes(op)) actor.visible.push(op);
      actor.device.sees(op);
    }
    actor.seen = upTo;
    actor.device.wait(Math.floor(next() * 20_000));

    const state = foldOperations(actor.visible, CONTEXT);
    const open = [...state.orders.values()].filter((o) => o.status === 'open');
    const closed = [...state.orders.values()].filter((o) => o.status === 'closed');
    const order = pick(open);
    const items = order ? itemsOf(state, order.id).filter((i) => i.prepStatus !== 'voided') : [];
    const item = pick(items);
    const d = actor.device;
    const manager = { approverUserId: USER.manager, permissions: ['approval.grant' as const] };

    if (d.terminalId === TERMINAL.D1) {
      // Kitchen: work on a random ticket of the stations it sees.
      const ticket = pick([...state.tickets.values()]);
      const ticketItems = ticket ? ticket.itemIds.filter(() => next() < 0.7) : [];
      const kitchenOps: (() => Operation | null)[] = [
        () =>
          ticket && ticketItems.length > 0
            ? d.kitchen('kitchen.start', ticket.orderId, ticket.stationId, ...ticketItems)
            : null,
        () =>
          ticket && ticketItems.length > 0
            ? d.kitchen('kitchen.ready', ticket.orderId, ticket.stationId, ...ticketItems)
            : null,
        () =>
          ticket && ticketItems.length > 0
            ? d.kitchen('kitchen.recall', ticket.orderId, ticket.stationId, ...ticketItems)
            : null,
        () => (ticket && ticketItems.length > 0 ? d.serve(ticket.orderId, ...ticketItems) : null),
        () =>
          ticket
            ? d.op('kitchen.reprint', ticket.orderId, {
                sendOperationId: ticket.sendOperationId,
                stationId: ticket.stationId,
              })
            : null,
      ];
      const op = pick(kitchenOps)!();
      if (op) {
        all.push(op);
        actor.visible.push(op);
      }
      continue;
    }

    const actions: (() => Operation | null)[] = [
      () =>
        open.length < 4
          ? d.open(freshId(), { tableId: pick(Object.values(TABLE))! }, number++)
          : null,
      () =>
        order ? d.add(order.id, next() < 0.5 ? food() : beer({ stationIds: [STATION.bar] })) : null,
      () => {
        if (!order || items.length === 0) return null;
        const stations = [...new Set(items.flatMap((i) => i.stationIds))];
        // Now and then a station is left out, as when it is inactive, or the kitchen stands in
        // for a station nobody attends (DEC-033).
        const routed = stations.filter(() => next() < 0.9);
        const absent = stations.filter((s) => !routed.includes(s) && s !== STATION.kitchen);
        const standIn = next() < 0.5 ? absent : [];
        const tickets = routed.map((stationId) => ({ stationId, replaces: [] as string[] }));
        if (standIn.length > 0) {
          const kitchen = tickets.find((t) => t.stationId === STATION.kitchen);
          if (kitchen) kitchen.replaces = standIn;
          else tickets.push({ stationId: STATION.kitchen, replaces: standIn });
        }
        return d.sendRouted(order.id, tickets, ...items.map((i) => i.id));
      },
      () => (order && item ? d.serve(order.id, item.id) : null),
      () =>
        order && item
          ? d.op(
              'item.void',
              order.id,
              {
                itemId: item.id,
                quantity: 1,
                voidedItemId: freshId(),
                reason: 'entry_error',
                reasonText: null,
              },
              { approval: manager },
            )
          : null,
      () =>
        order
          ? d.op(
              'discount.apply',
              order.id,
              {
                discountId: freshId(),
                itemId: next() < 0.5 && item ? item.id : null,
                kind: next() < 0.5 ? 'percent' : 'amount',
                value: 100 + Math.floor(next() * 1500),
                reasonCode: 'promotion',
                reasonText: null,
              },
              { approval: manager },
            )
          : null,
      () =>
        order && order.balanceRappen > 0
          ? d.pay(order.id, next() < 0.5 ? order.balanceRappen : Math.ceil(order.balanceRappen / 2))
          : null,
      () => {
        const target = pick(open.filter((o) => o.id !== order?.id));
        return order && target && item
          ? d.op('items.transfer', order.id, { itemIds: [item.id], toOrderId: target.id })
          : null;
      },
      () => {
        const target = pick(open.filter((o) => o.id !== order?.id));
        return order && target ? d.op('order.merge', order.id, { intoOrderId: target.id }) : null;
      },
      () =>
        order && item
          ? d.op('order.split', order.id, {
              newOrderId: freshId(),
              itemIds: [item.id],
              number: {
                businessDate: '2026-10-06',
                number,
                prefix: 'H1',
                display: `H1-${number++}`,
              },
            })
          : null,
      () => (order ? d.op('order.update', order.id, { guestCount: Math.floor(next() * 8) }) : null),
      () => {
        const target = pick(closed);
        return target
          ? d.op('order.reopen', target.id, { reason: 'Korrektur' }, { approval: manager })
          : null;
      },
      () => {
        const payment = pick([...state.payments.values()]);
        return payment
          ? d.op(
              'refund.record',
              payment.orderId,
              {
                refundId: freshId(),
                paymentId: payment.id,
                method: payment.method,
                adapter: payment.adapter,
                amountRappen: Math.max(1, Math.floor(payment.amountRappen / 2)),
                tipRappen: 0,
                reason: 'Reklamation',
                externalReference: null,
              },
              { approval: manager },
            )
          : null;
      },
    ];

    const op = pick(actions)!();
    if (!op) continue;
    all.push(op);
    actor.visible.push(op);
  }
  return all;
}

describe('sync properties (docs/SYNC.md)', () => {
  it('the random histories exercise every kind of operation and real conflicts', () => {
    const types = new Set<string>();
    const conflictCodes = new Set<string>();
    // Long histories: closing an order (served and paid) and reopening it take many steps.
    for (let seed = 1; seed <= 100; seed += 1) {
      const ops = history(seed, 120);
      for (const op of ops) types.add(op.type);
      for (const conflict of foldOperations(ops, CONTEXT).conflicts)
        conflictCodes.add(conflict.code);
    }
    expect([...types].sort()).toEqual(
      [
        'discount.apply',
        'item.void',
        'items.add',
        'items.send',
        'items.serve',
        'items.transfer',
        'kitchen.ready',
        'kitchen.recall',
        'kitchen.reprint',
        'kitchen.start',
        'order.merge',
        'order.open',
        'order.reopen',
        'order.split',
        'order.update',
        'payment.record',
        'refund.record',
      ].sort(),
    );
    // Concurrency produces the conflicts of SYNC.md §5, not just happy paths.
    expect(conflictCodes.size).toBeGreaterThanOrEqual(3);
  });

  it('any arrival order folds to the same state: 1000 permutations of 50 histories', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const ops = history(seed);
      const expected = projection(foldOperations(ops, CONTEXT));
      const next = random(seed * 7919);
      for (let run = 0; run < 20; run += 1) {
        expect(projection(foldOperations(shuffle(ops, next), CONTEXT))).toEqual(expected);
      }
    }
  });

  it('a duplicated delivery has the effect of a single one (idempotency, RNF-03)', () => {
    for (let seed = 100; seed < 130; seed += 1) {
      const ops = history(seed);
      const next = random(seed);
      const duplicated = shuffle([...ops, ...ops.filter(() => next() < 0.5)], next);
      expect(projection(foldOperations(duplicated, CONTEXT))).toEqual(
        projection(foldOperations(ops, CONTEXT)),
      );
    }
  });

  it('never loses a payment and never throws, whatever the history (RNF-04)', () => {
    for (let seed = 200; seed < 260; seed += 1) {
      const ops = history(seed, 60);
      const state = foldOperations(ops, CONTEXT);
      const paymentOps = ops.filter((op) => op.type === 'payment.record');
      expect(state.payments.size).toBe(paymentOps.length);
      for (const op of paymentOps) {
        expect(state.receipts.has(op.payload.receipt.receiptId)).toBe(true);
      }
      expect(state.outcomes.size).toBe(new Set(ops.map((op) => op.id)).size);
    }
  });

  it('applying in order, incrementally, equals folding from scratch', () => {
    for (let seed = 300; seed < 320; seed += 1) {
      const ops = history(seed);
      const state = createFoldState();
      const sorted = [...ops].sort(compareOperations);
      for (let start = 0; start < sorted.length; start += 7) {
        const chunk = sorted.slice(start, start + 7);
        expect(sortsAfter(state, chunk[0]!)).toBe(true);
        applyOperations(state, chunk, CONTEXT);
      }
      expect(projection(state)).toEqual(projection(foldOperations(ops, CONTEXT)));
    }
  });

  it('folding one group of connected orders gives what folding the location gives (server)', () => {
    for (let seed = 500; seed < 560; seed += 1) {
      const ops = history(seed, 60);
      const whole = foldOperations(ops, CONTEXT);
      for (const group of orderGroups(ops)) {
        const ids = new Set(group);
        const part = foldOperations(operationsOfGroup(ops, ids), CONTEXT);
        const pick = <T extends { id: string; orderId?: string }>(
          map: Map<string, T>,
          key: (v: T) => string,
        ) =>
          [...map.values()].filter((v) => ids.has(key(v))).sort((a, b) => (a.id < b.id ? -1 : 1));
        expect(pick(part.orders, (o) => o.id)).toEqual(pick(whole.orders, (o) => o.id));
        expect(pick(part.items, (i) => i.orderId)).toEqual(pick(whole.items, (i) => i.orderId));
        expect(pick(part.payments, (p) => p.orderId)).toEqual(
          pick(whole.payments, (p) => p.orderId),
        );
        expect(pick(part.refunds, (r) => r.orderId)).toEqual(pick(whole.refunds, (r) => r.orderId));
        expect(pick(part.discounts, (d) => d.orderId)).toEqual(
          pick(whole.discounts, (d) => d.orderId),
        );
        const tickets = (state: typeof whole) =>
          [...state.tickets.values()]
            .filter((t) => ids.has(t.orderId))
            .sort((a, b) => (a.key < b.key ? -1 : 1))
            .map((t) => ({ ...t, progress: ticketProgress(state, t) }));
        expect(tickets(part)).toEqual(tickets(whole));
        for (const op of operationsOfGroup(ops, ids)) {
          expect(part.outcomes.get(op.id)).toBe(whole.outcomes.get(op.id));
        }
      }
    }
  });

  it('no kitchen ticket changes on its own: only an operation on its items moves it (gate)', () => {
    // Items an operation acts on; an order-wide operation acts on all items of its order.
    const touchedItems = (op: Operation, state: ReturnType<typeof foldOperations>) => {
      switch (op.type) {
        case 'items.send':
        case 'items.serve':
        case 'kitchen.start':
        case 'kitchen.ready':
        case 'kitchen.recall':
          return new Set(op.payload.itemIds);
        case 'item.void':
          return new Set([op.payload.itemId, op.payload.voidedItemId]);
        case 'order.void':
          return new Set(itemsOf(state, op.orderId).map((i) => i.id));
        default:
          return new Set<string>();
      }
    };
    for (let seed = 600; seed < 640; seed += 1) {
      const sorted = [...history(seed, 70)].sort(compareOperations);
      const state = createFoldState();
      const snapshot = () =>
        new Map(
          [...state.tickets.values()].map((t) => [t.key, JSON.stringify(ticketProgress(state, t))]),
        );
      let before = snapshot();
      for (const op of sorted) {
        applyOperations(state, [op], CONTEXT);
        const after = snapshot();
        const acted = touchedItems(op, state);
        for (const [key, progress] of after) {
          if (before.get(key) === progress) continue;
          const ticket = state.tickets.get(key)!;
          // A new ticket comes from a send; a changed one shares an item with the operation.
          const explained = before.has(key)
            ? ticket.itemIds.some((id) => acted.has(id))
            : op.type === 'items.send' && ticket.sendOperationId === op.id;
          expect(explained, `${op.type} changed ticket ${key}`).toBe(true);
        }
        // Tickets never disappear.
        for (const key of before.keys()) expect(after.has(key)).toBe(true);
        before = after;
      }
    }
  });

  it('every order keeps its money consistent: total = Σ lines, balance = total − paid', () => {
    for (let seed = 400; seed < 440; seed += 1) {
      const state = foldOperations(history(seed, 60), CONTEXT);
      for (const order of state.orders.values()) {
        const lines = itemsOf(state, order.id).filter((i) => i.prepStatus !== 'voided');
        expect(order.totalRappen).toBe(lines.reduce((sum, l) => sum + l.lineTotalRappen, 0));
        expect(order.taxTotalRappen).toBe(lines.reduce((sum, l) => sum + l.taxRappen, 0));
        expect(order.balanceRappen).toBe(order.totalRappen - order.paidRappen);
        for (const l of lines) {
          expect(l.lineTotalRappen).toBe(l.grossRappen - l.discountRappen);
          expect(l.discountRappen).toBeGreaterThanOrEqual(0);
          expect(l.lineTotalRappen).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
