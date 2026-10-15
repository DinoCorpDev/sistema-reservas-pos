import {
  businessDate,
  buildReceipt,
  extractTax,
  formatHlc,
  HLC_ZERO,
  type HlcState,
  type LineSnapshot,
  newId,
  formatReceiptNumber,
  OPERATION_SCHEMA_VERSION,
  orderNumber,
  rappen,
  receiptContentHash,
  receiveHlc,
  tickHlc,
} from '@pos/core';
import {
  applyOrganizationTemplate,
  createDb,
  type Database,
  hashPassword,
  newPinKey,
  pinLookup,
  schema as s,
} from '@pos/db';
import { testDatabaseUrl } from '@pos/db/testing';
import { eq } from 'drizzle-orm';
import type { BackofficeSession } from './auth/resolve-actor';
import { createApiApp } from './http/app';

/**
 * Test harness for API integration tests: the real Hono app against the MySQL test database,
 * with a fake backoffice session selected by the `x-test-session` header.
 */
export function createTestApi() {
  const { db, pool } = createDb(testDatabaseUrl(), { connectionLimit: 4 });
  const sessions = new Map<string, BackofficeSession>();
  const app = createApiApp({
    db,
    resolveSession: async (request) =>
      sessions.get(request.headers.get('x-test-session') ?? '') ?? null,
  });

  /** Headers that sign the request in as this backoffice session. */
  const as = (session: BackofficeSession): Record<string, string> => {
    const key = newId();
    sessions.set(key, session);
    return { 'x-test-session': key };
  };

  const request = (
    method: string,
    path: string,
    init: { headers?: Record<string, string>; body?: unknown } = {},
  ) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...init.headers },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });

  return { app, db, as, request, close: () => pool.end() };
}

export interface DemoContext {
  organizationId: string;
  locationId: string;
  users: Record<'admin' | 'manager' | 'cashier' | 'waiter' | 'waiter2' | 'kitchen', { id: string }>;
}

/** Ids of the seeded "Restaurant Demo Zürich" and its users. */
export async function loadDemo(db: Database): Promise<DemoContext> {
  const [org] = await db
    .select()
    .from(s.organizations)
    .where(eq(s.organizations.slug, 'demo-gastro'));
  if (!org) throw new Error('Demo organization missing: the test database setup did not run');
  const [location] = await db
    .select()
    .from(s.locations)
    .where(eq(s.locations.organizationId, org.id));
  const users = await db.select().from(s.users).where(eq(s.users.organizationId, org.id));
  const byName = (name: string) => {
    const user = users.find((u) => u.displayName === name);
    if (!user) throw new Error(`Demo user ${name} missing`);
    return { id: user.id };
  };
  return {
    organizationId: org.id,
    locationId: location!.id,
    users: {
      admin: byName('Sandra Keller'),
      manager: byName('Marco Brunner'),
      cashier: byName('Lea Meier'),
      waiter: byName('Anna Huber'),
      waiter2: byName('Luca Rossi'),
      kitchen: byName('Jonas Weber'),
    },
  };
}

/** Backoffice session of a demo user at the demo location. */
export const demoSession = (
  demo: DemoContext,
  user: keyof DemoContext['users'],
): BackofficeSession => ({
  kind: 'user',
  userId: demo.users[user].id,
  organizationId: demo.organizationId,
  locationId: demo.locationId,
});

type TestApi = ReturnType<typeof createTestApi>;

export interface PairedTerminal {
  id: string;
  deviceToken: string;
  prefix: string;
}

/** Creates a terminal of the demo location as `adminHeaders` and pairs it (RF-A06). */
export async function pairTerminal(
  api: Pick<TestApi, 'request'>,
  adminHeaders: Record<string, string>,
  options: {
    prefix: string;
    type?: 'pos' | 'handheld' | 'hub' | 'kds';
    name?: string;
    kitchenStationId?: string | null;
    receiptPrinterId?: string | null;
  },
): Promise<PairedTerminal> {
  const created = await api.request('POST', '/terminals', {
    headers: adminHeaders,
    body: {
      name: options.name ?? `Test ${options.prefix}`,
      type: options.type ?? 'pos',
      orderNumberPrefix: options.prefix,
      kitchenStationId: options.kitchenStationId ?? null,
      receiptPrinterId: options.receiptPrinterId ?? null,
    },
  });
  if (created.status !== 201) throw new Error(`Terminal not created: ${created.status}`);
  const { id } = (await created.json()) as { id: string };
  const issued = await api.request('POST', `/terminals/${id}/pairing-code`, {
    headers: adminHeaders,
  });
  const { code } = (await issued.json()) as { code: string };
  const paired = await api.request('POST', '/terminals/pair', { body: { code } });
  if (paired.status !== 200) throw new Error(`Terminal not paired: ${paired.status}`);
  const { deviceToken } = (await paired.json()) as { deviceToken: string };
  return { id, deviceToken, prefix: options.prefix };
}

/** A sold line for sync tests: CHF 24.50 food at 8.1 %. */
export function testLine(overrides: Partial<LineSnapshot> = {}): LineSnapshot {
  return {
    itemId: newId(),
    productId: newId(),
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

/**
 * A paired device that produces real operations (docs/SYNC.md §2): UUID v7 ids, its own hybrid
 * logical clock, frozen payloads and valid receipts.
 */
export class TestDevice {
  private clock: HlcState = HLC_ZERO;
  private receipts = 0;
  /** Business day of the demo location now (it starts at 04:00 in Zurich, DEC-022). */
  readonly businessDate = businessDate(new Date(), 'Europe/Zurich', '04:00');

  constructor(
    readonly scope: { organizationId: string; locationId: string },
    readonly terminal: PairedTerminal,
    readonly userId: string,
  ) {}

  get headers(): Record<string, string> {
    return { 'x-terminal-token': this.terminal.deviceToken };
  }

  sees(...ops: readonly { hlc: string }[]): this {
    for (const op of ops) this.clock = receiveHlc(this.clock, op.hlc);
    return this;
  }

  op<O extends string | null>(
    type: string,
    orderId: O,
    payload: Record<string, unknown>,
    options: {
      userId?: string | null;
      approval?: { approverUserId: string; permissions: string[] };
    } = {},
  ) {
    this.clock = tickHlc(this.clock, Date.now());
    return {
      id: newId(),
      schemaVersion: OPERATION_SCHEMA_VERSION,
      hlc: formatHlc(this.clock),
      deviceAt: new Date(this.clock.physical).toISOString(),
      organizationId: this.scope.organizationId,
      locationId: this.scope.locationId,
      terminalId: this.terminal.id,
      userId: options.userId === undefined ? this.userId : options.userId,
      approval: options.approval ?? null,
      orderId,
      type,
      payload,
    };
  }

  open(orderId: string = newId(), number = 1, fields: Record<string, unknown> = {}) {
    return this.op('order.open', orderId, {
      channel: 'table',
      consumptionType: 'on_premise',
      tableId: null,
      guestCount: 2,
      waiterUserId: this.userId,
      customerName: null,
      number: orderNumber(this.businessDate, number, this.terminal.prefix),
      ...fields,
    });
  }

  /** Sends items to the kitchen with one new ticket per station (items.send v2, DEC-029). */
  send(orderId: string, itemIds: string[], stationIds: readonly string[] = []) {
    return this.op('items.send', orderId, {
      itemIds,
      tickets: stationIds.map((stationId) => ({ ticketId: newId(), stationId, language: 'de' })),
    });
  }

  kitchen(
    type: 'kitchen.start' | 'kitchen.ready' | 'kitchen.recall',
    orderId: string,
    stationId: string,
    itemIds: string[],
  ) {
    return this.op(type, orderId, { stationId, itemIds });
  }

  /** A payment with its receipt: one line at 8.1 % whose MWST is extracted (RN-01). */
  async pay(orderId: string, amountRappen: number, fields: Record<string, unknown> = {}) {
    this.receipts += 1;
    const method = (fields.method as 'cash' | 'card' | undefined) ?? 'card';
    const tipRappen = (fields.tipRappen as number | undefined) ?? 0;
    const roundingRappen = (fields.roundingRappen as number | undefined) ?? 0;
    const receiptNumber = formatReceiptNumber(
      this.terminal.prefix,
      this.businessDate,
      this.receipts,
    );
    const content = buildReceipt({
      language: 'de',
      location: {
        name: 'Restaurant Demo Zürich',
        legalName: null,
        street: 'Bahnhofstrasse 1',
        postalCode: '8001',
        city: 'Zürich',
        vatUid: 'CHE-123.456.788',
        header: null,
        footer: null,
      },
      receiptNumber,
      orderNumber: '0001',
      tableLabel: null,
      servedBy: null,
      timeZone: 'Europe/Zurich',
      issuedAt: new Date().toISOString(),
      order: {
        subtotalRappen: rappen(amountRappen),
        discountTotalRappen: rappen(0),
        totalRappen: rappen(amountRappen),
      },
      lines: [
        {
          name: 'Berner Rösti',
          variantName: null,
          quantity: 1,
          unitPriceRappen: rappen(amountRappen),
          modifiers: [],
          discountRappen: rappen(0),
          lineTotalRappen: rappen(amountRappen),
          taxRappen: extractTax(rappen(amountRappen), 810),
          taxRateCode: 'normal',
          taxRateBp: 810,
        },
      ],
      payment: {
        method,
        amountRappen: rappen(amountRappen),
        tipRappen: rappen(tipRappen),
        roundingRappen: rappen(roundingRappen),
        tenderedRappen: null,
        changeRappen: rappen(0),
        splitLabel: null,
      },
      paidBeforeRappen: rappen(0),
      customer: null,
      customerNameFromRappen: 40000,
    });
    return this.op('payment.record', orderId, {
      paymentId: newId(),
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
        receiptId: newId(),
        receiptNumber,
        language: 'de',
        content,
        contentHash: await receiptContentHash(content),
        customerName: null,
        customerAddress: null,
      },
    });
  }

  /** A cash payment into a shift: `amount` paid with a CHF 100 note, rounded to 0.05. */
  cashPay(orderId: string, amountRappen: number, shiftId: string | null, tipRappen = 0) {
    const total = amountRappen + tipRappen;
    const rounded = Math.round(total / 5) * 5;
    return this.pay(orderId, amountRappen, {
      method: 'cash',
      adapter: 'cash',
      tipRappen,
      roundingRappen: rounded - total,
      tenderedRappen: 10000,
      changeRappen: 10000 - rounded,
      shiftId,
      businessDate: this.businessDate,
    });
  }

  /** Opens this terminal's till, or with `cashierUserId` that person's wallet (DEC-038). */
  openShift(shiftId: string = newId(), openingFloatRappen = 20000, cashierUserId?: string) {
    return this.op('shift.open', null, {
      shiftId,
      scope: cashierUserId ? 'personal' : 'terminal',
      cashierUserId: cashierUserId ?? null,
      businessDate: this.businessDate,
      openingFloatRappen,
      openingCount: null,
    });
  }

  movement(shiftId: string, kind: string, amountRappen: number, reason = 'Test') {
    return this.op('cash.movement', null, {
      movementId: newId(),
      shiftId,
      businessDate: this.businessDate,
      kind,
      amountRappen,
      reason,
      dailyClosingId: null,
    });
  }

  /** Closes a shift counting `counted` in CHF 0.05 coins; a difference gets a comment. */
  closeShift(shiftId: string, expectedCashRappen: number, countedCashRappen = expectedCashRappen) {
    const now = new Date().toISOString();
    return this.op('shift.close', null, {
      shiftId,
      businessDate: this.businessDate,
      countByDenomination: { '5': countedCashRappen / 5 },
      countedCashRappen,
      expectedCashRappen,
      differenceComment: countedCashRappen === expectedCashRappen ? null : 'Differenz',
      hubPrint: false,
      report: {
        version: 1,
        scope: 'terminal',
        ownerName: 'Test',
        businessDate: this.businessDate,
        openedAt: now,
        closedAt: now,
        timeZone: 'Europe/Zurich',
        payments: [],
        refunds: [],
        taxes: [],
        discountsRappen: 0,
        discountCount: 0,
        voidsRappen: 0,
        voidCount: 0,
        movements: [],
        cash: {
          openingFloatRappen: 0,
          collectedRappen: 0,
          paidOutRappen: 0,
          movementsRappen: 0,
          expectedRappen: expectedCashRappen,
        },
      },
    });
  }
}

/**
 * A second, independent organization with an admin user, for cross-tenant tests (RNF-12).
 */
export async function createOtherOrganization(db: Database, name = 'Other Gastro') {
  const organizationId = newId();
  const locationId = newId();
  const adminId = newId();
  const pinKey = newPinKey();
  const passwordHash = await hashPassword('other-password-123');
  await db.transaction(async (tx) => {
    await tx.insert(s.organizations).values({
      id: organizationId,
      name,
      slug: `other-${organizationId.slice(-12)}`,
      pinKey,
    });
    await tx.insert(s.locations).values({
      id: locationId,
      organizationId,
      name,
      legalName: name,
      street: 'Bahnhofplatz 1',
      postalCode: '3011',
      city: 'Bern',
      languages: ['de', 'fr'],
      settings: {} as never,
    });
    const { roleIds } = await applyOrganizationTemplate(tx, organizationId, 'de');
    await tx.insert(s.users).values({
      id: adminId,
      organizationId,
      displayName: `${name} Admin`,
      email: `admin-${organizationId.slice(-12)}@other.test`,
      passwordHash,
      pinHash: await hashPassword('9999'),
      pinLookup: pinLookup(pinKey, '9999'),
    });
    await tx.insert(s.userLocations).values({ organizationId, userId: adminId, locationId });
    await tx.insert(s.userRoles).values({ organizationId, userId: adminId, roleId: roleIds.admin });
  });
  const session: BackofficeSession = { kind: 'user', userId: adminId, organizationId, locationId };
  return { organizationId, locationId, adminId, session };
}
