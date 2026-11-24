import {
  addDays,
  businessDate,
  type correctTimeEntrySchema,
  hoursByPerson,
  parseLocationSettings,
  type PersonHours,
  type ReportPeriod,
  timeEntryStatus,
  type TimeEntryStatus,
  workedMinutes,
} from '@pos/core';
import { inLocation, notDeleted, runCommand, schema as s } from '@pos/db';
import { and, asc, eq, gte, isNull, lt, or } from 'drizzle-orm';
import type { z } from 'zod';
import { type Actor, assertPermission, requireLocationId, requireUserId } from '../../actor';
import { ApiError, notFound } from '../../errors';
import type { ServiceDeps } from '../shared';

// ── Working time of the staff (RF-A09, DEC-054) ─────────────────────────────

export interface TimeEntryDto {
  id: string;
  userId: string;
  userName: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  /** Business day of the entry (DEC-022): a shift past midnight stays on its day. */
  businessDate: string;
  minutes: number | null;
  status: TimeEntryStatus;
  corrected: boolean;
  note: string | null;
}

export interface TimesheetDto {
  timezone: string;
  entries: TimeEntryDto[];
  people: (PersonHours & { userName: string })[];
  totalMinutes: number;
  incomplete: number;
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

async function locationClock(deps: ServiceDeps, actor: Actor) {
  const locationId = requireLocationId(actor);
  const [location] = await deps.db
    .select({ timezone: s.locations.timezone, settings: s.locations.settings })
    .from(s.locations)
    .where(
      and(eq(s.locations.id, locationId), eq(s.locations.organizationId, actor.organizationId)),
    );
  if (!location) throw new ApiError('NOT_FOUND', 'Location not found');
  return {
    timezone: location.timezone,
    dayStartsAt: parseLocationSettings(location.settings).businessDayStartsAt,
  };
}

/**
 * The timesheet of the location for some business days: every entry with its hours and status,
 * and the hours per person. Only closed entries count; open and incomplete ones are listed so the
 * manager can complete them.
 */
export async function listTimeEntries(
  deps: ServiceDeps,
  actor: Actor,
  period: ReportPeriod,
  now: Date = new Date(),
): Promise<TimesheetDto> {
  assertPermission(actor, 'time.manage');
  const { timezone, dayStartsAt } = await locationClock(deps, actor);
  // A generous UTC window around the days; the business date decides below.
  const start = new Date(`${addDays(period.from, -1)}T00:00:00Z`);
  const end = new Date(`${addDays(period.to, 2)}T00:00:00Z`);
  const inWindow = (column: typeof s.timeEntries.clockInAt) =>
    and(gte(column, start), lt(column, end));
  const rows = await deps.db
    .select({
      id: s.timeEntries.id,
      userId: s.timeEntries.userId,
      userName: s.users.displayName,
      clockInAt: s.timeEntries.clockInAt,
      clockOutAt: s.timeEntries.clockOutAt,
      correctedByUserId: s.timeEntries.correctedByUserId,
      note: s.timeEntries.note,
    })
    .from(s.timeEntries)
    .leftJoin(
      s.users,
      and(eq(s.users.id, s.timeEntries.userId), eq(s.users.organizationId, actor.organizationId)),
    )
    .where(
      inLocation(
        s.timeEntries,
        actor,
        notDeleted(s.timeEntries),
        or(
          inWindow(s.timeEntries.clockInAt),
          and(isNull(s.timeEntries.clockInAt), inWindow(s.timeEntries.clockOutAt)),
        ),
      ),
    )
    .orderBy(asc(s.timeEntries.clockInAt));

  const entries: TimeEntryDto[] = [];
  for (const row of rows) {
    const anchor = row.clockInAt ?? row.clockOutAt;
    if (!anchor) continue;
    const day = businessDate(anchor, timezone, dayStartsAt);
    if (day < period.from || day > period.to) continue;
    const entry = { clockInAt: iso(row.clockInAt), clockOutAt: iso(row.clockOutAt) };
    entries.push({
      id: row.id,
      userId: row.userId,
      userName: row.userName ?? '—',
      ...entry,
      businessDate: day,
      minutes: workedMinutes(entry),
      status: timeEntryStatus(entry, now),
      corrected: row.correctedByUserId !== null,
      note: row.note,
    });
  }
  const names = new Map(entries.map((entry) => [entry.userId, entry.userName]));
  const people = hoursByPerson(
    entries.map((entry) => ({ ...entry })),
    now,
  ).map((person) => ({ ...person, userName: names.get(person.userId) ?? '—' }));
  return {
    timezone,
    entries,
    people,
    totalMinutes: people.reduce((sum, person) => sum + person.minutes, 0),
    incomplete: people.reduce((sum, person) => sum + person.incomplete, 0),
  };
}

/**
 * A manager fixes the times of an entry (a forgotten exit, a wrong entry): the change keeps who
 * made it and why, and goes to the audit with the before and after (PA-06). From then on the
 * device's late operations no longer change it (sync/time-entries.ts).
 */
export async function correctTimeEntry(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: z.output<typeof correctTimeEntrySchema>,
): Promise<void> {
  assertPermission(actor, 'time.manage');
  requireLocationId(actor);
  const correctedByUserId = requireUserId(actor);
  await runCommand(deps.db, actor, async (tx, recorder) => {
    const [current] = await tx
      .select({
        clockInAt: s.timeEntries.clockInAt,
        clockOutAt: s.timeEntries.clockOutAt,
        note: s.timeEntries.note,
      })
      .from(s.timeEntries)
      .where(inLocation(s.timeEntries, actor, eq(s.timeEntries.id, id), notDeleted(s.timeEntries)))
      .for('update');
    if (!current) throw notFound('Time entry');
    const now = new Date();
    const after = {
      clockInAt: new Date(input.clockInAt),
      clockOutAt: input.clockOutAt ? new Date(input.clockOutAt) : null,
    };
    await tx
      .update(s.timeEntries)
      .set({
        ...after,
        note: input.note,
        correctedByUserId,
        correctedAt: now,
        updatedAt: now,
      })
      .where(inLocation(s.timeEntries, actor, eq(s.timeEntries.id, id)));
    recorder.audit({
      action: 'staff.time_corrected',
      entityType: 'time_entry',
      entityId: id,
      before: { clockInAt: iso(current.clockInAt), clockOutAt: iso(current.clockOutAt) },
      after: { clockInAt: iso(after.clockInAt), clockOutAt: iso(after.clockOutAt) },
      reason: input.note,
    });
  });
}
