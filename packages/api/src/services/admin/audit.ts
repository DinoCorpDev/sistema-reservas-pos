import { inOrg, schema as s } from '@pos/db';
import { and, desc, eq, gte, lt, or, type SQL } from 'drizzle-orm';
import { type Actor, assertPermission } from '../../actor';
import { ApiError } from '../../errors';
import type { ServiceDeps } from '../shared';

/**
 * Audit query (RF-F12): the organization's append-only log (RF-F11), newest first, filtered by
 * date range, user, terminal, action and entity, with cursor pagination.
 */

type AuditRow = typeof s.auditEvents.$inferSelect;

export interface AuditEventDto {
  id: string;
  locationId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  userId: string | null;
  authorizedByUserId: string | null;
  terminalId: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
  requestId: string | null;
  occurredAt: string;
  recordedAt: string;
}

export interface AuditPageDto {
  items: AuditEventDto[];
  /** Pass it as `cursor` to get the next (older) page; null on the last page. */
  nextCursor: string | null;
}

export interface AuditQuery {
  /** Inclusive lower bound of `occurredAt` (ISO date or date-time). */
  from?: string;
  /** Exclusive upper bound of `occurredAt` (ISO date or date-time). */
  to?: string;
  userId?: string;
  terminalId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  limit?: number;
  cursor?: string;
}

const toAuditDto = (row: AuditRow): AuditEventDto => ({
  id: row.id,
  locationId: row.locationId,
  action: row.action,
  entityType: row.entityType,
  entityId: row.entityId,
  userId: row.userId,
  authorizedByUserId: row.authorizedByUserId,
  terminalId: row.terminalId,
  reason: row.reason,
  before: row.before ?? null,
  after: row.after ?? null,
  requestId: row.requestId,
  occurredAt: row.occurredAt.toISOString(),
  recordedAt: row.recordedAt.toISOString(),
});

const encodeCursor = (row: AuditRow) =>
  Buffer.from(JSON.stringify([row.occurredAt.toISOString(), row.id])).toString('base64url');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function decodeCursor(cursor: string): { occurredAt: Date; id: string } {
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [
      string,
      string,
    ];
    const occurredAt = new Date(at);
    if (Number.isNaN(occurredAt.getTime()) || typeof id !== 'string' || !UUID.test(id))
      throw new Error();
    return { occurredAt, id };
  } catch {
    throw new ApiError('BAD_REQUEST', 'Invalid cursor');
  }
}

function parseInstant(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError('BAD_REQUEST', `Invalid ${label}`);
  return date;
}

export async function listAuditEvents(
  deps: ServiceDeps,
  actor: Actor,
  query: AuditQuery = {},
): Promise<AuditPageDto> {
  assertPermission(actor, 'audit.view');
  const a = s.auditEvents;
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const conditions: (SQL | undefined)[] = [
    query.from ? gte(a.occurredAt, parseInstant(query.from, 'from')) : undefined,
    query.to ? lt(a.occurredAt, parseInstant(query.to, 'to')) : undefined,
    query.userId ? eq(a.userId, query.userId) : undefined,
    query.terminalId ? eq(a.terminalId, query.terminalId) : undefined,
    query.action ? eq(a.action, query.action) : undefined,
    query.entityType ? eq(a.entityType, query.entityType) : undefined,
    query.entityId ? eq(a.entityId, query.entityId) : undefined,
  ];
  if (query.cursor) {
    // Ids are UUID v7: within the same millisecond they still sort by creation.
    const cursor = decodeCursor(query.cursor);
    conditions.push(
      or(
        lt(a.occurredAt, cursor.occurredAt),
        and(eq(a.occurredAt, cursor.occurredAt), lt(a.id, cursor.id)),
      ),
    );
  }

  const rows = await deps.db
    .select()
    .from(a)
    .where(inOrg(a, actor, ...conditions))
    .orderBy(desc(a.occurredAt), desc(a.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    items: page.map(toAuditDto),
    nextCursor: rows.length > limit ? encodeCursor(page.at(-1)!) : null,
  };
}
