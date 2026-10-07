import { schema as s } from '@pos/db';
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

beforeAll(async () => {
  demo = await loadDemo(api.db);
  admin = api.as(demoSession(demo, 'admin'));
  waiter = api.as(demoSession(demo, 'waiter'));
  other = await createOtherOrganization(api.db);
  otherAdmin = api.as(other.session);
});

afterAll(async () => {
  await api.close();
});

describe('API v1 basics', () => {
  it('reports health without credentials', async () => {
    const response = await api.request('GET', '/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', checks: { database: 'ok' } });
  });

  it('publishes a valid OpenAPI 3.1 document', async () => {
    const response = await api.request('GET', '/openapi.json');
    expect(response.status).toBe(200);
    const doc = (await response.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/api/v1/areas', '/api/v1/locations/{id}']),
    );
  });

  it('rejects anonymous calls with the uniform error shape', async () => {
    const response = await api.request('GET', '/areas');
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Sign in or send credentials' },
    });
  });

  it('answers unknown routes with 404 NOT_FOUND', async () => {
    const response = await api.request('GET', '/nope', { headers: admin });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});

describe('locations (RF-A02)', () => {
  it('normalizes and audits the MWST UID change', async () => {
    const response = await api.request('PATCH', `/locations/${demo.locationId}`, {
      headers: admin,
      body: { vatUid: 'CHE116281710' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ vatUid: 'CHE-116.281.710 MWST' });
    const audits = await api.db
      .select()
      .from(s.auditEvents)
      .where(
        and(
          eq(s.auditEvents.entityId, demo.locationId),
          eq(s.auditEvents.action, 'location.updated'),
        ),
      );
    expect(audits.at(-1)).toMatchObject({
      userId: demo.users.admin.id,
      before: { vatUid: 'CHE-123.456.788 MWST' },
      after: { vatUid: 'CHE-116.281.710 MWST' },
    });
  });

  it('rejects an invalid UID and languages without the default language', async () => {
    const badUid = await api.request('PATCH', `/locations/${demo.locationId}`, {
      headers: admin,
      body: { vatUid: 'CHE-123.456.789' },
    });
    expect(badUid.status).toBe(422);
    const badLanguages = await api.request('PATCH', `/locations/${demo.locationId}`, {
      headers: admin,
      body: { languages: ['fr', 'it'] },
    });
    expect(badLanguages.status).toBe(422);
  });

  it('replaces the settings with validated defaults (DEC-004)', async () => {
    const response = await api.request('PUT', `/locations/${demo.locationId}/settings`, {
      headers: admin,
      body: { kitchen: { alertAfterMinutes: 15 } },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      kitchen: { alertAfterMinutes: 15 },
      managerApproval: { discountAboveBp: 2000 },
    });
  });

  it('forbids staff without location.manage', async () => {
    const response = await api.request('PATCH', `/locations/${demo.locationId}`, {
      headers: waiter,
      body: { name: 'Hacked' },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });
});

describe('areas and tables (RF-A03, RF-C06, RF-E06)', () => {
  it('runs the full lifecycle of an area and its table', async () => {
    const listed = await api.request('GET', '/areas', { headers: waiter });
    expect(((await listed.json()) as unknown[]).length).toBe(2);

    const created = await api.request('POST', '/areas', { headers: admin, body: { name: 'Bar' } });
    expect(created.status).toBe(201);
    const area = (await created.json()) as { id: string; qrMode: string; isActive: boolean };
    expect(area).toMatchObject({ qrMode: 'view', isActive: true });

    const table = await api.request('POST', '/tables', {
      headers: admin,
      body: { areaId: area.id, label: 'B1', capacity: 2 },
    });
    expect(table.status).toBe(201);
    const tableBody = (await table.json()) as { id: string; qrCode: string };
    expect(tableBody.qrCode).toMatch(/^[\w-]{12}$/);

    const renewed = await api.request('POST', `/tables/${tableBody.id}/qr-code`, {
      headers: admin,
    });
    expect(((await renewed.json()) as { qrCode: string }).qrCode).not.toBe(tableBody.qrCode);

    const blocked = await api.request('DELETE', `/areas/${area.id}`, { headers: admin });
    expect(blocked.status).toBe(409);

    const seasonal = await api.request('PATCH', `/areas/${area.id}`, {
      headers: admin,
      body: { isActive: false },
    });
    expect(await seasonal.json()).toMatchObject({ isActive: false });

    expect(
      (await api.request('DELETE', `/tables/${tableBody.id}`, { headers: admin })).status,
    ).toBe(204);
    expect((await api.request('DELETE', `/areas/${area.id}`, { headers: admin })).status).toBe(204);
    const after = await api.request('GET', '/areas', { headers: admin });
    expect(((await after.json()) as { id: string }[]).some((a) => a.id === area.id)).toBe(false);
  });

  it('validates input with 422 and lists the issues', async () => {
    const response = await api.request('POST', '/tables', { headers: admin, body: { label: '' } });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string; details: unknown[] } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it('rejects duplicate table labels with 409', async () => {
    const [area] = await api.db
      .select()
      .from(s.areas)
      .where(eq(s.areas.locationId, demo.locationId));
    const response = await api.request('POST', '/tables', {
      headers: admin,
      body: { areaId: area!.id, label: '1' },
    });
    expect(response.status).toBe(409);
  });
});

describe('RNF-12 · another organization sees nothing of ours', () => {
  it('cannot read our location', async () => {
    const response = await api.request('GET', `/locations/${demo.locationId}`, {
      headers: otherAdmin,
    });
    expect(response.status).toBe(404);
  });

  it('cannot modify our areas or tables, even with their ids', async () => {
    const [area] = await api.db
      .select()
      .from(s.areas)
      .where(eq(s.areas.locationId, demo.locationId));
    const [table] = await api.db
      .select()
      .from(s.diningTables)
      .where(eq(s.diningTables.areaId, area!.id));
    for (const [method, path, body] of [
      ['PATCH', `/areas/${area!.id}`, { name: 'x' }],
      ['DELETE', `/tables/${table!.id}`, undefined],
      ['POST', '/tables', { areaId: area!.id, label: 'X1' }],
    ] as const) {
      const response = await api.request(method, path, { headers: otherAdmin, body });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    const [unchanged] = await api.db.select().from(s.areas).where(eq(s.areas.id, area!.id));
    expect(unchanged?.name).toBe(area!.name);
  });

  it('only lists its own areas', async () => {
    const response = await api.request('GET', '/areas', { headers: otherAdmin });
    expect(await response.json()).toEqual([]);
  });

  it('cannot switch to our location with X-Location-Id', async () => {
    const response = await api.request('GET', '/areas', {
      headers: { ...otherAdmin, 'x-location-id': demo.locationId },
    });
    expect(response.status).toBe(403);
  });
});
