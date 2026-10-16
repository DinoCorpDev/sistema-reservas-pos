import { healthIssues, PERMISSIONS } from '@pos/core';
import { schema as s } from '@pos/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  loadHealthSnapshot,
  platformStatus,
  reconcileAlerts,
} from '../services/admin/platform-health';
import { getSetupChecklist } from '../services/admin/setup';
import { onboardOrganization } from '../services/admin/support';
import { getMyPlan, updateSubscription } from '../services/platform/plans';
import {
  createTraining,
  getTraining,
  issueTrainingPairingCode,
} from '../services/platform/training';
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

  it('onboarding a café: café plan, a «Team» role without money powers and counter service', async () => {
    const [staff] = await api.db.select({ id: s.platformStaff.id }).from(s.platformStaff).limit(1);
    const created = await onboardOrganization(
      { db: api.db },
      { staffId: staff!.id },
      {
        profile: 'cafe',
        organization: {
          name: 'Café Lausanne',
          legalName: 'Café Lausanne Sàrl',
          defaultLanguage: 'fr',
        },
        location: {
          name: 'Café Lausanne',
          legalName: 'Café Lausanne Sàrl',
          street: 'Bahnhofstrasse 1',
          postalCode: '8001',
          city: 'Zürich',
          canton: 'ZH',
          vatUid: null,
          languages: ['fr'],
          kitchenLanguage: 'fr',
        },
        owner: { displayName: 'Dueña', email: 'cafe-profile@example.test', uiLanguage: 'es' },
      },
    );
    const actor = {
      kind: 'user',
      organizationId: created.organizationId,
      locationId: created.locationId,
      userId: created.ownerUserId,
      permissions: ALL,
    } as const;

    const mine = await getMyPlan({ db: api.db }, actor);
    expect(mine.subscription).toMatchObject({ planCode: 'cafe', status: 'active' });

    const [team] = await api.db
      .select({ id: s.roles.id, name: s.roles.name })
      .from(s.roles)
      .where(and(eq(s.roles.organizationId, created.organizationId), eq(s.roles.key, 'team')));
    expect(team?.name).toBe('Équipe');
    const granted = (
      await api.db
        .select({ permission: s.rolePermissions.permission })
        .from(s.rolePermissions)
        .where(eq(s.rolePermissions.roleId, team!.id))
    ).map((row) => row.permission);
    expect(granted).toEqual(expect.arrayContaining(['order.create', 'payment.take', 'shift.open']));
    for (const forbidden of ['report.view', 'day.close', 'approval.grant', 'location.manage']) {
      expect(granted).not.toContain(forbidden);
    }

    // At the counter the checklist does not ask for a floor plan.
    const checklist = await getSetupChecklist({ db: api.db }, actor);
    expect(checklist.checks.filter((c) => c.key === 'areas' || c.key === 'tables')).toEqual([
      { key: 'areas', done: true },
      { key: 'tables', done: true },
    ]);
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

describe('training mode (RF-F22)', () => {
  it('a copy of its own: same menu, floor and PINs; its devices pair from the real backoffice', async () => {
    const [source] = await api.db
      .select()
      .from(s.organizations)
      .where(eq(s.organizations.id, demo.organizationId));
    const owner = { ...demoActor(), permissions: ALL };
    const training = await createTraining({ db: api.db }, owner);

    const [copy] = await api.db
      .select()
      .from(s.organizations)
      .where(eq(s.organizations.id, training.organizationId));
    expect(copy).toMatchObject({
      isTraining: true,
      trainingOfId: demo.organizationId,
      pinKey: source!.pinKey,
    });

    // The same menu, floor and staff, every reference inside the copy.
    const countIn = async (
      table: typeof s.products | typeof s.diningTables | typeof s.users,
      org: string,
    ) =>
      (await api.db.select({ id: table.id }).from(table).where(eq(table.organizationId, org)))
        .length;
    for (const table of [s.products, s.diningTables, s.users]) {
      expect(await countIn(table, training.organizationId)).toBe(
        await countIn(table, demo.organizationId),
      );
    }
    const products = await api.db
      .select({ categoryId: s.products.categoryId, taxCategoryId: s.products.taxCategoryId })
      .from(s.products)
      .where(eq(s.products.organizationId, training.organizationId));
    const categories = await api.db
      .select({ id: s.categories.id })
      .from(s.categories)
      .where(
        inArray(
          s.categories.id,
          products.map((p) => p.categoryId),
        ),
      );
    expect(new Set(categories.map((c) => c.id)).size).toBeGreaterThan(0);
    const foreign = await api.db
      .select({ id: s.categories.id })
      .from(s.categories)
      .where(
        and(
          inArray(
            s.categories.id,
            products.map((p) => p.categoryId),
          ),
          eq(s.categories.organizationId, demo.organizationId),
        ),
      );
    expect(foreign).toEqual([]);

    // Staff practise with their PIN, never with the real sign-in.
    const staff = await api.db
      .select()
      .from(s.users)
      .where(eq(s.users.organizationId, training.organizationId));
    expect(staff.every((user) => user.email === null && user.passwordHash === null)).toBe(true);
    const realLookups = (
      await api.db
        .select({ pinLookup: s.users.pinLookup })
        .from(s.users)
        .where(eq(s.users.organizationId, demo.organizationId))
    ).map((user) => user.pinLookup);
    expect(staff.map((user) => user.pinLookup).sort()).toEqual(realLookups.sort());
    const printers = await api.db
      .select({ isActive: s.printers.isActive })
      .from(s.printers)
      .where(eq(s.printers.organizationId, training.organizationId));
    expect(printers.every((printer) => !printer.isActive)).toBe(true);

    // A practice POS pairs with a code from the real backoffice and knows it is practice.
    const device = training.terminals.find((terminal) => terminal.type === 'pos')!;
    expect(device.isPaired).toBe(false);
    const { code } = await issueTrainingPairingCode({ db: api.db }, owner, device.id);
    const paired = await api.request('POST', '/terminals/pair', { body: { code } });
    expect(paired.status).toBe(200);
    const { deviceToken } = (await paired.json()) as { deviceToken: string };
    const bootstrap = (await (
      await api.request('GET', '/pos/bootstrap', { headers: { 'x-terminal-token': deviceToken } })
    ).json()) as { organization: { id: string; isTraining: boolean } };
    expect(bootstrap.organization).toEqual(
      expect.objectContaining({ id: training.organizationId, isTraining: true }),
    );

    // The real backoffice never lists practice devices; a code for a real one is refused.
    const real = await api.request('GET', '/terminals', {
      headers: api.as(demoSession(demo, 'admin')),
    });
    const realIds = ((await real.json()) as { id: string }[]).map((terminal) => terminal.id);
    expect(realIds).not.toContain(device.id);
    await expect(
      issueTrainingPairingCode({ db: api.db }, owner, realIds[0]!),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // A new copy replaces the old one: retired, its devices unpaired, nothing deleted.
    const renewed = await createTraining({ db: api.db }, owner);
    expect(renewed.organizationId).not.toBe(training.organizationId);
    const [retired] = await api.db
      .select()
      .from(s.organizations)
      .where(eq(s.organizations.id, training.organizationId));
    expect(retired?.deletedAt).not.toBeNull();
    const [unpaired] = await api.db
      .select({ token: s.terminals.deviceTokenHash })
      .from(s.terminals)
      .where(eq(s.terminals.id, device.id));
    expect(unpaired?.token).toBeNull();
    expect((await getTraining({ db: api.db }, owner))?.organizationId).toBe(renewed.organizationId);
    const live = await api.db
      .select({ id: s.organizations.id })
      .from(s.organizations)
      .where(
        and(
          eq(s.organizations.trainingOfId, demo.organizationId),
          isNull(s.organizations.deletedAt),
        ),
      );
    expect(live).toEqual([{ id: renewed.organizationId }]);
  });
});

const demoActor = () =>
  ({
    kind: 'user',
    organizationId: demo.organizationId,
    locationId: demo.locationId,
    userId: demo.users.admin.id,
    requestId: null,
  }) as const;
