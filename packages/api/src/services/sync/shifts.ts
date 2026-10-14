import {
  type EventType,
  type FoldState,
  foldOperations,
  isShiftOperation,
  type LocationSettings,
  type Operation,
  operationShiftId,
  type ShiftState,
} from '@pos/core';
import { type CommandRecorder, schema as s, type Transaction } from '@pos/db';
import { and, eq, gte, inArray, isNull, or } from 'drizzle-orm';
import { locationUserPermissions } from '../people/terminal-auth';
import { loadShiftGroup, mergeConflicts, type StoredConflict, type SyncScope } from './store';

/**
 * The refold of shifts (DEC-038, docs/SYNC.md §6.1): every shift touched by a batch is folded
 * with all its operations and the money that went into it, projected into `shifts` and
 * `cash_movements`, and its operations get the shift conflicts (RN-19 and the count). Runs in
 * the push transaction, after the refold of orders, so it sees the conflicts that one wrote.
 */
export async function refoldShifts(
  tx: Transaction,
  scope: SyncScope,
  fresh: readonly Operation[],
  settings: LocationSettings,
  recorder: CommandRecorder,
): Promise<Map<string, StoredConflict[]>> {
  const statusById = new Map<string, StoredConflict[]>();
  const seeds = new Set(fresh.flatMap((op) => operationShiftId(op) ?? []));
  if (seeds.size === 0) return statusById;

  // A new shift is folded with the other shifts of its drawer or wallet that are open or recent,
  // so the second one in canonical order is flagged whatever arrived first (RN-19).
  for (const op of fresh) {
    if (op.type !== 'shift.open') continue;
    const sameOwner =
      op.payload.scope === 'terminal'
        ? and(eq(s.shifts.scope, 'terminal'), eq(s.shifts.terminalId, op.terminalId))
        : and(
            eq(s.shifts.scope, 'personal'),
            eq(s.shifts.cashierUserId, op.payload.cashierUserId!),
          );
    const siblings = await tx
      .select({ id: s.shifts.id })
      .from(s.shifts)
      .where(
        and(
          eq(s.shifts.locationId, scope.locationId),
          sameOwner,
          or(
            eq(s.shifts.status, 'open'),
            gte(s.shifts.businessDate, dayBefore(op.payload.businessDate)),
          ),
        ),
      );
    for (const sibling of siblings) seeds.add(sibling.id);
  }

  const rows = await loadShiftGroup(tx, scope, [...seeds]);
  const ops = rows.map((row) => row.payload as Operation);
  const userIds = new Set<string>();
  for (const op of ops) {
    if (op.userId) userIds.add(op.userId);
    if (op.approval) userIds.add(op.approval.approverUserId);
  }
  const permissions = await locationUserPermissions(tx, scope, [...userIds]);
  const state = foldOperations(ops, {
    settings,
    permissionsOf: (userId) => permissions.get(userId) ?? null,
  });

  const shifts = [...state.shifts.values()].filter((shift) => seeds.has(shift.id));
  const before = await previousStatus(tx, scope, shifts);
  await writeShifts(tx, scope, state, shifts);

  // Conflicts: this refold decides the shift ones of every operation of the group.
  const foldConflicts = new Map<string, FoldState['conflicts']>();
  for (const conflict of state.conflicts) {
    foldConflicts.set(conflict.opId, [...(foldConflicts.get(conflict.opId) ?? []), conflict]);
  }
  const freshIds = new Set(fresh.map((op) => op.id));
  const now = new Date();
  for (const row of rows) {
    const op = row.payload as Operation;
    const conflicts = mergeConflicts(
      row.conflict,
      foldConflicts.get(row.id) ?? [],
      'shift',
      op.type,
    );
    statusById.set(row.id, conflicts);
    const status = conflicts.length > 0 ? 'conflict' : 'applied';
    const stored = conflicts.length > 0 ? conflicts : null;
    if (
      freshIds.has(row.id) ||
      row.status !== status ||
      JSON.stringify(row.conflict ?? null) !== JSON.stringify(stored)
    ) {
      await tx
        .update(s.syncOperations)
        .set({ status, conflict: stored, ...(row.status === 'received' ? { appliedAt: now } : {}) })
        .where(
          and(eq(s.syncOperations.locationId, scope.locationId), eq(s.syncOperations.id, row.id)),
        );
    }
    // A conflict that appears now is announced once (RNF-04). The rows were read after the refold
    // of orders, so what that one announced already reads as a conflict here.
    if (status === 'conflict' && row.status !== 'conflict') {
      recorder.event({
        type: 'sync.conflict_detected',
        aggregateType: 'sync_operation',
        aggregateId: row.id,
        payload: { operationId: row.id, operation: op.type, conflicts },
        userId: op.userId,
        terminalId: op.terminalId,
        occurredAt: new Date(op.deviceAt),
      });
    }
  }

  // Audits of the new shift operations only: payments and refunds were audited with their order.
  for (const draft of state.audits) {
    const op = ops.find((candidate) => candidate.id === draft.opId);
    if (!freshIds.has(draft.opId) || !op || !isShiftOperation(op.type)) continue;
    recorder.audit({
      action: draft.action,
      entityType: draft.entityType,
      entityId: draft.entityId,
      before: draft.before,
      after: draft.after,
      reason: draft.reason,
      userId: draft.userId,
      terminalId: draft.terminalId,
      authorizedByUserId: draft.authorizedByUserId,
      occurredAt: new Date(draft.occurredAt),
    });
  }

  for (const op of fresh) {
    const meta = {
      userId: op.userId,
      terminalId: op.terminalId,
      occurredAt: new Date(op.deviceAt),
    };
    const event = (type: EventType, aggregateId: string, payload: Record<string, unknown>) =>
      recorder.event({ type, aggregateType: 'shift', aggregateId, payload, ...meta });
    if (op.type === 'shift.open') {
      event('shift.opened', op.payload.shiftId, {
        shiftId: op.payload.shiftId,
        scope: op.payload.scope,
        terminalId: op.terminalId,
        cashierUserId: op.payload.cashierUserId,
        businessDate: op.payload.businessDate,
        openingFloatRappen: op.payload.openingFloatRappen,
      });
    }
    if (op.type === 'cash.movement') {
      event('cash.movement_recorded', op.payload.shiftId, {
        movementId: op.payload.movementId,
        shiftId: op.payload.shiftId,
        kind: op.payload.kind,
        amountRappen: op.payload.amountRappen,
        reason: op.payload.reason,
        dailyClosingId: op.payload.dailyClosingId,
      });
    }
  }
  // A shift that closed with this batch is announced once.
  for (const shift of shifts) {
    if (shift.status !== 'closed' || before.get(shift.id) === 'closed') continue;
    recorder.event({
      type: 'shift.closed',
      aggregateType: 'shift',
      aggregateId: shift.id,
      payload: {
        shiftId: shift.id,
        scope: shift.scope,
        businessDate: shift.businessDate,
        expectedCashRappen: shift.expectedCashRappen,
        countedCashRappen: shift.countedCashRappen,
        differenceRappen: shift.differenceRappen,
      },
      userId: shift.closedByUserId,
      terminalId: shift.terminalId,
      ...(shift.closedAt ? { occurredAt: new Date(shift.closedAt) } : {}),
    });
  }
  return statusById;
}

function dayBefore(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function previousStatus(
  tx: Transaction,
  scope: SyncScope,
  shifts: readonly ShiftState[],
): Promise<Map<string, string>> {
  if (shifts.length === 0) return new Map();
  const rows = await tx
    .select({ id: s.shifts.id, status: s.shifts.status })
    .from(s.shifts)
    .where(
      and(
        eq(s.shifts.locationId, scope.locationId),
        inArray(
          s.shifts.id,
          shifts.map((shift) => shift.id),
        ),
        isNull(s.shifts.deletedAt),
      ),
    );
  return new Map(rows.map((row) => [row.id, row.status]));
}

const at = (iso: string | null): Date | null => (iso === null ? null : new Date(iso));

/** Shifts and their movements as folded: upserted by the device ids, so it is idempotent. */
async function writeShifts(
  tx: Transaction,
  scope: SyncScope,
  state: FoldState,
  shifts: readonly ShiftState[],
): Promise<void> {
  const now = new Date();
  for (const shift of shifts) {
    const row = {
      organizationId: scope.organizationId,
      locationId: scope.locationId,
      scope: shift.scope,
      terminalId: shift.terminalId,
      cashierUserId: shift.cashierUserId,
      businessDate: shift.businessDate,
      status: shift.status,
      openedAt: new Date(shift.openedAt),
      openedByUserId: shift.openedByUserId,
      openingFloatRappen: shift.openingFloatRappen,
      openingCount: shift.openingCount,
      closedAt: at(shift.closedAt),
      closedByUserId: shift.closedByUserId,
      expectedCashRappen: shift.expectedCashRappen,
      countedCashRappen: shift.countedCashRappen,
      differenceRappen: shift.differenceRappen,
      countByDenomination: shift.countByDenomination,
      differenceComment: shift.differenceComment,
      report: shift.report,
      deviceUpdatedAt: at(shift.closedAt ?? shift.openedAt),
      updatedAt: now,
    };
    await tx
      .insert(s.shifts)
      .values({ id: shift.id, ...row })
      .onDuplicateKeyUpdate({ set: row });
  }
  const ids = new Set(shifts.map((shift) => shift.id));
  for (const movement of state.cashMovements.values()) {
    if (!ids.has(movement.shiftId)) continue;
    const row = {
      organizationId: scope.organizationId,
      locationId: scope.locationId,
      shiftId: movement.shiftId,
      businessDate: movement.businessDate,
      terminalId: movement.terminalId,
      kind: movement.kind,
      amountRappen: movement.amountRappen,
      reason: movement.reason,
      userId: movement.userId,
      dailyClosingId: movement.dailyClosingId,
      occurredAt: new Date(movement.occurredAt),
      deviceUpdatedAt: new Date(movement.occurredAt),
      updatedAt: now,
    };
    await tx
      .insert(s.cashMovements)
      .values({ id: movement.id, ...row })
      .onDuplicateKeyUpdate({ set: row });
  }
}
