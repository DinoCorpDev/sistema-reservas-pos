import { type PulledOperation, type PushResult, sync } from '@pos/api';
import type { Operation } from '@pos/core';
import { type Database, schema as s } from '@pos/db';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { type CloudFetch, cloudJson } from './cloud';

/**
 * The hub between the terminals and the cloud (docs/SYNC.md §11.1, §11.4):
 * - forwards to the cloud the operations it received, with their original ids (the cloud
 *   dedupes), and marks them confirmed;
 * - brings from the cloud the operations that reached it directly (terminals that could not
 *   reach the hub), so every terminal on the LAN sees them.
 */

export type HubScope = sync.SyncScope;

const BATCH = 200;

/** Forwards one batch; returns how many operations the cloud confirmed. */
export async function forwardToCloud(db: Database, cloud: CloudFetch, scope: HubScope) {
  const rows = await db
    .select({ id: s.syncOperations.id, payload: s.syncOperations.payload })
    .from(s.syncOperations)
    .where(
      and(
        eq(s.syncOperations.locationId, scope.locationId),
        isNull(s.syncOperations.cloudAckedAt),
        ne(s.syncOperations.status, 'rejected'),
      ),
    )
    .orderBy(asc(s.syncOperations.seq))
    .limit(BATCH);
  if (rows.length === 0) return 0;
  const { results } = await cloudJson<{ results: PushResult[] }>(cloud, '/sync/push', {
    method: 'POST',
    body: { operations: rows.map((row) => row.payload) },
  });
  const now = new Date();
  let confirmed = 0;
  for (const [index, row] of rows.entries()) {
    const result = results[index];
    if (!result) continue;
    const set =
      result.status === 'rejected'
        ? { status: 'rejected', conflict: result.conflicts }
        : {
            cloudAckedAt: now,
            status: result.status === 'duplicate' ? 'applied' : result.status,
            conflict: result.conflicts.length > 0 ? result.conflicts : null,
          };
    if (result.status !== 'rejected') confirmed += 1;
    await db
      .update(s.syncOperations)
      .set(set)
      .where(
        and(eq(s.syncOperations.locationId, scope.locationId), eq(s.syncOperations.id, row.id)),
      );
  }
  return confirmed;
}

/**
 * Pulls the cloud's operations of the location after `after`; stores those the hub did not have.
 * Returns the new cursor, how many were new and the cloud's configuration version.
 */
export async function pullFromCloud(
  db: Database,
  cloud: CloudFetch,
  scope: HubScope,
  after: number,
): Promise<{ cursor: number; inserted: number; configVersion: string | null }> {
  let cursor = after;
  let inserted = 0;
  let configVersion: string | null = null;
  for (let page = 0; page < 50; page += 1) {
    const response = await cloudJson<{
      operations: PulledOperation[];
      cursor: number;
      hasMore: boolean;
      configVersion: string;
    }>(cloud, `/sync/pull?after=${cursor}&limit=500`);
    configVersion = response.configVersion || configVersion;
    const ops = response.operations.map((pulled) => pulled.operation as Operation);
    if (ops.length > 0) {
      inserted += await db.transaction(async (tx) => {
        await sync.lockLocationRow(tx, scope);
        const known = await sync.existingOperations(
          tx,
          scope,
          ops.map((op) => op.id),
        );
        // Already here: the cloud has them now.
        const acked = ops.filter((op) => known.has(op.id)).map((op) => op.id);
        if (acked.length > 0) {
          await tx
            .update(s.syncOperations)
            .set({ cloudAckedAt: new Date() })
            .where(
              and(
                eq(s.syncOperations.locationId, scope.locationId),
                inArray(s.syncOperations.id, acked),
                isNull(s.syncOperations.cloudAckedAt),
              ),
            );
        }
        const fresh = response.operations.filter((pulled) => !known.has(pulled.operation.id));
        if (fresh.length === 0) return 0;
        const firstSeq = (await sync.lastSeq(tx, scope)) + 1;
        await sync.insertOperations(
          tx,
          scope,
          fresh.map((pulled) => ({
            op: pulled.operation as Operation,
            conflicts: pulled.conflicts,
          })),
          firstSeq,
          new Date(),
          { cloudAcked: true },
        );
        return fresh.length;
      });
    }
    cursor = response.cursor;
    if (!response.hasMore) break;
  }
  return { cursor, inserted, configVersion };
}
