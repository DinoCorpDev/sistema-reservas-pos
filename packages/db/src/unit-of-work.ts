import { type EventType, newId } from '@pos/core';
import type { Database } from './client';
import { auditEvents, outboxEvents } from './schema';
import type { TenantContext } from './tenant';

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface AuditRecord {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  /** Overrides the context's location (null for organization-level changes). */
  locationId?: string | null;
}

export interface EventRecord {
  type: EventType;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  schemaVersion?: number;
  locationId?: string | null;
}

export interface CommandRecorder {
  /** Append-only audit of a sensitive change (RF-F11, RF-B17). */
  audit(record: AuditRecord): void;
  /** Event published after commit through the outbox (PA-10). */
  event(record: EventRecord): void;
}

/**
 * Runs a command in ONE transaction: the change, its audit records and its outbox events are
 * committed together or not at all (PA-10, RF-F11). Nothing is published before the commit.
 */
export async function runCommand<T>(
  db: Database,
  ctx: TenantContext,
  work: (tx: Transaction, recorder: CommandRecorder) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const audits: AuditRecord[] = [];
    const events: EventRecord[] = [];
    const result = await work(tx, {
      audit: (record) => audits.push(record),
      event: (record) => events.push(record),
    });

    const recordedAt = new Date();
    const occurredAt = ctx.occurredAt ?? recordedAt;
    const locationOf = (record: { locationId?: string | null }) =>
      record.locationId !== undefined ? record.locationId : (ctx.locationId ?? null);

    if (audits.length > 0) {
      await tx.insert(auditEvents).values(
        audits.map((record) => ({
          id: newId(),
          organizationId: ctx.organizationId,
          locationId: locationOf(record),
          action: record.action,
          entityType: record.entityType,
          entityId: record.entityId ?? null,
          userId: ctx.userId ?? null,
          authorizedByUserId: ctx.authorizedByUserId ?? null,
          terminalId: ctx.terminalId ?? null,
          supportStaffId: ctx.supportStaffId ?? null,
          reason: record.reason ?? null,
          before: record.before ?? null,
          after: record.after ?? null,
          requestId: ctx.requestId ?? null,
          occurredAt,
          recordedAt,
        })),
      );
    }
    if (events.length > 0) {
      await tx.insert(outboxEvents).values(
        events.map((record) => ({
          id: newId(),
          organizationId: ctx.organizationId,
          locationId: locationOf(record),
          type: record.type,
          schemaVersion: record.schemaVersion ?? 1,
          aggregateType: record.aggregateType,
          aggregateId: record.aggregateId,
          payload: record.payload ?? {},
          userId: ctx.userId ?? null,
          terminalId: ctx.terminalId ?? null,
          occurredAt,
          recordedAt,
        })),
      );
    }
    return result;
  });
}
