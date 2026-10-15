import { healthIssues } from '@pos/core';
import { schema as s } from '@pos/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  loadHealthSnapshot,
  platformStatus,
  reconcileAlerts,
} from '../services/admin/platform-health';
import { createTestApi, type DemoContext, demoSession, loadDemo, pairTerminal } from '../testing';

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
