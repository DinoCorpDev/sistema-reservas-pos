import { newId } from '@pos/core';
import { schema as s, verifyPassword } from '@pos/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOtherOrganization,
  createTestApi,
  type DemoContext,
  demoSession,
  loadDemo,
} from '../testing';

const api = createTestApi();
let demo: DemoContext;
let admin: Record<string, string>;
let waiter: Record<string, string>;
let other: Awaited<ReturnType<typeof createOtherOrganization>>;
let otherAdmin: Record<string, string>;
let staffId: string;
/** DINOLABS support signed in to the platform console, without an open organization. */
let platform: Record<string, string>;

interface MatrixEntry {
  taxCategoryKey: string;
  consumptionType: string;
  rateCode?: string;
  rateBp?: number;
  error?: string;
}
interface TaxOverview {
  date: string;
  categories: { id: string; key: string; name: string }[];
  rates: { id: string; code: string; rateBp: number; validFrom: string; validTo: string | null }[];
  rules: { id: string; taxCategoryKey: string; consumptionType: string; validTo: string | null }[];
  matrix: MatrixEntry[];
}
interface Customer {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  tags: string[];
  anonymizedAt: string | null;
  consents: { id: string; purpose: string; revokedAt: string | null }[];
}
interface AuditPage {
  items: {
    id: string;
    action: string;
    userId: string | null;
    occurredAt: string;
    reason: string | null;
  }[];
  nextCursor: string | null;
}
interface Checklist {
  checks: { key: string; done: boolean; missing?: number }[];
  done: number;
  total: number;
  complete: boolean;
  operationActivatedAt: string | null;
}

const json = async <T>(response: Response) => (await response.json()) as T;

const rateOf = (overview: TaxOverview, key: string, consumptionType: string) =>
  overview.matrix.find((e) => e.taxCategoryKey === key && e.consumptionType === consumptionType);

const consent = {
  purpose: 'data_processing',
  source: 'pos',
  textVersion: '2026-10',
  textSnapshot: 'Ich bin einverstanden, dass meine Kontaktdaten gespeichert werden (revDSG).',
};

beforeAll(async () => {
  demo = await loadDemo(api.db);
  admin = api.as(demoSession(demo, 'admin'));
  waiter = api.as(demoSession(demo, 'waiter'));
  other = await createOtherOrganization(api.db, `Admin Other ${newId().slice(-6)}`);
  otherAdmin = api.as(other.session);
  staffId = newId();
  await api.db.insert(s.platformStaff).values({
    id: staffId,
    email: `staff-${staffId.slice(-12)}@dinolabs.test`,
    displayName: 'Test Support',
    passwordHash: 'not-used-in-api-tests',
  });
  platform = api.as({ kind: 'support', staffId, organizationId: null, locationId: null });
});

afterAll(async () => {
  await api.close();
});

describe('API v1 administration routes', () => {
  it('are documented in the OpenAPI document', async () => {
    const response = await api.request('GET', '/openapi.json');
    expect(response.status).toBe(200);
    const doc = (await response.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/tax',
        '/api/v1/tax/rates',
        '/api/v1/customers/{id}/anonymize',
        '/api/v1/customers/{id}/export',
        '/api/v1/audit-events',
        '/api/v1/setup-checklist/activate',
        '/api/v1/platform/organizations',
        '/api/v1/support-grants/{id}',
      ]),
    );
  });
});

describe('MWST rates and rules (RF-B12, RF-B13, RN-02, RN-03)', () => {
  it('resolves the demo matrix for today with the Swiss rules', async () => {
    const response = await api.request('GET', '/tax', { headers: waiter });
    expect(response.status).toBe(200);
    const body = await json<TaxOverview>(response);
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.categories.map((c) => c.key)).toEqual([
      'food',
      'non_alcoholic_beverage',
      'alcoholic_beverage',
      'accommodation',
      'other',
    ]);
    expect(body.matrix).toHaveLength(15);
    expect(rateOf(body, 'food', 'on_premise')).toMatchObject({ rateCode: 'normal', rateBp: 810 });
    expect(rateOf(body, 'food', 'takeaway')).toMatchObject({ rateCode: 'reduced', rateBp: 260 });
    expect(rateOf(body, 'non_alcoholic_beverage', 'delivery')).toMatchObject({ rateBp: 260 });
    expect(rateOf(body, 'alcoholic_beverage', 'takeaway')).toMatchObject({
      rateCode: 'normal',
      rateBp: 810,
    });
    expect(rateOf(body, 'accommodation', 'on_premise')).toMatchObject({ rateBp: 380 });
  });

  it('resolves the rates in force on another date', async () => {
    const body = await json<TaxOverview>(
      await api.request('GET', '/tax?date=2023-06-30', { headers: admin }),
    );
    expect(body.date).toBe('2023-06-30');
    expect(rateOf(body, 'food', 'on_premise')?.rateBp).toBe(770);
    expect(rateOf(body, 'food', 'takeaway')?.rateBp).toBe(250);
  });

  it('refuses a rate whose period overlaps another one of the same code (409)', async () => {
    const response = await api.request('POST', '/tax/rates', {
      headers: admin,
      body: { code: 'normal', rateBp: 820, validFrom: '2025-01-01' },
    });
    expect(response.status).toBe(409);
    const body = await json<{
      error: { code: string; details: { conflictingId: string; validFrom: string } };
    }>(response);
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.details.validFrom).toBe('2024-01-01');
  });

  it('validates the period and the permission', async () => {
    const inverted = await api.request('POST', '/tax/rates', {
      headers: admin,
      body: { code: 'normal', rateBp: 820, validFrom: '2041-01-01', validTo: '2040-12-31' },
    });
    expect(inverted.status).toBe(422);
    const forbidden = await api.request('POST', '/tax/rates', {
      headers: waiter,
      body: { code: 'normal', rateBp: 820, validFrom: '2041-01-01', closePrevious: true },
    });
    expect(forbidden.status).toBe(403);
  });

  it('schedules a new rate with closePrevious: the matrix changes from that date only', async () => {
    const created = await api.request('POST', '/tax/rates', {
      headers: otherAdmin,
      body: { code: 'normal', rateBp: 850, validFrom: '2040-01-01', closePrevious: true },
    });
    expect(created.status).toBe(201);
    const rate = await json<{ id: string; validTo: string | null }>(created);
    expect(rate).toMatchObject({ validTo: null });

    const before = await json<TaxOverview>(
      await api.request('GET', '/tax?date=2039-12-31', { headers: otherAdmin }),
    );
    expect(rateOf(before, 'food', 'on_premise')?.rateBp).toBe(810);
    expect(rateOf(before, 'food', 'takeaway')?.rateBp).toBe(260);
    expect(before.rates.find((r) => r.code === 'normal' && r.rateBp === 810)?.validTo).toBe(
      '2039-12-31',
    );

    const after = await json<TaxOverview>(
      await api.request('GET', '/tax?date=2040-01-01', { headers: otherAdmin }),
    );
    expect(rateOf(after, 'food', 'on_premise')?.rateBp).toBe(850);
    expect(rateOf(after, 'alcoholic_beverage', 'takeaway')?.rateBp).toBe(850);
    expect(rateOf(after, 'food', 'takeaway')?.rateBp).toBe(260);

    // The demo organization is not affected.
    const demoTax = await json<TaxOverview>(
      await api.request('GET', '/tax?date=2040-01-01', { headers: admin }),
    );
    expect(rateOf(demoTax, 'food', 'on_premise')?.rateBp).toBe(810);

    const audits = await api.db
      .select()
      .from(s.auditEvents)
      .where(
        and(
          eq(s.auditEvents.organizationId, other.organizationId),
          eq(s.auditEvents.action, 'tax.rule_changed'),
        ),
      );
    expect(audits).toHaveLength(2);
    expect(audits.every((a) => a.locationId === null && a.userId === other.adminId)).toBe(true);
    const [event] = await api.db
      .select()
      .from(s.outboxEvents)
      .where(eq(s.outboxEvents.aggregateId, rate.id));
    expect(event).toMatchObject({
      type: 'tax.rule_changed',
      locationId: null,
      aggregateType: 'tax_rate',
    });
  });

  it('adds a rule per category and consumption type, without overlaps', async () => {
    const overview = await json<TaxOverview>(
      await api.request('GET', '/tax', { headers: otherAdmin }),
    );
    const otherCategory = overview.categories.find((c) => c.key === 'other')!;
    const body = {
      taxCategoryId: otherCategory.id,
      consumptionType: 'takeaway',
      rateCode: 'reduced',
      validFrom: '2040-06-01',
    };
    const overlapping = await api.request('POST', '/tax/rules', { headers: otherAdmin, body });
    expect(overlapping.status).toBe(409);

    const created = await api.request('POST', '/tax/rules', {
      headers: otherAdmin,
      body: { ...body, closePrevious: true },
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ taxCategoryKey: 'other', rateCode: 'reduced' });

    const may = await json<TaxOverview>(
      await api.request('GET', '/tax?date=2040-05-31', { headers: otherAdmin }),
    );
    expect(rateOf(may, 'other', 'takeaway')).toMatchObject({ rateCode: 'normal', rateBp: 850 });
    const june = await json<TaxOverview>(
      await api.request('GET', '/tax?date=2040-06-01', { headers: otherAdmin }),
    );
    expect(rateOf(june, 'other', 'takeaway')).toMatchObject({ rateCode: 'reduced', rateBp: 260 });
    expect(rateOf(june, 'other', 'on_premise')).toMatchObject({ rateCode: 'normal' });
  });

  it('renames a category of its own organization only', async () => {
    const overview = await json<TaxOverview>(
      await api.request('GET', '/tax', { headers: otherAdmin }),
    );
    const food = overview.categories.find((c) => c.key === 'food')!;
    const renamed = await api.request('PATCH', `/tax/categories/${food.id}`, {
      headers: otherAdmin,
      body: { name: 'Speisen & Snacks' },
    });
    expect(await renamed.json()).toMatchObject({ key: 'food', name: 'Speisen & Snacks' });

    const foreign = await api.request('PATCH', `/tax/categories/${food.id}`, {
      headers: admin,
      body: { name: 'Hacked' },
    });
    expect(foreign.status).toBe(404);
    const foreignRule = await api.request('POST', '/tax/rules', {
      headers: admin,
      body: {
        taxCategoryId: food.id,
        consumptionType: 'takeaway',
        rateCode: 'normal',
        validFrom: '2050-01-01',
      },
    });
    expect(foreignRule.status).toBe(404);
  });
});

describe('customers with consent (RF-E14…RF-E16, RN-23)', () => {
  let customer: Customer;

  it('refuses a customer without consent or without phone and email (422)', async () => {
    const withoutConsent = await api.request('POST', '/customers', {
      headers: waiter,
      body: { firstName: 'Nina', phone: '079 555 12 34' },
    });
    expect(withoutConsent.status).toBe(422);
    const withoutContact = await api.request('POST', '/customers', {
      headers: waiter,
      body: { firstName: 'Nina', consent },
    });
    expect(withoutContact.status).toBe(422);
    const badPhone = await api.request('POST', '/customers', {
      headers: waiter,
      body: { firstName: 'Nina', phone: '12', consent },
    });
    expect(badPhone.status).toBe(422);
  });

  it('creates a customer with a normalized phone, the consent and its events', async () => {
    const response = await api.request('POST', '/customers', {
      headers: waiter,
      body: {
        firstName: 'Nina',
        lastName: 'Zwahlen',
        phone: '079 555 12 34',
        email: 'Nina.Zwahlen@Example.com',
        declaredAllergies: 'Gluten',
        tags: ['VIP'],
        consent,
      },
    });
    expect(response.status).toBe(201);
    customer = await json<Customer>(response);
    expect(customer).toMatchObject({
      phone: '+41795551234',
      email: 'nina.zwahlen@example.com',
      tags: ['VIP'],
      anonymizedAt: null,
      consents: [{ purpose: 'data_processing', revokedAt: null }],
    });
    const events = await api.db
      .select()
      .from(s.outboxEvents)
      .where(eq(s.outboxEvents.aggregateId, customer.id));
    expect(events.map((e) => e.type).sort()).toEqual([
      'customer.consent_recorded',
      'customer.created',
    ]);
    // No personal data in the event payloads (they cannot be anonymized later).
    expect(JSON.stringify(events.map((e) => e.payload))).not.toContain('Zwahlen');
  });

  it('refuses a duplicate phone or email in the organization (409 with the existing id)', async () => {
    const [peter] = await api.db
      .select()
      .from(s.customers)
      .where(
        and(
          eq(s.customers.organizationId, demo.organizationId),
          eq(s.customers.phone, '+41790000001'),
        ),
      );
    const byPhone = await api.request('POST', '/customers', {
      headers: waiter,
      body: { firstName: 'Peter', phone: '+41 79 000 00 01', consent },
    });
    expect(byPhone.status).toBe(409);
    expect(await byPhone.json()).toMatchObject({
      error: { code: 'CONFLICT', details: { existingCustomerId: peter!.id } },
    });
    const byEmail = await api.request('POST', '/customers', {
      headers: waiter,
      body: { email: 'NINA.zwahlen@example.com', consent },
    });
    expect(byEmail.status).toBe(409);
    expect(await byEmail.json()).toMatchObject({
      error: { details: { existingCustomerId: customer.id } },
    });

    // Another organization may have a customer with the same phone.
    const elsewhere = await api.request('POST', '/customers', {
      headers: otherAdmin,
      body: { firstName: 'Peter', phone: '+41790000001', consent },
    });
    expect(elsewhere.status).toBe(201);
  });

  it('searches by name, phone or email', async () => {
    const search = async (term: string) =>
      json<Customer[]>(
        await api.request('GET', `/customers?search=${encodeURIComponent(term)}`, {
          headers: waiter,
        }),
      );
    expect((await search('zwahlen')).map((c) => c.id)).toEqual([customer.id]);
    expect((await search('Nina Zwahlen')).map((c) => c.id)).toEqual([customer.id]);
    expect((await search('079 555 12 34')).map((c) => c.id)).toEqual([customer.id]);
    expect((await search('5551234')).map((c) => c.id)).toEqual([customer.id]);
    expect((await search('nina.zwahlen@')).map((c) => c.id)).toEqual([customer.id]);
    expect((await search('Muster')).map((c) => c.lastName)).toEqual(['Muster']);
    expect(await search('%')).toEqual([]);
    const limited = await json<Customer[]>(
      await api.request('GET', '/customers?limit=1', { headers: waiter }),
    );
    expect(limited).toHaveLength(1);
  });

  it('updates the customer and records another consent', async () => {
    const updated = await api.request('PATCH', `/customers/${customer.id}`, {
      headers: waiter,
      body: { notes: 'Fensterplatz', phone: '+41 79 555 99 99' },
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ notes: 'Fensterplatz', phone: '+41795559999' });

    const clash = await api.request('PATCH', `/customers/${customer.id}`, {
      headers: waiter,
      body: { phone: '+41790000001' },
    });
    expect(clash.status).toBe(409);
    const noContact = await api.request('PATCH', `/customers/${customer.id}`, {
      headers: waiter,
      body: { phone: null, email: null },
    });
    expect(noContact.status).toBe(422);

    const marketing = await api.request('POST', `/customers/${customer.id}/consents`, {
      headers: waiter,
      body: { ...consent, purpose: 'marketing', source: 'qr' },
    });
    expect(marketing.status).toBe(201);
    expect(await marketing.json()).toMatchObject({
      purpose: 'marketing',
      source: 'qr',
      revokedAt: null,
    });
  });

  it('exports the personal data and consents as JSON (RF-E16)', async () => {
    const response = await api.request('GET', `/customers/${customer.id}/export`, {
      headers: admin,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain(`customer-${customer.id}.json`);
    const body = await json<{
      customer: Customer;
      consents: { purpose: string }[];
      organizationId: string;
    }>(response);
    expect(body.organizationId).toBe(demo.organizationId);
    expect(body.customer).toMatchObject({ lastName: 'Zwahlen', declaredAllergies: 'Gluten' });
    expect(body.consents.map((c) => c.purpose)).toEqual(['data_processing', 'marketing']);
  });

  it('anonymizes on request: data wiped, row kept, event and audit written', async () => {
    const forbidden = await api.request('POST', `/customers/${customer.id}/anonymize`, {
      headers: waiter,
      body: {},
    });
    expect(forbidden.status).toBe(403);

    const response = await api.request('POST', `/customers/${customer.id}/anonymize`, {
      headers: admin,
      body: { reason: 'Request by e-mail' },
    });
    expect(response.status).toBe(200);
    const body = await json<Customer>(response);
    expect(body).toMatchObject({
      id: customer.id,
      firstName: null,
      lastName: null,
      phone: null,
      email: null,
      notes: null,
      tags: [],
    });
    expect(body.anonymizedAt).not.toBeNull();
    expect(body.consents.every((c) => c.revokedAt !== null)).toBe(true);

    const [row] = await api.db.select().from(s.customers).where(eq(s.customers.id, customer.id));
    expect(row).toMatchObject({ deletedAt: null, declaredAllergies: null, phone: null });
    const [event] = await api.db
      .select()
      .from(s.outboxEvents)
      .where(
        and(
          eq(s.outboxEvents.aggregateId, customer.id),
          eq(s.outboxEvents.type, 'customer.anonymized'),
        ),
      );
    expect(event).toBeDefined();
    const [audit] = await api.db
      .select()
      .from(s.auditEvents)
      .where(
        and(
          eq(s.auditEvents.entityId, customer.id),
          eq(s.auditEvents.action, 'customer.anonymized'),
        ),
      );
    expect(audit).toMatchObject({ userId: demo.users.admin.id, reason: 'Request by e-mail' });

    const found = await api.request('GET', '/customers?search=Zwahlen', { headers: admin });
    expect(await found.json()).toEqual([]);
    const again = await api.request('POST', `/customers/${customer.id}/anonymize`, {
      headers: admin,
      body: {},
    });
    expect(again.status).toBe(409);
    const edit = await api.request('PATCH', `/customers/${customer.id}`, {
      headers: admin,
      body: { notes: 'x' },
    });
    expect(edit.status).toBe(409);
  });

  it('another organization cannot see or touch our customers (RNF-12)', async () => {
    for (const [method, path, body] of [
      ['GET', `/customers/${customer.id}`, undefined],
      ['GET', `/customers/${customer.id}/export`, undefined],
      ['PATCH', `/customers/${customer.id}`, { notes: 'x' }],
      ['POST', `/customers/${customer.id}/consents`, consent],
      ['POST', `/customers/${customer.id}/anonymize`, {}],
    ] as const) {
      const response = await api.request(method, path, { headers: otherAdmin, body });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    const listed = await json<Customer[]>(
      await api.request('GET', '/customers?search=Muster', { headers: otherAdmin }),
    );
    expect(listed).toEqual([]);
  });
});

describe('audit query (RF-F11, RF-F12)', () => {
  const page = async (headers: Record<string, string>, query: string) => {
    const response = await api.request('GET', `/audit-events?${query}`, { headers });
    expect(response.status).toBe(200);
    return json<AuditPage>(response);
  };

  it('filters by action, entity and user, newest first', async () => {
    const anonymized = await page(admin, 'action=customer.anonymized');
    expect(anonymized.items.length).toBeGreaterThanOrEqual(1);
    expect(anonymized.items.every((e) => e.action === 'customer.anonymized')).toBe(true);

    const byUser = await page(admin, `userId=${demo.users.waiter.id}&entityType=customer`);
    expect(byUser.items.length).toBeGreaterThan(0);
    expect(byUser.items.every((e) => e.userId === demo.users.waiter.id)).toBe(true);
    const times = byUser.items.map((e) => e.occurredAt);
    expect([...times].sort().reverse()).toEqual(times);

    const future = await page(admin, 'from=2100-01-01');
    expect(future.items).toEqual([]);
    const past = await page(admin, 'to=2000-01-01T00:00:00Z');
    expect(past.items).toEqual([]);
  });

  it('paginates with a cursor without gaps or repeats', async () => {
    const all = await page(admin, 'entityType=customer&limit=200');
    expect(all.items.length).toBeGreaterThanOrEqual(5);
    expect(all.nextCursor).toBeNull();

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const next: AuditPage = await page(
        admin,
        `entityType=customer&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      expect(next.items.length).toBeLessThanOrEqual(2);
      seen.push(...next.items.map((e) => e.id));
      cursor = next.nextCursor;
    } while (cursor);
    expect(seen).toEqual(all.items.map((e) => e.id));

    const invalid = await api.request('GET', '/audit-events?cursor=nope', { headers: admin });
    expect(invalid.status).toBe(400);
  });

  it('is scoped to the organization and needs audit.view', async () => {
    const theirs = await page(otherAdmin, 'limit=200');
    expect(theirs.items.some((e) => e.action === 'customer.anonymized')).toBe(false);
    expect(theirs.items.some((e) => e.action === 'tax.rule_changed')).toBe(true);
    const forbidden = await api.request('GET', '/audit-events', { headers: waiter });
    expect(forbidden.status).toBe(403);
  });
});

describe('setup checklist (RF-A11, Phase 1 gate)', () => {
  it('lists what a fresh organization is missing and refuses to activate it', async () => {
    const checklist = await json<Checklist>(
      await api.request('GET', '/setup-checklist', { headers: otherAdmin }),
    );
    expect(checklist.complete).toBe(false);
    const missing = checklist.checks.filter((c) => !c.done).map((c) => c.key);
    expect(missing).toEqual([
      'vat_uid',
      'areas',
      'tables',
      'pos_terminal',
      'kitchen_station',
      'receipt_printer',
      'products',
    ]);

    const refused = await api.request('POST', '/setup-checklist/activate', { headers: otherAdmin });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({
      error: { code: 'RULE_VIOLATION', details: { missing } },
    });
    const [location] = await api.db
      .select()
      .from(s.locations)
      .where(eq(s.locations.id, other.locationId));
    expect(location!.setupCompletedAt).toBeNull();
  });

  // Self-contained (does not depend on the demo data other test files change): the whole
  // setup of a new restaurant through the API, without code, until operation is activated.
  it('reaches 100 % through the API alone and lets the owner activate operation', async () => {
    const call = async <T = { id: string }>(method: string, path: string, body?: unknown) => {
      const response = await api.request(method, path, { headers: otherAdmin, body });
      expect(response.status, `${method} ${path}`).toBeLessThan(300);
      return (response.status === 204 ? null : await response.json()) as T;
    };

    await call('PATCH', `/locations/${other.locationId}`, { vatUid: 'CHE-116.281.710' });
    const area = await call('POST', '/areas', { name: 'Saal' });
    await call('POST', '/tables', { areaId: area.id, label: '1' });
    const station = await call('POST', '/kitchen-stations', { name: 'Küche' });
    await call('POST', '/printers', { name: 'Bondrucker', kind: 'receipt', host: '10.0.0.5' });
    await call('POST', '/terminals', { name: 'Kasse 1', type: 'pos', orderNumberPrefix: 'K1' });
    // Without a display (or a printer) the kitchen's tickets would show up nowhere.
    let checklist = await call<Checklist>('GET', '/setup-checklist');
    expect(checklist.checks.find((c) => c.key === 'station_output')).toEqual({
      key: 'station_output',
      done: false,
      missing: 1,
    });
    await call('POST', '/terminals', {
      name: 'KDS Küche',
      type: 'kds',
      orderNumberPrefix: 'D1',
      kitchenStationId: station.id,
    });

    const tax = await call<TaxOverview>('GET', '/tax');
    const food = tax.categories.find((c) => c.key === 'food')!;
    const category = await call('POST', '/catalog/categories', { name: 'Hauptgerichte' });
    const product = await call('POST', '/catalog/products', {
      categoryId: category.id,
      taxCategoryId: food.id,
      name: 'Rösti mit Spiegelei',
      basePriceRappen: 2450,
    });
    await call('PUT', `/catalog/products/${product.id}/allergens`, {
      allergens: [
        { allergen: 'milk', presence: 'contains' },
        { allergen: 'eggs', presence: 'contains' },
      ],
      confirmed: true,
    });
    await call('PUT', `/catalog/products/${product.id}/translations`, {
      fr: { name: 'Rösti avec œuf au plat' },
    });
    await call('PUT', `/catalog/products/${product.id}/stations`, { stationIds: [station.id] });

    checklist = await call<Checklist>('GET', '/setup-checklist');
    expect(checklist.checks.filter((c) => !c.done)).toEqual([]);
    expect(checklist).toMatchObject({ complete: true, done: 15, total: 15 });

    // Activation needs location.manage (a waiter of another organization cannot either).
    const forbidden = await api.request('POST', '/setup-checklist/activate', { headers: waiter });
    expect(forbidden.status).toBe(403);

    const activated = await call<Checklist>('POST', '/setup-checklist/activate');
    expect(activated.operationActivatedAt).not.toBeNull();
    const [location] = await api.db
      .select()
      .from(s.locations)
      .where(eq(s.locations.id, other.locationId));
    expect(location!.setupCompletedAt?.toISOString()).toBe(activated.operationActivatedAt);
    const audits = await api.db
      .select()
      .from(s.auditEvents)
      .where(
        and(
          eq(s.auditEvents.entityId, other.locationId),
          eq(s.auditEvents.action, 'operation.activated'),
        ),
      );
    expect(audits).toHaveLength(1);

    const again = await call<Checklist>('POST', '/setup-checklist/activate');
    expect(again.operationActivatedAt).toBe(activated.operationActivatedAt);
  });
});
describe('DINOLABS support (RF-A10, Flujo 7)', () => {
  const onboarding = (email: string, name = 'Café du Lac') => ({
    organization: { name, legalName: `${name} SA`, defaultLanguage: 'fr' },
    location: {
      name: `${name} Lausanne`,
      legalName: `${name} SA`,
      street: 'Quai d’Ouchy 1',
      postalCode: '1006',
      city: 'Lausanne',
      canton: 'vd',
      vatUid: 'CHE116281710',
      languages: ['fr', 'de'],
      kitchenLanguage: 'fr',
    },
    owner: { displayName: 'Claire Dubois', email, uiLanguage: 'fr' },
  });

  it('platform routes are only for support staff', async () => {
    expect((await api.request('GET', '/platform/organizations')).status).toBe(401);
    expect((await api.request('GET', '/platform/organizations', { headers: admin })).status).toBe(
      403,
    );
    const unknownStaff = api.as({
      kind: 'support',
      staffId: newId(),
      organizationId: null,
      locationId: null,
    });
    expect(
      (await api.request('GET', '/platform/organizations', { headers: unknownStaff })).status,
    ).toBe(403);

    const response = await api.request('GET', '/platform/organizations', { headers: platform });
    expect(response.status).toBe(200);
    const list = await json<
      {
        id: string;
        slug: string;
        locationsCount: number;
        primaryLocationId: string | null;
        supportGrantExpiresAt: string | null;
      }[]
    >(response);
    expect(list.find((o) => o.id === demo.organizationId)).toMatchObject({
      slug: 'demo-gastro',
      locationsCount: 1,
      primaryLocationId: demo.locationId,
      supportGrantExpiresAt: null,
    });
  });

  it('onboards a restaurant whose owner can then work and sees an incomplete checklist', async () => {
    const email = `claire-${newId().slice(-12)}@cafe.test`;
    const response = await api.request('POST', '/platform/organizations', {
      headers: platform,
      body: onboarding(email.toUpperCase()),
    });
    expect(response.status).toBe(201);
    const result = await json<{
      organizationId: string;
      locationId: string;
      ownerUserId: string;
      ownerEmail: string;
      temporaryPassword: string;
    }>(response);
    expect(result.ownerEmail).toBe(email);
    expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(12);

    const [org] = await api.db
      .select()
      .from(s.organizations)
      .where(eq(s.organizations.id, result.organizationId));
    expect(org).toMatchObject({ slug: 'cafe-du-lac', defaultLanguage: 'fr' });
    expect(org!.pinKey).toMatch(/^[0-9a-f]{64}$/);
    const [location] = await api.db
      .select()
      .from(s.locations)
      .where(eq(s.locations.id, result.locationId));
    expect(location).toMatchObject({
      canton: 'VD',
      vatUid: 'CHE-116.281.710 MWST',
      defaultLanguage: 'fr',
      setupCompletedAt: null,
    });
    const [owner] = await api.db.select().from(s.users).where(eq(s.users.id, result.ownerUserId));
    expect(owner).toMatchObject({ email, mustChangePassword: true, pinHash: null });
    expect(await verifyPassword(owner!.passwordHash!, result.temporaryPassword)).toBe(true);
    const [audit] = await api.db
      .select()
      .from(s.auditEvents)
      .where(
        and(
          eq(s.auditEvents.entityId, result.organizationId),
          eq(s.auditEvents.action, 'organization.created'),
        ),
      );
    expect(audit).toMatchObject({
      organizationId: result.organizationId,
      requestId: `support:${staffId}`,
    });
    // The console opens the new organization at its first location.
    const listed = await json<{ id: string; primaryLocationId: string | null }[]>(
      await api.request('GET', '/platform/organizations', { headers: platform }),
    );
    expect(listed.find((o) => o.id === result.organizationId)?.primaryLocationId).toBe(
      result.locationId,
    );

    const ownerHeaders = api.as({
      kind: 'user',
      userId: result.ownerUserId,
      organizationId: result.organizationId,
      locationId: result.locationId,
    });
    const tax = await json<TaxOverview>(
      await api.request('GET', '/tax', { headers: ownerHeaders }),
    );
    expect(tax.categories.find((c) => c.key === 'food')?.name).toBe('Mets');
    expect(rateOf(tax, 'food', 'takeaway')?.rateBp).toBe(260);

    const checklist = await json<Checklist>(
      await api.request('GET', '/setup-checklist', { headers: ownerHeaders }),
    );
    expect(checklist.complete).toBe(false);
    expect(checklist.checks.filter((c) => !c.done).map((c) => c.key)).toEqual([
      'areas',
      'tables',
      'pos_terminal',
      'kitchen_station',
      'receipt_printer',
      'manager_with_pin',
      'products',
    ]);
    const area = await api.request('POST', '/areas', {
      headers: ownerHeaders,
      body: { name: 'Salle' },
    });
    expect(area.status).toBe(201);

    // Same name again: another slug. Same owner email: refused.
    const second = await api.request('POST', '/platform/organizations', {
      headers: platform,
      body: onboarding(`other-${email}`),
    });
    const [secondOrg] = await api.db
      .select()
      .from(s.organizations)
      .where(
        eq(s.organizations.id, (await json<{ organizationId: string }>(second)).organizationId),
      );
    expect(secondOrg!.slug).toBe('cafe-du-lac-2');
    const duplicate = await api.request('POST', '/platform/organizations', {
      headers: platform,
      body: onboarding(email, 'Another Name'),
    });
    expect(duplicate.status).toBe(409);
  });

  it('validates the onboarding input', async () => {
    const body = onboarding(`x-${newId().slice(-12)}@cafe.test`);
    const wrongLanguages = await api.request('POST', '/platform/organizations', {
      headers: platform,
      body: { ...body, location: { ...body.location, languages: ['de', 'it'] } },
    });
    expect(wrongLanguages.status).toBe(422);
    const badUid = await api.request('POST', '/platform/organizations', {
      headers: platform,
      body: { ...body, location: { ...body.location, vatUid: 'CHE-123.456.789' } },
    });
    expect(badUid.status).toBe(422);
  });

  it('lets support in only while the owner grants access', async () => {
    const support = api.as({
      kind: 'support',
      staffId,
      organizationId: demo.organizationId,
      locationId: demo.locationId,
    });
    expect((await api.request('GET', '/areas', { headers: support })).status).toBe(403);

    const tooLong = await api.request('POST', '/support-grants', {
      headers: admin,
      body: { hours: 73, reason: 'Ticket #42' },
    });
    expect(tooLong.status).toBe(422);
    const byWaiter = await api.request('POST', '/support-grants', {
      headers: waiter,
      body: { hours: 2, reason: 'Ticket #42' },
    });
    expect(byWaiter.status).toBe(403);

    const granted = await api.request('POST', '/support-grants', {
      headers: admin,
      body: { hours: 2, reason: 'Ticket #42' },
    });
    expect(granted.status).toBe(201);
    const grant = await json<{
      id: string;
      active: boolean;
      expiresAt: string;
      grantedByUserId: string;
    }>(granted);
    expect(grant).toMatchObject({ active: true, grantedByUserId: demo.users.admin.id });
    const hours = (new Date(grant.expiresAt).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(1.9);
    expect(hours).toBeLessThanOrEqual(2);

    const inside = await api.request('GET', '/areas', { headers: support });
    expect(inside.status).toBe(200);
    expect(((await inside.json()) as unknown[]).length).toBeGreaterThan(0);
    // Support cannot extend its own access.
    const selfGrant = await api.request('POST', '/support-grants', {
      headers: support,
      body: { hours: 72, reason: 'More time' },
    });
    expect(selfGrant.status).toBe(403);

    const platformList = await json<{ id: string; supportGrantExpiresAt: string | null }[]>(
      await api.request('GET', '/platform/organizations', { headers: platform }),
    );
    expect(platformList.find((o) => o.id === demo.organizationId)?.supportGrantExpiresAt).toBe(
      grant.expiresAt,
    );

    const listed = await json<{ id: string }[]>(
      await api.request('GET', '/support-grants', { headers: admin }),
    );
    expect(listed.map((g) => g.id)).toContain(grant.id);
    const theirs = await json<{ id: string }[]>(
      await api.request('GET', '/support-grants', { headers: otherAdmin }),
    );
    expect(theirs.map((g) => g.id)).not.toContain(grant.id);
    const foreignRevoke = await api.request('DELETE', `/support-grants/${grant.id}`, {
      headers: otherAdmin,
    });
    expect(foreignRevoke.status).toBe(404);

    const revoked = await api.request('DELETE', `/support-grants/${grant.id}`, { headers: admin });
    expect(revoked.status).toBe(204);
    expect((await api.request('GET', '/areas', { headers: support })).status).toBe(403);

    const audits = await api.db
      .select({ action: s.auditEvents.action })
      .from(s.auditEvents)
      .where(eq(s.auditEvents.entityId, grant.id));
    expect(audits.map((a) => a.action).sort()).toEqual([
      'support.access_granted',
      'support.access_revoked',
    ]);
    const after = await json<{ id: string; active: boolean; revokedAt: string | null }[]>(
      await api.request('GET', '/support-grants', { headers: admin }),
    );
    expect(after.find((g) => g.id === grant.id)).toMatchObject({ active: false });
  });
});
