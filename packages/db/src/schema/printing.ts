import {
  boolean,
  index,
  int,
  json,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { locationId, organizationId, primaryId, utcDatetime, uuid } from '../columns';

/**
 * Printing infrastructure (DEC-031, DEC-032). Only the location hub reaches the printers.
 */

/**
 * Last known state of each printer, as reported by the hub (`POST /sync/printer-status`). Kept out
 * of `printers` on purpose: a printer going offline must not change the configuration version
 * and make every terminal download its configuration again. `id` is the printer id.
 */
export const printerStatus = mysqlTable(
  'printer_status',
  {
    id: uuid('id').primaryKey(),
    organizationId: organizationId(),
    locationId: locationId(),
    lastOkAt: utcDatetime('last_ok_at'),
    lastError: varchar('last_error', { length: 255 }),
    lastErrorAt: utcDatetime('last_error_at'),
    /** Last test page (RF-F17) and whether it printed. */
    lastTestAt: utcDatetime('last_test_at'),
    lastTestOk: boolean('last_test_ok'),
    /** Hub time of the report. */
    reportedAt: utcDatetime('reported_at').notNull(),
  },
  (t) => [index('idx_printer_status_location').on(t.locationId)],
);

/**
 * Print queue of the hub (DEC-031): one job per document derived from an operation, with an
 * idempotent key (`kitchen:<operation>:<station>`, `receipt:<operation>`…), so a restart or an
 * operation received twice never prints twice. Written only in the hub's database.
 */
export const printJobs = mysqlTable(
  'print_jobs',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    jobKey: varchar('job_key', { length: 120 }).notNull(),
    kind: varchar('kind', { length: 16 }).notNull(),
    sourceOperationId: uuid('source_operation_id'),
    printerId: uuid('printer_id').notNull(),
    kitchenStationId: uuid('kitchen_station_id'),
    /** The document to print (`PrintDocument`), rendered when the job was planned. */
    document: json('document').notNull(),
    /** pending | printed | failed | expired */
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    attempts: int('attempts').notNull().default(0),
    lastError: varchar('last_error', { length: 255 }),
    /** Device time of the operation: the age limit counts from it. */
    requestedAt: utcDatetime('requested_at').notNull(),
    nextAttemptAt: utcDatetime('next_attempt_at').notNull(),
    printedAt: utcDatetime('printed_at'),
    createdAt: utcDatetime('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_print_jobs_key').on(t.locationId, t.jobKey),
    index('idx_print_jobs_pending').on(t.status, t.nextAttemptAt),
  ],
);
