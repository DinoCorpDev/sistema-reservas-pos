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

/**
 * A new waiter joins from their own phone (DEC-055): the code is the only credential, a taken PIN
 * is refused and counts against the code, and nothing opens before the manager approves.
 * Against MySQL.
 */

const api = createTestApi();
let demo: DemoContext;
let manager: Record<string, string>;

type Body = Record<string, unknown> & {
  error?: { code: string; details?: Record<string, unknown> };
};

const call = async (
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) => {
  const response = await api.request(method, path, { headers, ...(body ? { body } : {}) });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as Body };
};

const invite = async () => {
  const { status, body } = await call('POST', '/staff-invites', manager);
  expect(status).toBe(201);
  return body.code as string;
};

const join = (code: string, displayName: string, pin: string, uiLanguage = 'de') =>
  call('POST', '/staff-registrations', {}, { code, displayName, pin, uiLanguage });

const registration = async (id: string) => {
  const [row] = await api.db
    .select()
    .from(s.staffRegistrations)
    .where(eq(s.staffRegistrations.id, id));
  return row;
};

beforeAll(async () => {
  demo = await loadDemo(api.db);
  manager = api.as(demoSession(demo, 'manager'));
});

afterAll(async () => {
  await api.close();
});

describe('joining the team from one’s phone (DEC-055)', () => {
  it('only someone who manages people invites', async () => {
    const waiter = api.as(demoSession(demo, 'waiter'));
    expect((await call('POST', '/staff-invites', waiter)).status).toBe(403);
    const code = await invite();
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('joins with the code, waits, and becomes a waiter when the manager approves', async () => {
    const code = await invite();
    const joined = await join(code.toLowerCase(), 'Nina Neu', '6123', 'it');
    expect(joined.status).toBe(201);
    expect(joined.body.locationName).toBe('Restaurant Demo Zürich');
    const id = joined.body.id as string;

    // The PIN is only a hash, and nobody exists yet.
    const row = await registration(id);
    expect(row).toMatchObject({ status: 'pending', displayName: 'Nina Neu', uiLanguage: 'it' });
    expect(row?.pinHash).not.toContain('6123');
    const before = await api.db.select().from(s.users).where(eq(s.users.displayName, 'Nina Neu'));
    expect(before).toEqual([]);

    const pending = await call('GET', '/staff-registrations', manager);
    expect((pending.body as unknown as { id: string }[]).map((r) => r.id)).toContain(id);

    const approved = await call('POST', `/staff-registrations/${id}/approve`, manager);
    expect(approved.status).toBe(200);
    const userId = approved.body.userId as string;
    const [user] = await api.db.select().from(s.users).where(eq(s.users.id, userId));
    expect(user).toMatchObject({ displayName: 'Nina Neu', uiLanguage: 'it', isActive: true });
    expect(user?.pinLookup).toBe(row?.pinLookup);
    const roles = await api.db
      .select({ key: s.roles.key })
      .from(s.userRoles)
      .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
      .where(eq(s.userRoles.userId, userId));
    expect(roles.map((r) => r.key)).toEqual(['waiter']);
    const [place] = await api.db
      .select()
      .from(s.userLocations)
      .where(eq(s.userLocations.userId, userId));
    expect(place?.locationId).toBe(demo.locationId);
    const [audit] = await api.db
      .select()
      .from(s.auditEvents)
      .where(and(eq(s.auditEvents.entityId, userId), eq(s.auditEvents.action, 'user.created')));
    expect(audit?.after).toMatchObject({ source: 'registration', roles: ['waiter'] });
    expect((await registration(id))?.status).toBe('approved');

    const again = await call('POST', `/staff-registrations/${id}/approve`, manager);
    expect(again.status).toBe(409);
  });

  it('refuses a taken PIN, counts it, and five of them kill the code', async () => {
    const code = await invite();
    // Anna Huber's PIN in the demo.
    const taken = await join(code, 'Probe', '4001');
    expect(taken.status).toBe(409);
    expect(taken.body.error?.details).toMatchObject({ reason: 'pin_taken', attemptsLeft: 4 });
    // A PIN waiting for approval is taken too.
    expect((await join(code, 'Erste', '7341')).status).toBe(201);
    expect((await join(code, 'Zweite', '7341')).status).toBe(409);
    for (let i = 0; i < 3; i += 1) await join(code, 'Probe', '4001');
    const dead = await join(code, 'Spät', '7342');
    expect(dead.status).toBe(404);
    expect(dead.body.error?.details).toMatchObject({ reason: 'invalid_code' });
  });

  it('refuses an unknown code', async () => {
    const response = await join('ABCD-EFGH', 'Niemand', '7350');
    expect(response.status).toBe(404);
  });

  it('rejects without deleting anything', async () => {
    const code = await invite();
    const joined = await join(code, 'Nicht Dabei', '7360');
    const id = joined.body.id as string;
    expect((await call('POST', `/staff-registrations/${id}/reject`, manager)).status).toBe(204);
    expect(await registration(id)).toMatchObject({ status: 'rejected', deletedAt: null });
    const list = await call('GET', '/staff-registrations', manager);
    expect((list.body as unknown as { id: string }[]).map((r) => r.id)).not.toContain(id);
  });

  it('never shows or decides a registration of another organization (RNF-12)', async () => {
    const code = await invite();
    const joined = await join(code, 'Fremd', '7370');
    const other = await createOtherOrganization(api.db, 'Join Other');
    const headers = api.as(other.session);
    const approve = await call('POST', `/staff-registrations/${joined.body.id}/approve`, headers);
    expect(approve.status).toBe(404);
    const list = await call('GET', '/staff-registrations', headers);
    expect(list.body).toEqual([]);
  });
});
