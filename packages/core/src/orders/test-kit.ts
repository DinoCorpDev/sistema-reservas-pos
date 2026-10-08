/**
 * Test kit of the order engine (not exported from the package): ids, devices with their own
 * clocks, line snapshots and an operation factory. Only *.test.ts files import it.
 */
import { DEFAULT_ROLE_PERMISSIONS, type Permission } from '../organization/permissions';
import { DEFAULT_LOCATION_SETTINGS } from '../organization/settings';
import type { ReceiptContent } from '../receipts/content';
import { formatHlc, HLC_ZERO, type HlcState, receiveHlc, tickHlc } from '../shared/hlc';
import { orderNumber } from './numbering';
import {
  type LineSnapshot,
  type Operation,
  type OperationApproval,
  type OperationOf,
  type OperationType,
  OPERATION_SCHEMA_VERSION,
} from './operations';
import type { FoldContext } from './reducer';
import type { FoldState } from './state';

/** Deterministic UUID v7-shaped ids for tests: `uid(5)` → `…-000000000005`. */
export function uid(n: number): string {
  return `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
}

let nextId = 10_000;
export const freshId = () => uid(nextId++);

export const ORG = uid(1);
export const LOC = uid(2);
export const TERMINAL = { K1: uid(10), H1: uid(11), H2: uid(12), D1: uid(13) } as const;
export const USER = {
  waiter: uid(20),
  waiter2: uid(21),
  manager: uid(22),
  cashier: uid(23),
  inactive: uid(24),
  cook: uid(25),
} as const;
export const TABLE = { t1: uid(30), t2: uid(31), t3: uid(32) } as const;
export const STATION = { kitchen: uid(40), bar: uid(41), dessert: uid(42) } as const;

const permissions = new Map<string, ReadonlySet<Permission>>([
  [USER.waiter, new Set(DEFAULT_ROLE_PERMISSIONS.waiter)],
  [USER.waiter2, new Set(DEFAULT_ROLE_PERMISSIONS.waiter)],
  [USER.manager, new Set(DEFAULT_ROLE_PERMISSIONS.manager)],
  [USER.cashier, new Set(DEFAULT_ROLE_PERMISSIONS.cashier)],
  [USER.cook, new Set(DEFAULT_ROLE_PERMISSIONS.kitchen)],
]);

export const CONTEXT: FoldContext = {
  settings: DEFAULT_LOCATION_SETTINGS,
  permissionsOf: (userId) => permissions.get(userId) ?? null,
};

export const T0 = Date.UTC(2026, 9, 6, 18, 0, 0); // 20:00 in Zurich
export const BUSINESS_DATE = '2026-10-06';

/** A sold line with sensible defaults: Berner Rösti, CHF 24.50, food at 8.1 %. */
export function line(overrides: Partial<LineSnapshot> = {}): LineSnapshot {
  return {
    itemId: freshId(),
    productId: uid(500),
    variantId: null,
    name: 'Berner Rösti',
    variantName: null,
    quantity: 1,
    unitPriceRappen: 2450,
    modifiers: [],
    taxCategoryKey: 'food',
    taxRateCode: 'normal',
    taxRateBp: 810,
    course: 1,
    seat: null,
    note: null,
    stationIds: [],
    ...overrides,
  };
}

export const beer = (overrides: Partial<LineSnapshot> = {}) =>
  line({
    productId: uid(501),
    name: 'Bier',
    unitPriceRappen: 650,
    taxCategoryKey: 'alcoholic_beverage',
    ...overrides,
  });

/** Receipt content is opaque to the reducer; tests that check receipts build real ones. */
export const DUMMY_RECEIPT = {} as ReceiptContent;

type PayloadOf<T extends OperationType> = OperationOf<T>['payload'];

/** A terminal with its own clock and user; every `op()` ticks its HLC. */
export class Device {
  private clock: HlcState = HLC_ZERO;
  nowMs: number;

  constructor(
    readonly terminalId: string,
    readonly userId: string = USER.waiter,
    startMs = T0,
  ) {
    this.nowMs = startMs;
  }

  /** Advances the wall clock of this device. */
  wait(ms: number): this {
    this.nowMs += ms;
    return this;
  }

  /** This device sees operations of others (pull): later operations sort after them. */
  sees(...ops: readonly Operation[]): this {
    for (const op of ops) this.clock = receiveHlc(this.clock, op.hlc);
    return this;
  }

  op<T extends OperationType>(
    type: T,
    orderId: string | null,
    payload: PayloadOf<T>,
    options: {
      userId?: string | null;
      approval?: OperationApproval;
      id?: string;
      schemaVersion?: number;
    } = {},
  ): OperationOf<T> {
    this.clock = tickHlc(this.clock, this.nowMs);
    this.nowMs += 1;
    return {
      id: options.id ?? freshId(),
      schemaVersion: options.schemaVersion ?? OPERATION_SCHEMA_VERSION,
      hlc: formatHlc(this.clock),
      deviceAt: new Date(this.clock.physical).toISOString(),
      organizationId: ORG,
      locationId: LOC,
      terminalId: this.terminalId,
      userId: options.userId === undefined ? this.userId : options.userId,
      approval: options.approval ?? null,
      orderId,
      type,
      payload,
    } as unknown as OperationOf<T>;
  }

  open(
    orderId = freshId(),
    fields: Partial<PayloadOf<'order.open'>> = {},
    number = 1,
  ): OperationOf<'order.open'> {
    return this.op('order.open', orderId, {
      channel: 'table',
      consumptionType: 'on_premise',
      tableId: TABLE.t1,
      guestCount: 2,
      waiterUserId: this.userId,
      customerName: null,
      number: orderNumber(BUSINESS_DATE, number),
      ...fields,
    });
  }

  add(orderId: string, ...items: LineSnapshot[]) {
    return this.op('items.add', orderId, { items });
  }

  /** Sends to the kitchen; the items go to `stations` (one new ticket per station). */
  send(orderId: string, ...itemIds: string[]) {
    return this.sendTo(orderId, [], ...itemIds);
  }

  sendTo(orderId: string, stationIds: readonly string[], ...itemIds: string[]) {
    return this.op('items.send', orderId, {
      itemIds,
      tickets: stationIds.map((stationId) => ({
        ticketId: freshId(),
        stationId,
        language: 'de' as const,
      })),
    });
  }

  kitchen(
    type: 'kitchen.start' | 'kitchen.ready' | 'kitchen.recall',
    orderId: string,
    stationId: string,
    ...itemIds: string[]
  ) {
    return this.op(type, orderId, { stationId, itemIds });
  }

  serve(orderId: string, ...itemIds: string[]) {
    return this.op('items.serve', orderId, { itemIds });
  }

  pay(
    orderId: string,
    amountRappen: number,
    fields: Partial<Omit<PayloadOf<'payment.record'>, 'receipt'>> = {},
  ) {
    const paymentId = fields.paymentId ?? freshId();
    return this.op('payment.record', orderId, {
      paymentId,
      method: 'card',
      adapter: 'external-terminal',
      amountRappen,
      tipRappen: 0,
      tipUserId: null,
      roundingRappen: 0,
      tenderedRappen: null,
      changeRappen: 0,
      externalReference: null,
      splitLabel: null,
      ...fields,
      receipt: {
        receiptId: freshId(),
        receiptNumber: `K1-261006-${String(nextId).padStart(4, '0')}`,
        language: 'de',
        content: DUMMY_RECEIPT,
        contentHash: '0'.repeat(64),
        customerName: null,
        customerAddress: null,
      },
    });
  }
}

/** Plain, order-independent view of a fold, for comparing two folds. */
export function projection(state: FoldState) {
  const sorted = <T extends { id: string }>(map: Map<string, T>) =>
    [...map.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    orders: sorted(state.orders),
    items: sorted(state.items),
    discounts: sorted(state.discounts),
    payments: sorted(state.payments),
    refunds: sorted(state.refunds),
    receipts: sorted(state.receipts),
    tickets: [...state.tickets.values()].sort((a, b) => (a.key < b.key ? -1 : 1)),
    outcomes: [...state.outcomes.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
    conflicts: [...state.conflicts].map((c) => `${c.opId}:${c.code}:${c.entityId}`).sort(),
  };
}

/** Deterministic pseudo-random generator (mulberry32) for property tests. */
export function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], next: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
