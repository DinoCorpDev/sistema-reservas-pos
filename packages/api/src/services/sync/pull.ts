import type { Operation } from '@pos/core';
import { schema as s } from '@pos/db';
import { and, asc, eq, gt } from 'drizzle-orm';
import { type Actor, requireTerminal } from '../../actor';
import { configVersion } from './config-version';
import type { SyncDeps } from './push';
import type { StoredConflict } from './store';

export const MAX_PULL_OPERATIONS = 500;

export interface PulledOperation {
  operation: Operation;
  seq: number;
  status: string;
  conflicts: StoredConflict[];
  /** The cloud has it (always true in the cloud; on the hub once the cloud confirmed it). */
  cloudAcked: boolean;
}

/**
 * `GET /sync/pull` (docs/SYNC.md §6.2): the location's operations after a cursor, in `seq`
 * order. `seq` is assigned under the location lock, so a reader never skips a row that commits
 * later with a lower number. Every response carries the configuration version (RF-F23).
 */
export async function pullOperations(
  deps: SyncDeps,
  actor: Actor,
  query: { after: number; limit?: number },
): Promise<{
  operations: PulledOperation[];
  cursor: number;
  hasMore: boolean;
  configVersion: string;
  serverTime: string;
}> {
  const { locationId } = requireTerminal(actor);
  const limit = Math.min(Math.max(query.limit ?? MAX_PULL_OPERATIONS, 1), MAX_PULL_OPERATIONS);
  const rows = await deps.db
    .select({
      seq: s.syncOperations.seq,
      status: s.syncOperations.status,
      conflict: s.syncOperations.conflict,
      payload: s.syncOperations.payload,
      cloudAckedAt: s.syncOperations.cloudAckedAt,
    })
    .from(s.syncOperations)
    .where(
      and(
        eq(s.syncOperations.organizationId, actor.organizationId),
        eq(s.syncOperations.locationId, locationId),
        gt(s.syncOperations.seq, query.after),
      ),
    )
    .orderBy(asc(s.syncOperations.seq))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const isCloud = (deps.node?.kind ?? 'cloud') === 'cloud';
  return {
    operations: page.map((row) => ({
      operation: row.payload as Operation,
      seq: Number(row.seq),
      status: row.status,
      conflicts: (row.conflict as StoredConflict[] | null) ?? [],
      cloudAcked: isCloud || row.cloudAckedAt !== null,
    })),
    cursor: page.length > 0 ? Number(page[page.length - 1]!.seq) : query.after,
    hasMore: rows.length > limit,
    // On the hub, the cloud's version as last seen (the hub keeps no catalog); '' = unknown.
    configVersion: deps.node?.configVersion
      ? (deps.node.configVersion() ?? '')
      : await configVersion(deps.db, { organizationId: actor.organizationId, locationId }),
    serverTime: new Date().toISOString(),
  };
}
