import { index, mysqlTable, varchar } from 'drizzle-orm/mysql-core';
import {
  locationId,
  organizationId,
  primaryId,
  syncColumns,
  timestamps,
  utcDatetime,
  uuid,
} from '../columns';

/**
 * Working time of one person: from `staff.clock_in` to `staff.clock_out` (RF-A09, DEC-054).
 * Written by the projection of those operations, keyed by the entry id made on the device; a
 * manager's correction changes the times, keeps who made it and goes to the audit.
 */
export const timeEntries = mysqlTable(
  'time_entries',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    userId: uuid('user_id').notNull(),
    /** Null while only the exit arrived. */
    clockInAt: utcDatetime('clock_in_at'),
    clockOutAt: utcDatetime('clock_out_at'),
    clockInTerminalId: uuid('clock_in_terminal_id'),
    clockOutTerminalId: uuid('clock_out_terminal_id'),
    /** The manager who corrected it last; the device's times no longer overwrite it. */
    correctedByUserId: uuid('corrected_by_user_id'),
    correctedAt: utcDatetime('corrected_at'),
    note: varchar('note', { length: 200 }),
    ...syncColumns(),
    ...timestamps(),
  },
  (t) => [
    index('idx_time_entries_location_in').on(t.locationId, t.clockInAt),
    index('idx_time_entries_user').on(t.organizationId, t.userId, t.clockInAt),
  ],
);
