import { describe, expect, it } from 'vitest';
import { HEALTH_THRESHOLDS, type HealthSnapshot, healthIssues } from './health';

const NOW = '2026-10-15T20:00:00.000Z';
const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const healthyJobs = () => ({
  backup: {
    firstOkAt: ago(90 * DAY),
    lastOkAt: ago(20 * MIN),
    last: { ok: true, at: ago(20 * MIN), detail: '12M' },
  },
  restoreTest: {
    firstOkAt: ago(60 * DAY),
    lastOkAt: ago(10 * DAY),
    last: { ok: true, at: ago(10 * DAY), detail: null },
  },
  archive: {
    firstOkAt: ago(40 * DAY),
    lastOkAt: ago(14 * DAY),
    last: { ok: true, at: ago(14 * DAY), detail: null },
  },
});

function snapshot(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    now: NOW,
    cloud: { healthy: true, detail: null },
    expectBackups: true,
    locations: [
      {
        organizationId: 'org',
        organizationName: 'Lalín',
        isTraining: false,
        locationId: 'loc',
        locationName: 'Zürich',
        hubs: [{ terminalId: 'hub', name: 'Hub Bar', lastSeenAt: ago(30_000) }],
        printers: [
          {
            printerId: 'kitchen',
            name: 'Küche',
            lastOkAt: ago(MIN),
            lastError: null,
            lastErrorAt: null,
          },
        ],
        unresolvedConflicts: 0,
        oldestConflictAt: null,
      },
    ],
    outbox: { pending: 0, oldestAt: null },
    jobs: healthyJobs(),
    ...overrides,
  };
}

const location = (patch: Partial<HealthSnapshot['locations'][number]>) => [
  { ...snapshot().locations[0]!, ...patch },
];

describe('what support must know now (RNF-16)', () => {
  it('a healthy platform has no issue', () => {
    expect(healthIssues(snapshot())).toEqual([]);
  });

  it('a hub without signal for five minutes, one alert per hub', () => {
    expect(
      healthIssues(
        snapshot({
          locations: location({
            hubs: [{ terminalId: 'hub', name: 'Hub Bar', lastSeenAt: ago(4 * MIN) }],
          }),
        }),
      ),
    ).toEqual([]);
    const [issue] = healthIssues(
      snapshot({
        locations: location({
          hubs: [
            { terminalId: 'hub', name: 'Hub Bar', lastSeenAt: ago(HEALTH_THRESHOLDS.hubOfflineMs) },
          ],
        }),
      }),
    );
    expect(issue).toMatchObject({
      key: 'hub_offline:hub',
      kind: 'hub_offline',
      severity: 'critical',
      organizationId: 'org',
      locationId: 'loc',
      subject: 'Hub «Hub Bar» · Zürich · Lalín',
      since: ago(5 * MIN),
    });
  });

  it('a printer whose last report is an error; not while its hub is offline', () => {
    const failing = [
      {
        printerId: 'kitchen',
        name: 'Küche',
        lastOkAt: ago(HOUR),
        lastError: 'kein Papier',
        lastErrorAt: ago(MIN),
      },
    ];
    expect(healthIssues(snapshot({ locations: location({ printers: failing }) }))).toEqual([
      expect.objectContaining({
        key: 'printer_error:kitchen',
        detail: 'kein Papier',
        severity: 'warning',
      }),
    ]);
    // It printed again after the error: fine.
    expect(
      healthIssues(
        snapshot({
          locations: location({ printers: [{ ...failing[0]!, lastOkAt: ago(10_000) }] }),
        }),
      ),
    ).toEqual([]);
    const offline = healthIssues(
      snapshot({
        locations: location({
          printers: failing,
          hubs: [{ terminalId: 'hub', name: 'Hub', lastSeenAt: ago(HOUR) }],
        }),
      }),
    );
    expect(offline.map((issue) => issue.kind)).toEqual(['hub_offline']);
  });

  it('conflicts nobody resolved, and an outbox stuck for five minutes', () => {
    const issues = healthIssues(
      snapshot({
        locations: location({ unresolvedConflicts: 3, oldestConflictAt: ago(HOUR) }),
        outbox: { pending: 12, oldestAt: ago(6 * MIN) },
      }),
    );
    expect(issues.map((issue) => [issue.key, issue.detail])).toEqual([
      ['sync_conflicts:loc', '3 unresolved'],
      ['outbox_lagging', '12 events waiting'],
    ]);
    expect(healthIssues(snapshot({ outbox: { pending: 12, oldestAt: ago(MIN) } }))).toEqual([]);
  });

  it('backups: a failed run, or none good for two hours', () => {
    const jobs = healthyJobs();
    expect(
      healthIssues(
        snapshot({
          jobs: {
            ...jobs,
            backup: {
              ...jobs.backup,
              last: { ok: false, at: ago(MIN), detail: 'restic unreachable' },
            },
          },
        }),
      ),
    ).toEqual([expect.objectContaining({ key: 'backup_failed', detail: 'restic unreachable' })]);
    expect(
      healthIssues(
        snapshot({
          jobs: {
            ...jobs,
            backup: {
              ...jobs.backup,
              lastOkAt: ago(2 * HOUR),
              last: { ok: true, at: ago(2 * HOUR), detail: null },
            },
          },
        }),
      ),
    ).toEqual([expect.objectContaining({ key: 'backup_stale', severity: 'critical' })]);
    // In development nothing runs backups: no alert.
    const none = { firstOkAt: null, lastOkAt: null, last: null };
    expect(
      healthIssues(
        snapshot({
          expectBackups: false,
          jobs: { backup: none, restoreTest: none, archive: none },
        }),
      ),
    ).toEqual([]);
  });

  it('the restore test: a failure, or none good for 35 days once backups run that long', () => {
    const jobs = healthyJobs();
    expect(
      healthIssues(
        snapshot({
          jobs: {
            ...jobs,
            restoreTest: {
              ...jobs.restoreTest,
              last: { ok: false, at: ago(HOUR), detail: 'receipts differ' },
            },
          },
        }),
      ),
    ).toEqual([
      expect.objectContaining({
        key: 'restore_test_failed',
        severity: 'critical',
        detail: 'receipts differ',
      }),
    ]);
    const never = { firstOkAt: null, lastOkAt: null, last: null };
    expect(healthIssues(snapshot({ jobs: { ...jobs, restoreTest: never } }))).toEqual([
      expect.objectContaining({
        key: 'restore_test_failed',
        severity: 'warning',
        detail: 'never tested',
      }),
    ]);
    // Backups started last week: the first test is not due yet.
    expect(
      healthIssues(
        snapshot({
          jobs: {
            ...jobs,
            backup: { ...jobs.backup, firstOkAt: ago(7 * DAY) },
            restoreTest: never,
          },
        }),
      ),
    ).toEqual([]);
  });

  it('the cloud degraded and a failed legal archive', () => {
    const jobs = healthyJobs();
    expect(
      healthIssues(
        snapshot({
          cloud: { healthy: false, detail: 'database down' },
          jobs: {
            ...jobs,
            archive: {
              ...jobs.archive,
              last: { ok: false, at: ago(HOUR), detail: '2026-09: boom' },
            },
          },
        }),
      ).map((issue) => [issue.key, issue.severity]),
    ).toEqual([
      ['cloud_down', 'critical'],
      ['archive_failed', 'warning'],
    ]);
  });

  it('a practice restaurant never alerts (RF-F22)', () => {
    expect(
      healthIssues(
        snapshot({
          locations: location({
            isTraining: true,
            unresolvedConflicts: 9,
            hubs: [{ terminalId: 'hub', name: 'Hub', lastSeenAt: null }],
          }),
        }),
      ),
    ).toEqual([]);
  });
});
