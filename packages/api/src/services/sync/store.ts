import { type ConflictRecord, type Operation, operationOrderIds, relatedOrderId } from '@pos/core';
import { schema as s, type Transaction } from '@pos/db';
import { and, eq, inArray, max, or } from 'drizzle-orm';

/**
 * Storage of the operation log (`sync_operations`, docs/SYNC.md §6). Used by the cloud and by
 * the hub with their own databases: the same code, the same contract.
 */

export interface SyncScope {
  organizationId: string;
  locationId: string;
}

/** A conflict that does not come from the fold but from storing the operation (§5). */
export interface StoredConflict {
  code: string;
  entityId: string | null;
  /** Set when the conflict was found while storing (clock skew, duplicate number). */
  stored?: true;
}

export type StoredOperationRow = typeof s.syncOperations.$inferSelect;

/**
 * Serializes the batches of one location (§6.1): the same operation arriving at the same time
 * through the hub and directly is stored once, and `seq` grows without gaps between readers.
 * Returns false when the location does not belong to the organization.
 */
export async function lockLocationRow(tx: Transaction, scope: SyncScope): Promise<boolean> {
  const rows = await tx
    .select({ id: s.locations.id })
    .from(s.locations)
    .where(
      and(
        eq(s.locations.id, scope.locationId),
        eq(s.locations.organizationId, scope.organizationId),
      ),
    )
    .for('update');
  return rows.length > 0;
}

export async function existingOperations(
  tx: Transaction,
  scope: SyncScope,
  ids: readonly string[],
): Promise<Map<string, StoredOperationRow>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(s.syncOperations)
    .where(
      and(
        eq(s.syncOperations.organizationId, scope.organizationId),
        inArray(s.syncOperations.idempotencyKey, [...ids]),
      ),
    );
  return new Map(rows.map((row) => [row.idempotencyKey, row]));
}

export async function lastSeq(tx: Transaction, scope: SyncScope): Promise<number> {
  const [row] = await tx
    .select({ value: max(s.syncOperations.seq) })
    .from(s.syncOperations)
    .where(eq(s.syncOperations.locationId, scope.locationId));
  return Number(row?.value ?? 0);
}

/** Inserts new operations with consecutive `seq` values (the caller holds the location lock). */
export async function insertOperations(
  tx: Transaction,
  scope: SyncScope,
  ops: readonly { op: Operation; conflicts: StoredConflict[] }[],
  firstSeq: number,
  receivedAt: Date,
  options: { cloudAcked: boolean },
): Promise<void> {
  if (ops.length === 0) return;
  await tx.insert(s.syncOperations).values(
    ops.map(({ op, conflicts }, index) => {
      const orderIds = operationOrderIds(op);
      return {
        id: op.id,
        organizationId: scope.organizationId,
        locationId: scope.locationId,
        seq: firstSeq + index,
        terminalId: op.terminalId,
        userId: op.userId,
        idempotencyKey: op.id,
        operation: op.type,
        schemaVersion: op.schemaVersion,
        hlc: op.hlc,
        entityType: orderIds.length > 0 ? 'order' : 'terminal',
        entityId: orderIds[0] ?? op.terminalId,
        relatedEntityId: relatedOrderId(op),
        payload: op,
        deviceCreatedAt: new Date(op.deviceAt),
        receivedAt,
        status: 'received',
        conflict: conflicts.length > 0 ? conflicts : null,
        cloudAckedAt: options.cloudAcked ? receivedAt : null,
      };
    }),
  );
}

/**
 * The operations of the group of orders connected to `seedOrderIds` by transfers, merges and
 * splits (docs/SYNC.md §4), loaded until no new order appears.
 */
export async function loadGroup(
  tx: Transaction,
  scope: SyncScope,
  seedOrderIds: readonly string[],
): Promise<{ rows: StoredOperationRow[]; orderIds: Set<string> }> {
  const orderIds = new Set(seedOrderIds);
  const rows = new Map<string, StoredOperationRow>();
  let frontier = [...orderIds];
  while (frontier.length > 0) {
    const found = await tx
      .select()
      .from(s.syncOperations)
      .where(
        and(
          eq(s.syncOperations.locationId, scope.locationId),
          or(
            inArray(s.syncOperations.entityId, frontier),
            inArray(s.syncOperations.relatedEntityId, frontier),
          ),
        ),
      );
    const next: string[] = [];
    for (const row of found) {
      if (rows.has(row.id)) continue;
      rows.set(row.id, row);
      for (const id of operationOrderIds(row.payload as Operation)) {
        if (!orderIds.has(id)) {
          orderIds.add(id);
          next.push(id);
        }
      }
    }
    frontier = next;
  }
  return { rows: [...rows.values()], orderIds };
}

/** Conflicts found while storing are kept across refolds; fold conflicts are recomputed. */
export function mergeConflicts(stored: unknown, fold: readonly ConflictRecord[]): StoredConflict[] {
  const kept = Array.isArray(stored)
    ? (stored as StoredConflict[]).filter((c) => c.stored === true)
    : [];
  return [...kept, ...fold.map((c) => ({ code: c.code, entityId: c.entityId }))];
}
