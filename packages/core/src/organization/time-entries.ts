import { z } from 'zod';

/**
 * Working time of the staff (RF-A09, DEC-054). A person clocks in after their PIN and out with
 * "End my shift"; each pair is one entry. Pure: every function takes `now` as an argument.
 */

/** An entry open longer than this is a forgotten exit, not work: the manager completes it. */
export const MAX_OPEN_HOURS = 16;
/** A correction never makes an entry longer than a day. */
export const MAX_ENTRY_HOURS = 24;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export interface TimeEntry {
  id: string;
  userId: string;
  /** Null only when the exit arrived without its entry (it was lost or not synced yet). */
  clockInAt: string | null;
  clockOutAt: string | null;
}

export type TimeEntryStatus = 'open' | 'closed' | 'missing_out' | 'missing_in';

/**
 * Where an entry stands at `now`: still working, closed, an exit forgotten (open longer than
 * `MAX_OPEN_HOURS`) or an exit without its entry.
 */
export function timeEntryStatus(
  entry: Pick<TimeEntry, 'clockInAt' | 'clockOutAt'>,
  now: Date,
): TimeEntryStatus {
  if (!entry.clockInAt) return 'missing_in';
  if (entry.clockOutAt) return 'closed';
  return now.getTime() - Date.parse(entry.clockInAt) > MAX_OPEN_HOURS * HOUR_MS
    ? 'missing_out'
    : 'open';
}

/** Whole minutes of a closed entry; null while it is open or misses one of its times. */
export function workedMinutes(entry: Pick<TimeEntry, 'clockInAt' | 'clockOutAt'>): number | null {
  if (!entry.clockInAt || !entry.clockOutAt) return null;
  const ms = Date.parse(entry.clockOutAt) - Date.parse(entry.clockInAt);
  return ms > 0 ? Math.floor(ms / MINUTE_MS) : 0;
}

/** The entry a person is working on at `now`: the latest open one, ignoring forgotten exits. */
export function openTimeEntryOf<T extends TimeEntry>(
  entries: Iterable<T>,
  userId: string,
  now: Date,
): T | null {
  let found: T | null = null;
  for (const entry of entries) {
    if (entry.userId !== userId || timeEntryStatus(entry, now) !== 'open') continue;
    if (!found || (entry.clockInAt ?? '') > (found.clockInAt ?? '')) found = entry;
  }
  return found;
}

export interface PersonHours {
  userId: string;
  /** Closed entries that count. */
  entries: number;
  minutes: number;
  /** Entries the manager has to complete (no exit, or no entry). */
  incomplete: number;
}

/** Worked minutes per person: closed entries count; the incomplete ones are only counted. */
export function hoursByPerson(entries: Iterable<TimeEntry>, now: Date): PersonHours[] {
  const byUser = new Map<string, PersonHours>();
  for (const entry of entries) {
    const person = byUser.get(entry.userId) ?? {
      userId: entry.userId,
      entries: 0,
      minutes: 0,
      incomplete: 0,
    };
    const status = timeEntryStatus(entry, now);
    if (status === 'closed') {
      person.entries += 1;
      person.minutes += workedMinutes(entry) ?? 0;
    } else if (status !== 'open') {
      person.incomplete += 1;
    }
    byUser.set(entry.userId, person);
  }
  return [...byUser.values()].sort((a, b) => b.minutes - a.minutes);
}

/** "7 h 05" from minutes: hours and zero-padded minutes, the way a timesheet reads. */
export function formatWorked(minutes: number): string {
  const safe = Math.max(0, Math.floor(minutes));
  return `${Math.floor(safe / 60)} h ${String(safe % 60).padStart(2, '0')}`;
}

/**
 * Hand correction of an entry by a manager (DEC-054): both times and the reason, which goes to
 * the audit with the before and after (PA-06). The exit may stay empty while the person works.
 */
export const correctTimeEntrySchema = z
  .object({
    clockInAt: z.iso.datetime({ offset: true }),
    clockOutAt: z.iso.datetime({ offset: true }).nullable(),
    note: z.string().trim().min(1).max(200),
  })
  .refine((v) => v.clockOutAt === null || Date.parse(v.clockOutAt) > Date.parse(v.clockInAt), {
    message: 'The exit must come after the entry',
    path: ['clockOutAt'],
  })
  .refine(
    (v) =>
      v.clockOutAt === null ||
      Date.parse(v.clockOutAt) - Date.parse(v.clockInAt) <= MAX_ENTRY_HOURS * HOUR_MS,
    { message: 'An entry lasts at most 24 hours', path: ['clockOutAt'] },
  );
export type CorrectTimeEntryInput = z.infer<typeof correctTimeEntrySchema>;
