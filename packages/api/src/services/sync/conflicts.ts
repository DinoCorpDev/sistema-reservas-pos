import type { Operation } from '@pos/core';
import { runCommand, schema as s } from '@pos/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { type Actor, assertPermission, requireLocationId, requireUserId } from '../../actor';
import { notFound } from '../../errors';
import { iso, type ServiceDeps } from '../shared';
import type { StoredConflict } from './store';

/**
 * The manager's list of synchronization conflicts (RNF-04, docs/SYNC.md §5): operations that
 * happened in the room but broke a rule. Nothing was blocked; the manager reviews each one,
 * takes the corrective action in the POS (a refund, a void…) and marks it resolved.
 */
export async function listConflicts(
  deps: ServiceDeps,
  actor: Actor,
  query: { includeResolved?: boolean } = {},
) {
  assertPermission(actor, 'sync.resolve_conflicts');
  const locationId = requireLocationId(actor);
  const rows = await deps.db
    .select()
    .from(s.syncOperations)
    .where(
      and(
        eq(s.syncOperations.organizationId, actor.organizationId),
        eq(s.syncOperations.locationId, locationId),
        eq(s.syncOperations.status, 'conflict'),
        query.includeResolved ? undefined : isNull(s.syncOperations.resolvedAt),
      ),
    )
    .orderBy(desc(s.syncOperations.deviceCreatedAt))
    .limit(500);
  return rows.map((row) => {
    const op = row.payload as Operation;
    return {
      id: row.id,
      operation: row.operation,
      orderId: op.orderId ?? null,
      terminalId: row.terminalId,
      userId: row.userId,
      deviceAt: iso(row.deviceCreatedAt)!,
      receivedAt: iso(row.receivedAt)!,
      conflicts: (row.conflict as StoredConflict[] | null) ?? [],
      payload: op.payload as unknown,
      resolvedAt: iso(row.resolvedAt),
      resolvedByUserId: row.resolvedByUserId,
    };
  });
}
export type SyncConflictDto = Awaited<ReturnType<typeof listConflicts>>[number];

export async function resolveConflict(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: { note: string },
): Promise<void> {
  assertPermission(actor, 'sync.resolve_conflicts');
  const locationId = requireLocationId(actor);
  const userId = requireUserId(actor);
  await runCommand(deps.db, actor, async (tx, recorder) => {
    const [row] = await tx
      .select()
      .from(s.syncOperations)
      .where(
        and(
          eq(s.syncOperations.organizationId, actor.organizationId),
          eq(s.syncOperations.locationId, locationId),
          eq(s.syncOperations.id, id),
          eq(s.syncOperations.status, 'conflict'),
        ),
      );
    if (!row) throw notFound('Conflict');
    if (row.resolvedAt) return;
    await tx
      .update(s.syncOperations)
      .set({ resolvedAt: new Date(), resolvedByUserId: userId })
      .where(eq(s.syncOperations.id, row.id));
    recorder.audit({
      action: 'sync.conflict_resolved',
      entityType: 'sync_operation',
      entityId: row.id,
      before: { conflicts: row.conflict },
      after: { resolved: true },
      reason: input.note,
    });
  });
}
