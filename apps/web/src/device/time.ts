import { type FoldState, newId, openTimeEntryOf, type TimeEntryState } from '@pos/core';
import { dispatch } from './engine';
import { makeOperation } from './operations';
import { getPos } from './store';
import { requestSync } from './sync';

/**
 * The clock of the staff on the device (RF-A09, DEC-054): clocking in and out are operations like
 * any other, so they work offline and reach the cloud with the next sync. The device knows who is
 * clocked in from its fold, including what other devices of the location sent.
 */

/** The entry the person is working on now, if any. */
export function openEntryOf(
  fold: FoldState,
  userId: string,
  now: Date = new Date(),
): TimeEntryState | null {
  return openTimeEntryOf(fold.timeEntries.values(), userId, now);
}

/** Starts the working time of the person who unlocked the terminal. */
export async function clockIn(): Promise<void> {
  await dispatch(await makeOperation('staff.clock_in', null, { timeEntryId: newId() }));
  requestSync();
}

/** Ends the open entry of the person who unlocked the terminal; nothing if there is none. */
export async function clockOut(): Promise<void> {
  const { fold, user } = getPos();
  const entry = user ? openEntryOf(fold, user.id) : null;
  if (!entry) return;
  await dispatch(await makeOperation('staff.clock_out', null, { timeEntryId: entry.id }));
  requestSync();
}
