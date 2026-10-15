import { healthIssues, PERMISSIONS } from '@pos/core';
import { schema as s } from '@pos/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  loadHealthSnapshot,
  platformStatus,
  reconcileAlerts,
} from '../services/admin/platform-health';
import { getMyPlan, updateSubscription } from '../services/platform/plans';
import {
  createOtherOrganization,
  createTestApi,
  type DemoContext,
  demoSession,
  loadDemo,
  pairTerminal,
} from '../testing';

/**
 * The monitor against MySQL (RNF-16): a hub without signal opens one alert, keeps it while the
 * problem lasts and resolves it when the hub is back; support sees it on the status page.
 */

const api = createTestApi();
let demo: DemoContext;

beforeAll(async () => {
  demo = await loadDemo(api.db);
});

afterAll(async () => {
  await api.close();
});

const snapshot = () =>
  loadHealthSnapshot(api.db, { cloud: { healthy: true, detail: null }, expectBackups: false });

describe('the monitor (RNF-16)', () => {
  it('a hub without signal: one alert while it lasts, resolved when it is back', async () => {
    const admin = api.as(demoSession(demo, 'admin'));
    const hub = await pairTerminal(api, admin, { prefix: 'HM', type: 'hub', name: 'Hub Monitor' });
    const setSeen = (agoMs: number) =>
      api.db
        .update(s.terminals)
        .set({ lastSeenAt: new Date(Date.now() - agoMs) })
        .where(eq(s.terminals.id, hub.id));
    const key = `hub_offline:${hub.id}`;

    await setSeen(10 * 60_000);
    const first = await reconcileAlerts(api.db, healthIssues(await snapshot()));
    expect(first.opened.map((alert) => alert.key)).toContain(key);
    expect(first.opened.find((alert) => alert.key === key)).toMatchObject({
      kind: 'hub_offline',
      severity: 'critical',
      organizationId: demo.organizationId,
      subject: expect.stringContaining('Hub «Hub Monitor»'),
    });

    // A minute later, still offline: nothing new to tell.
    const second = await reconcileAlerts(api.db, healthIssues(await snapshot()));
    expect(second.opened.map((alert) => alert.key)).not.toContain(key);
    expect(second.open.filter((alert) => alert.key === key)).toHaveLength(1);

    // The hub pulls again: resolved, once.
    await setSeen(5_000);
    const third = await reconcileAlerts(api.db, healthIssues(await snapshot()));
    expect(third.resolved.map((alert) => alert.key)).toContain(key);
    const fourth = await reconcileAlerts(api.db, healthIssues(await snapshot()));
    expect(fourth.resolved.map((alert) => alert.key)).not.toContain(key);
  });

  it('a failed backup is an issue; the status page needs a support staff member', async () => {
    const now = new Date();
    await api.db.insert(s.platformJobRuns).values({
      job: 'backup',
      ok: false,
      detail: 'restic unreachable',
      startedAt: now,
      finishedAt: now,
    });
    expect(healthIssues(await snapshot())).toContainEqual(
      expect.objectContaining({ key: 'backup_failed', detail: 'restic unreachable' }),
    );
    await reconcileAlerts(api.db, healthIssues(await snapshot()));

    const [staff] = await api.db.select({ id: s.platformStaff.id }).from(s.platformStaff).limit(1);
    const status = await platformStatus({ db: api.db }, { staffId: staff!.id });
    expect(status.alerts).toContainEqual(expect.objectContaining({ kind: 'backup_failed' }));
    expect(status.locations.find((l) => l.locationId === demo.locationId)).toMatchObject({
      organizationId: demo.organizationId,
      devices: expect.any(Array),
    });
    await expect(
      platformStatus({ db: api.db }, { staffId: demo.users.admin.id }),
    ).rejects.toThrow();
  });
});

describe('plans and add-ons (DEC-045)', () => {
  it('a café: two devices, no kitchen display; an add-on and the limit moves; suspended adds nothing', async () => {
    const cafe = await createOtherOrganization(api.db, 'Café Plan');
    const owner = api.as(cafe.session);
    const [staff] = await api.db.select({ id: s.platformStaff.id }).from(s.platformStaff).limit(1);
    const support = { staffId: staff!.id };
    await updateSubscription({ db: api.db }, support, cafe.organizationId, {
      planCode: 'cafe',
      status: 'active',
      addons: [],
      note: null,
    });
    const device = (prefix: string, type = 'pos') =>
      api.request('POST', '/terminals', {
        headers: owner,
        body: { name: `Gerät ${prefix}`, type, orderNumberPrefix: prefix },
      });

    expect((await device('C1')).status).toBe(201);
    expect((await device('C2', 'handheld')).status).toBe(409);
    expect((await device('C2')).status).toBe(201);
    // The hub belongs to the location, not to the plan's devices.
    expect((await device('CH', 'hub')).status).toBe(201);
    const third = await device('C3');
    expect(third.status).toBe(409);
    expect(await third.json()).toMatchObject({
      error: {
        details: { reason: 'plan_limit', limit: 'devices', allowed: 2, used: 2, plan: 'cafe' },
      },
    });
    const kds = await device('C3', 'kds');
    expect(await kds.json()).toMatchObject({
      error: { details: { reason: 'plan_feature', feature: 'kds' } },
    });

    await updateSubscription({ db: api.db }, support, cafe.organizationId, {
      planCode: 'cafe',
      status: 'active',
      addons: [{ code: 'extra_device', quantity: 1 }],
      note: 'Rechnung 2026-10',
    });
    expect((await device('C3')).status).toBe(201);
    const mine = await getMyPlan({ db: api.db }, { ...cafeActor(cafe), permissions: ALL });
    expect(mine).toMatchObject({
      subscription: {
        planCode: 'cafe',
        status: 'active',
        addons: [{ code: 'extra_device', quantity: 1 }],
      },
      limits: { devices: 3, users: 5, locations: 1 },
      usage: { devices: 3, users: 1, locations: 1 },
    });

    // Suspended: nothing new, while what exists keeps working.
    await updateSubscription({ db: api.db }, support, cafe.organizationId, {
      planCode: 'cafe',
      status: 'suspended',
      addons: [{ code: 'extra_device', quantity: 1 }],
      note: null,
    });
    const user = await api.request('POST', '/users', {
      headers: owner,
      body: { displayName: 'Neu', roles: ['waiter'], pin: '4711', locationIds: [cafe.locationId] },
    });
    expect(user.status).toBe(409);
    expect(await user.json()).toMatchObject({
      error: { details: { reason: 'subscription_suspended' } },
    });
    expect((await api.request('GET', '/terminals', { headers: owner })).status).toBe(200);

    const [audit] = await api.db
      .select()
      .from(s.auditEvents)
      .where(eq(s.auditEvents.organizationId, cafe.organizationId));
    expect(audit).toMatchObject({ action: 'subscription.changed', supportStaffId: staff!.id });
  });

  it('an organization from before plans has no limits', async () => {
    const admin = api.as(demoSession(demo, 'admin'));
    for (const prefix of ['P1', 'P2', 'P3']) {
      const created = await api.request('POST', '/terminals', {
        headers: admin,
        body: { name: `Plan ${prefix}`, type: 'kds', orderNumberPrefix: prefix },
      });
      expect(created.status).toBe(201);
    }
  });
});

const ALL = new Set(PERMISSIONS);
const cafeActor = (cafe: { organizationId: string; locationId: string; adminId: string }) =>
  ({
    kind: 'user',
    organizationId: cafe.organizationId,
    locationId: cafe.locationId,
    userId: cafe.adminId,
  }) as const;
