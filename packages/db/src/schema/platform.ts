import {
  index,
  int,
  json,
  mysqlTable,
  smallint,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { locationId, organizationId, primaryId, utcDatetime, uuid } from '../columns';

/**
 * Append-only audit of every sensitive operation (RF-F11, RN-10, RN-11): who, who authorized,
 * what, when, where, previous and new state, and reason. Kept for 10 years (RF-F13).
 * APPEND-ONLY: the migration installs triggers that reject UPDATE and DELETE.
 * `locationId` is null for organization-level operations (e.g. a catalog price change).
 */
export const auditEvents = mysqlTable(
  'audit_events',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: uuid('location_id'),
    action: varchar('action', { length: 64 }).notNull(),
    entityType: varchar('entity_type', { length: 48 }).notNull(),
    entityId: uuid('entity_id'),
    userId: uuid('user_id'),
    authorizedByUserId: uuid('authorized_by_user_id'),
    terminalId: uuid('terminal_id'),
    reason: text('reason'),
    before: json('before'),
    after: json('after'),
    requestId: varchar('request_id', { length: 64 }),
    /** Device time. */
    occurredAt: utcDatetime('occurred_at').notNull(),
    /** Server time when recorded. */
    recordedAt: utcDatetime('recorded_at').notNull(),
  },
  (t) => [
    index('idx_audit_events_org_time').on(t.organizationId, t.occurredAt),
    index('idx_audit_events_entity').on(t.organizationId, t.entityType, t.entityId),
    index('idx_audit_events_user').on(t.organizationId, t.userId),
  ],
);

/**
 * Event outbox (PA-10): written in the same transaction as the change and delivered later by a
 * publisher. Only `publishedAt`, `attempts` and `lastError` are updated.
 */
export const outboxEvents = mysqlTable(
  'outbox_events',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: uuid('location_id'),
    type: varchar('type', { length: 64 }).notNull(),
    schemaVersion: smallint('schema_version').notNull().default(1),
    aggregateType: varchar('aggregate_type', { length: 48 }).notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    payload: json('payload').notNull(),
    userId: uuid('user_id'),
    terminalId: uuid('terminal_id'),
    occurredAt: utcDatetime('occurred_at').notNull(),
    recordedAt: utcDatetime('recorded_at').notNull(),
    publishedAt: utcDatetime('published_at'),
    attempts: int('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [
    index('idx_outbox_events_pending').on(t.publishedAt, t.recordedAt),
    index('idx_outbox_events_aggregate').on(t.aggregateType, t.aggregateId),
  ],
);

/**
 * Operation made offline, received by the hub or the cloud (RNF-03, RNF-04). The idempotency
 * key makes resending it not duplicate the effect; conflicts stay here for the manager
 * to resolve (`sync.conflict_detected`).
 */
export const syncOperations = mysqlTable(
  'sync_operations',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    terminalId: uuid('terminal_id').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull(),
    operation: varchar('operation', { length: 64 }).notNull(),
    entityType: varchar('entity_type', { length: 48 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    payload: json('payload').notNull(),
    baseVersion: int('base_version'),
    deviceCreatedAt: utcDatetime('device_created_at').notNull(),
    receivedAt: utcDatetime('received_at').notNull(),
    appliedAt: utcDatetime('applied_at'),
    status: varchar('status', { length: 16 }).notNull().default('received'),
    conflict: json('conflict'),
    resolvedByUserId: uuid('resolved_by_user_id'),
    resolvedAt: utcDatetime('resolved_at'),
  },
  (t) => [
    uniqueIndex('uq_sync_operations_idempotency').on(t.organizationId, t.idempotencyKey),
    index('idx_sync_operations_status').on(t.locationId, t.status),
  ],
);
