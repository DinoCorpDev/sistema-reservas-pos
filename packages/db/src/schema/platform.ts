import {
  bigint,
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
    /** DINOLABS support staff member who acted inside the organization (RF-A10). */
    supportStaffId: uuid('support_staff_id'),
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
    // PIN lockout counts recent failures per terminal (RNF-10).
    index('idx_audit_events_terminal').on(t.organizationId, t.terminalId, t.occurredAt),
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
 * Operation log of the order engine (docs/SYNC.md, DEC-021): every POS operation as received
 * from a device, the hub or the cloud itself. The id is the device's operation id, which is also
 * the idempotency key, so resending never duplicates the effect (RNF-03). `seq` is assigned per
 * location under a lock and is the pull cursor. Conflicts stay here for the manager
 * (`sync.conflict_detected`, RNF-04).
 */
export const syncOperations = mysqlTable(
  'sync_operations',
  {
    id: primaryId(),
    organizationId: organizationId(),
    locationId: locationId(),
    /** Per-location sequence, assigned under the location lock (pull cursor). */
    seq: bigint('seq', { mode: 'number', unsigned: true }).notNull().default(0),
    terminalId: uuid('terminal_id').notNull(),
    userId: uuid('user_id'),
    idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull(),
    operation: varchar('operation', { length: 64 }).notNull(),
    schemaVersion: smallint('schema_version').notNull().default(1),
    /** Hybrid logical clock: canonical fold order `(hlc, id)` (docs/SYNC.md §3). */
    hlc: varchar('hlc', { length: 18 }).notNull().default(''),
    entityType: varchar('entity_type', { length: 48 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    /** Second order of a transfer, merge or split: links the group of orders. */
    relatedEntityId: uuid('related_entity_id'),
    /** The whole operation as the device sent it. */
    payload: json('payload').notNull(),
    baseVersion: int('base_version'),
    deviceCreatedAt: utcDatetime('device_created_at').notNull(),
    receivedAt: utcDatetime('received_at').notNull(),
    appliedAt: utcDatetime('applied_at'),
    status: varchar('status', { length: 16 }).notNull().default('received'),
    conflict: json('conflict'),
    /** On the hub: when the cloud confirmed it (docs/SYNC.md §11.4). */
    cloudAckedAt: utcDatetime('cloud_acked_at'),
    resolvedByUserId: uuid('resolved_by_user_id'),
    resolvedAt: utcDatetime('resolved_at'),
  },
  (t) => [
    uniqueIndex('uq_sync_operations_idempotency').on(t.organizationId, t.idempotencyKey),
    uniqueIndex('uq_sync_operations_seq').on(t.locationId, t.seq),
    index('idx_sync_operations_status').on(t.locationId, t.status),
    index('idx_sync_operations_entity').on(t.locationId, t.entityId),
    index('idx_sync_operations_related').on(t.locationId, t.relatedEntityId),
  ],
);
