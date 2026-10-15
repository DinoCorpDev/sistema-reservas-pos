import type { HealthIssue, HealthSnapshot, JobRunSummary } from '@pos/core';
import { schema as s } from '@pos/db';
import { and, asc, count, desc, eq, inArray, isNull, max, min, sql } from 'drizzle-orm';
import type { ServiceDeps } from '../shared';
import { assertActiveStaff } from './support';

/**
 * Health of the platform (RNF-16): the snapshot the monitor checks every minute and the status
 * page of DINOLABS support shows, and the alerts that follow from it. Reads every organization:
 * only the monitor process and support staff call it.
 */

type Db = ServiceDeps['db'];

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

async function jobSummary(db: Db, job: string): Promise<JobRunSummary> {
  const live = and(eq(s.platformJobRuns.job, job), isNull(s.platformJobRuns.deletedAt));
  const [range] = await db
    .select({ first: min(s.platformJobRuns.finishedAt), last: max(s.platformJobRuns.finishedAt) })
    .from(s.platformJobRuns)
    .where(and(live, eq(s.platformJobRuns.ok, true)));
  const [last] = await db
    .select()
    .from(s.platformJobRuns)
    .where(live)
    .orderBy(desc(s.platformJobRuns.finishedAt))
    .limit(1);
  return {
    firstOkAt: iso(range?.first),
    lastOkAt: iso(range?.last),
    last: last ? { ok: last.ok, at: last.finishedAt.toISOString(), detail: last.detail } : null,
  };
}

/** Everything `healthIssues` looks at, read in a handful of queries. */
export async function loadHealthSnapshot(
  db: Db,
  input: { now?: Date; cloud: HealthSnapshot['cloud']; expectBackups: boolean },
): Promise<HealthSnapshot> {
  const now = input.now ?? new Date();
  const [locations, hubs, printers, conflicts, outbox, backup, restoreTest, archive] =
    await Promise.all([
      db
        .select({
          organizationId: s.organizations.id,
          organizationName: s.organizations.name,
          isTraining: s.organizations.isTraining,
          locationId: s.locations.id,
          locationName: s.locations.name,
        })
        .from(s.locations)
        .innerJoin(s.organizations, eq(s.organizations.id, s.locations.organizationId))
        .where(and(isNull(s.locations.deletedAt), isNull(s.organizations.deletedAt)))
        .orderBy(asc(s.organizations.name), asc(s.locations.name)),
      db
        .select({
          locationId: s.terminals.locationId,
          terminalId: s.terminals.id,
          name: s.terminals.name,
          lastSeenAt: s.terminals.lastSeenAt,
        })
        .from(s.terminals)
        .where(
          and(
            eq(s.terminals.type, 'hub'),
            eq(s.terminals.isActive, true),
            sql`${s.terminals.deviceTokenHash} is not null`,
            isNull(s.terminals.deletedAt),
          ),
        ),
      db
        .select({
          locationId: s.printers.locationId,
          printerId: s.printers.id,
          name: s.printers.name,
          lastOkAt: s.printerStatus.lastOkAt,
          lastError: s.printerStatus.lastError,
          lastErrorAt: s.printerStatus.lastErrorAt,
        })
        .from(s.printers)
        .innerJoin(s.printerStatus, eq(s.printerStatus.id, s.printers.id))
        .where(and(eq(s.printers.isActive, true), isNull(s.printers.deletedAt))),
      db
        .select({
          locationId: s.syncOperations.locationId,
          unresolved: count(),
          oldest: min(s.syncOperations.receivedAt),
        })
        .from(s.syncOperations)
        .where(and(eq(s.syncOperations.status, 'conflict'), isNull(s.syncOperations.resolvedAt)))
        .groupBy(s.syncOperations.locationId),
      db
        .select({ pending: count(), oldest: min(s.outboxEvents.recordedAt) })
        .from(s.outboxEvents)
        .where(isNull(s.outboxEvents.publishedAt)),
      jobSummary(db, 'backup'),
      jobSummary(db, 'restore_test'),
      jobSummary(db, 'archive'),
    ]);
  return {
    now: now.toISOString(),
    cloud: input.cloud,
    expectBackups: input.expectBackups,
    locations: locations.map((location) => {
      const conflict = conflicts.find((c) => c.locationId === location.locationId);
      return {
        ...location,
        hubs: hubs
          .filter((hub) => hub.locationId === location.locationId)
          .map((hub) => ({
            terminalId: hub.terminalId,
            name: hub.name,
            lastSeenAt: iso(hub.lastSeenAt),
          })),
        printers: printers
          .filter((printer) => printer.locationId === location.locationId)
          .map((printer) => ({
            printerId: printer.printerId,
            name: printer.name,
            lastOkAt: iso(printer.lastOkAt),
            lastError: printer.lastError,
            lastErrorAt: iso(printer.lastErrorAt),
          })),
        unresolvedConflicts: Number(conflict?.unresolved ?? 0),
        oldestConflictAt: iso(conflict?.oldest),
      };
    }),
    outbox: { pending: Number(outbox[0]?.pending ?? 0), oldestAt: iso(outbox[0]?.oldest) },
    jobs: { backup, restoreTest, archive },
  };
}

export type AlertRow = typeof s.platformAlerts.$inferSelect;

/**
 * Opens an alert for every new issue, keeps the open ones and resolves those whose issue is
 * gone. Returns what to tell support: the alerts just opened and just resolved.
 */
export async function reconcileAlerts(
  db: Db,
  issues: readonly HealthIssue[],
  now = new Date(),
): Promise<{ opened: AlertRow[]; resolved: AlertRow[]; open: AlertRow[] }> {
  const openRows = await db
    .select()
    .from(s.platformAlerts)
    .where(and(isNull(s.platformAlerts.resolvedAt), isNull(s.platformAlerts.deletedAt)));
  const byKey = new Map(openRows.map((row) => [row.key, row]));
  const current = new Set(issues.map((issue) => issue.key));

  const fresh = issues.filter((issue) => !byKey.has(issue.key));
  if (fresh.length > 0) {
    await db.insert(s.platformAlerts).values(
      fresh.map((issue) => ({
        key: issue.key,
        kind: issue.kind,
        severity: issue.severity,
        organizationId: issue.organizationId,
        locationId: issue.locationId,
        subject: issue.subject.slice(0, 255),
        detail: issue.detail,
        since: new Date(issue.since),
        openedAt: now,
      })),
    );
  }
  const gone = openRows.filter((row) => !current.has(row.key));
  if (gone.length > 0) {
    await db
      .update(s.platformAlerts)
      .set({ resolvedAt: now })
      .where(
        inArray(
          s.platformAlerts.id,
          gone.map((row) => row.id),
        ),
      );
  }
  const opened =
    fresh.length === 0
      ? []
      : await db
          .select()
          .from(s.platformAlerts)
          .where(
            and(
              isNull(s.platformAlerts.resolvedAt),
              inArray(
                s.platformAlerts.key,
                fresh.map((issue) => issue.key),
              ),
            ),
          );
  const open = await db
    .select()
    .from(s.platformAlerts)
    .where(and(isNull(s.platformAlerts.resolvedAt), isNull(s.platformAlerts.deletedAt)))
    .orderBy(asc(s.platformAlerts.openedAt));
  return { opened, resolved: gone.map((row) => ({ ...row, resolvedAt: now })), open };
}

/** Marks alerts as told to support (opened or resolved), so they are e-mailed once. */
export async function markNotified(
  db: Db,
  rows: readonly AlertRow[],
  field: 'notifiedAt' | 'resolvedNotifiedAt',
  now = new Date(),
) {
  if (rows.length === 0) return;
  await db
    .update(s.platformAlerts)
    .set({ [field]: now })
    .where(
      inArray(
        s.platformAlerts.id,
        rows.map((row) => row.id),
      ),
    );
}

export interface PlatformStatusDto {
  checkedAt: string;
  alerts: {
    id: string;
    kind: string;
    severity: string;
    subject: string;
    detail: string | null;
    since: string;
    openedAt: string;
    organizationId: string | null;
  }[];
  locations: (HealthSnapshot['locations'][number] & {
    devices: {
      terminalId: string;
      name: string;
      appVersion: string | null;
      lastSeenAt: string | null;
    }[];
  })[];
  outbox: HealthSnapshot['outbox'];
  jobs: HealthSnapshot['jobs'];
}

/** `/support` › Status: open alerts and, per location, hubs, devices with versions, printers. */
export async function platformStatus(
  deps: ServiceDeps,
  staff: { staffId: string },
): Promise<PlatformStatusDto> {
  await assertActiveStaff(deps.db, staff.staffId);
  const snapshot = await loadHealthSnapshot(deps.db, {
    cloud: { healthy: true, detail: null },
    expectBackups: process.env.MONITOR_EXPECT_BACKUPS !== 'false',
  });
  const [alerts, devices] = await Promise.all([
    deps.db
      .select()
      .from(s.platformAlerts)
      .where(and(isNull(s.platformAlerts.resolvedAt), isNull(s.platformAlerts.deletedAt)))
      .orderBy(asc(s.platformAlerts.openedAt)),
    deps.db
      .select({
        locationId: s.terminals.locationId,
        terminalId: s.terminals.id,
        name: s.terminals.name,
        appVersion: s.terminals.appVersion,
        lastSeenAt: s.terminals.lastSeenAt,
        presenceVersion: s.terminalPresence.appVersion,
        presenceSeenAt: s.terminalPresence.lastSeenAt,
      })
      .from(s.terminals)
      .leftJoin(s.terminalPresence, eq(s.terminalPresence.id, s.terminals.id))
      .where(
        and(
          eq(s.terminals.isActive, true),
          sql`${s.terminals.deviceTokenHash} is not null`,
          isNull(s.terminals.deletedAt),
        ),
      )
      .orderBy(asc(s.terminals.name)),
  ]);
  const newest = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : (a ?? b));
  return {
    checkedAt: snapshot.now,
    alerts: alerts.map((alert) => ({
      id: alert.id,
      kind: alert.kind,
      severity: alert.severity,
      subject: alert.subject,
      detail: alert.detail,
      since: alert.since.toISOString(),
      openedAt: alert.openedAt.toISOString(),
      organizationId: alert.organizationId,
    })),
    locations: snapshot.locations.map((location) => ({
      ...location,
      devices: devices
        .filter((device) => device.locationId === location.locationId)
        .map((device) => ({
          terminalId: device.terminalId,
          name: device.name,
          // A device on the LAN talks to the hub: its presence, forwarded, is the fresher news.
          appVersion: device.presenceVersion ?? device.appVersion,
          lastSeenAt: iso(newest(device.lastSeenAt, device.presenceSeenAt)),
        })),
    })),
    outbox: snapshot.outbox,
    jobs: snapshot.jobs,
  };
}
