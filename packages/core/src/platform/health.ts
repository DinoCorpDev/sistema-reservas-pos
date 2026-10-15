/**
 * What support must know about now (RNF-16, RNF-01): a hub without signal, a printer in error,
 * synchronization conflicts nobody resolved, events stuck in the outbox, backups too old or a
 * restore test that failed, the cloud degraded. Pure: the monitor reads a snapshot every minute
 * and opens, keeps or resolves one alert per issue key. Practice organizations never alert, and
 * tablets switched off at night do not either: only the hub must always be on.
 */

export const HEALTH_THRESHOLDS = {
  /** The hub pulls every few seconds; five minutes without it is an outage. */
  hubOfflineMs: 5 * 60_000,
  /** An event of the outbox not published after five minutes. */
  outboxLagMs: 5 * 60_000,
  /** The hourly backup: two hours without a good one. */
  backupMaxAgeMs: 2 * 3_600_000,
  /** The monthly restore test, with a few days of margin. */
  restoreTestMaxAgeMs: 35 * 86_400_000,
} as const;

export type HealthIssueKind =
  | 'cloud_down'
  | 'hub_offline'
  | 'printer_error'
  | 'sync_conflicts'
  | 'outbox_lagging'
  | 'backup_stale'
  | 'backup_failed'
  | 'restore_test_failed'
  | 'archive_failed';

export interface HealthIssue {
  /** Stable while the problem lasts: one alert per key. */
  key: string;
  kind: HealthIssueKind;
  severity: 'critical' | 'warning';
  organizationId: string | null;
  locationId: string | null;
  /** What it is about (names only; the e-mail adds the kind): "Hub «Bar» · Zürich · Lalín". */
  subject: string;
  detail: string;
  /** Since when, as far as the data says. */
  since: string;
}

export interface JobRunSummary {
  /** The first good run ever: a backup system that just started is not late for its test. */
  firstOkAt: string | null;
  lastOkAt: string | null;
  /** The newest run, good or bad. */
  last: { ok: boolean; at: string; detail: string | null } | null;
}

export interface HealthSnapshot {
  now: string;
  cloud: { healthy: boolean; detail: string | null };
  /** Backups are expected (production); in development nothing runs them. */
  expectBackups: boolean;
  locations: readonly {
    organizationId: string;
    organizationName: string;
    isTraining: boolean;
    locationId: string;
    locationName: string;
    hubs: readonly { terminalId: string; name: string; lastSeenAt: string | null }[];
    printers: readonly {
      printerId: string;
      name: string;
      lastOkAt: string | null;
      lastError: string | null;
      lastErrorAt: string | null;
    }[];
    unresolvedConflicts: number;
    oldestConflictAt: string | null;
  }[];
  outbox: { pending: number; oldestAt: string | null };
  jobs: { backup: JobRunSummary; restoreTest: JobRunSummary; archive: JobRunSummary };
}

const age = (now: number, at: string | null) => (at ? now - Date.parse(at) : Infinity);

export function healthIssues(snapshot: HealthSnapshot): HealthIssue[] {
  const now = Date.parse(snapshot.now);
  const issues: HealthIssue[] = [];
  const platform = (
    kind: HealthIssueKind,
    severity: HealthIssue['severity'],
    subject: string,
    detail: string,
    since: string,
  ) =>
    issues.push({
      key: kind,
      kind,
      severity,
      organizationId: null,
      locationId: null,
      subject,
      detail,
      since,
    });

  if (!snapshot.cloud.healthy) {
    platform(
      'cloud_down',
      'critical',
      'Cloud',
      snapshot.cloud.detail ?? 'health failed',
      snapshot.now,
    );
  }

  for (const location of snapshot.locations) {
    if (location.isTraining) continue;
    const where = `${location.locationName} · ${location.organizationName}`;
    const scoped = {
      organizationId: location.organizationId,
      locationId: location.locationId,
    };
    const offlineHubs = new Set<string>();
    for (const hub of location.hubs) {
      if (age(now, hub.lastSeenAt) < HEALTH_THRESHOLDS.hubOfflineMs) continue;
      offlineHubs.add(hub.terminalId);
      issues.push({
        key: `hub_offline:${hub.terminalId}`,
        kind: 'hub_offline',
        severity: 'critical',
        ...scoped,
        subject: `Hub «${hub.name}» · ${where}`,
        detail: hub.lastSeenAt ? `no signal since ${hub.lastSeenAt}` : 'never seen',
        since: hub.lastSeenAt ?? snapshot.now,
      });
    }
    // Printer reports come through the hub: while it is offline, its report says nothing new.
    if (offlineHubs.size === 0 || offlineHubs.size < location.hubs.length) {
      for (const printer of location.printers) {
        const failing =
          printer.lastErrorAt !== null &&
          (printer.lastOkAt === null ||
            Date.parse(printer.lastErrorAt) > Date.parse(printer.lastOkAt));
        if (!failing) continue;
        issues.push({
          key: `printer_error:${printer.printerId}`,
          kind: 'printer_error',
          severity: 'warning',
          ...scoped,
          subject: `«${printer.name}» · ${where}`,
          detail: printer.lastError ?? 'error',
          since: printer.lastErrorAt!,
        });
      }
    }
    if (location.unresolvedConflicts > 0) {
      issues.push({
        key: `sync_conflicts:${location.locationId}`,
        kind: 'sync_conflicts',
        severity: 'warning',
        ...scoped,
        subject: where,
        detail: `${location.unresolvedConflicts} unresolved`,
        since: location.oldestConflictAt ?? snapshot.now,
      });
    }
  }

  if (
    snapshot.outbox.pending > 0 &&
    age(now, snapshot.outbox.oldestAt) >= HEALTH_THRESHOLDS.outboxLagMs
  ) {
    platform(
      'outbox_lagging',
      'warning',
      'Outbox',
      `${snapshot.outbox.pending} events waiting`,
      snapshot.outbox.oldestAt ?? snapshot.now,
    );
  }

  const { backup, restoreTest, archive } = snapshot.jobs;
  if (backup.last && !backup.last.ok) {
    platform('backup_failed', 'critical', 'Backup', backup.last.detail ?? 'failed', backup.last.at);
  } else if (
    snapshot.expectBackups &&
    age(now, backup.lastOkAt) >= HEALTH_THRESHOLDS.backupMaxAgeMs
  ) {
    platform(
      'backup_stale',
      'critical',
      'Backup',
      backup.lastOkAt ? `last good backup ${backup.lastOkAt}` : 'no backup yet',
      backup.lastOkAt ?? snapshot.now,
    );
  }
  if (restoreTest.last && !restoreTest.last.ok) {
    platform(
      'restore_test_failed',
      'critical',
      'Restore test',
      restoreTest.last.detail ?? 'failed',
      restoreTest.last.at,
    );
  } else if (
    snapshot.expectBackups &&
    backup.lastOkAt !== null &&
    age(now, restoreTest.lastOkAt) >= HEALTH_THRESHOLDS.restoreTestMaxAgeMs &&
    age(now, backup.firstOkAt) >= HEALTH_THRESHOLDS.restoreTestMaxAgeMs
  ) {
    platform(
      'restore_test_failed',
      'warning',
      'Restore test',
      restoreTest.lastOkAt ? `last good test ${restoreTest.lastOkAt}` : 'never tested',
      restoreTest.lastOkAt ?? snapshot.now,
    );
  }
  if (archive.last && !archive.last.ok) {
    platform(
      'archive_failed',
      'warning',
      'Legal archive',
      archive.last.detail ?? 'failed',
      archive.last.at,
    );
  }
  return issues;
}
