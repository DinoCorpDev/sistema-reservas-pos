import {
  clampHlc,
  type EventType,
  type FoldState,
  foldOperations,
  isShiftOperation,
  type LocationSettings,
  newerOperationSchema,
  type Operation,
  operationBusinessDate,
  operationOrderIds,
  operationSchema,
  type OrderState,
  parseLocationSettings,
} from '@pos/core';
import {
  type CommandRecorder,
  type EventRecord,
  runCommand,
  schema as s,
  type Transaction,
} from '@pos/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { type Actor, requireTerminal } from '../../actor';
import { ApiError } from '../../errors';
import { locationUserPermissions } from '../people/terminal-auth';
import type { ServiceDeps } from '../shared';
import { type ProjectionResult, writeProjection } from './projection';
import { projectStock } from '../inventory/projection';
import { refoldShifts } from './shifts';
import {
  existingOperations,
  insertOperations,
  lastSeq,
  loadGroup,
  lockLocationRow,
  mergeConflicts,
  type StoredConflict,
  type SyncScope,
} from './store';

export const MAX_PUSH_OPERATIONS = 200;

export type PushStatus = 'applied' | 'duplicate' | 'conflict' | 'rejected';

export interface PushResult {
  id: string | null;
  status: PushStatus;
  seq: number | null;
  conflicts: StoredConflict[];
  /** Why a rejected operation was refused (schema or tenant). */
  error?: string;
}

/** Where the sync service runs: the cloud folds and projects; the hub keeps the log (DEC-028). */
export interface SyncNode {
  kind: 'cloud' | 'hub';
  /** Hub only: whether it numbers orders (the first hub of the location, §11.4). */
  authority?: boolean;
  /**
   * Hub only: the cloud's configuration version as last seen by the hub, so terminals compare
   * against the real one (the hub keeps no catalog). Null = unknown yet.
   */
  configVersion?: () => string | null;
}

export type SyncDeps = ServiceDeps & { node?: SyncNode };

const statusOf = (conflicts: readonly StoredConflict[]): 'applied' | 'conflict' =>
  conflicts.length > 0 ? 'conflict' : 'applied';

/**
 * `POST /sync/push` (docs/SYNC.md §6.1). Operations are validated, stored once (their id is the
 * idempotency key) under the location lock with consecutive `seq`, and the groups of orders they
 * touch are refolded and projected in the same transaction, with audit entries and outbox
 * events. Business rules never reject an operation: they become conflicts (§5).
 */
export async function pushOperations(
  deps: SyncDeps,
  actor: Actor,
  rawOperations: readonly unknown[],
): Promise<{ results: PushResult[]; serverTime: string }> {
  const { locationId } = requireTerminal(actor);
  if (rawOperations.length > MAX_PUSH_OPERATIONS) {
    throw new ApiError('BAD_REQUEST', `At most ${MAX_PUSH_OPERATIONS} operations per batch`);
  }
  const scope: SyncScope = { organizationId: actor.organizationId, locationId };
  const node = deps.node ?? { kind: 'cloud' };

  // Terminals of the location: devices and the hub forward each other's operations.
  const terminals = await deps.db
    .select({ id: s.terminals.id })
    .from(s.terminals)
    .where(and(eq(s.terminals.locationId, locationId), isNull(s.terminals.deletedAt)));
  const terminalIds = new Set(terminals.map((t) => t.id));

  const results: PushResult[] = [];
  const valid: { index: number; op: Operation }[] = [];
  rawOperations.forEach((raw, index) => {
    const id = (raw as { id?: unknown } | null)?.id;
    const reject = (error: string) => {
      results[index] = {
        id: typeof id === 'string' ? id : null,
        status: 'rejected',
        seq: null,
        conflicts: [{ code: 'invalid', entityId: null, stored: true }],
        error,
      };
    };
    const parsed = operationSchema.safeParse(raw);
    // The hub keeps what a newer device made, untouched, for the cloud (newerOperationSchema).
    const newer =
      !parsed.success && node.kind === 'hub' ? newerOperationSchema.safeParse(raw) : null;
    if (!parsed.success && !newer?.success) return reject('Invalid operation');
    const op = parsed.success ? parsed.data : (newer!.data as unknown as Operation);
    if (op.organizationId !== scope.organizationId || op.locationId !== scope.locationId) {
      return reject('The operation belongs to another location');
    }
    // Any device of the location may forward what others did (docs/SYNC.md §11.4): an
    // operation is accepted when it was made on a terminal of this location.
    if (!terminalIds.has(op.terminalId)) {
      return reject('The operation was made on a terminal of another location');
    }
    valid.push({ index, op });
  });
  if (valid.length === 0) return { results, serverTime: new Date().toISOString() };

  await runCommand(
    deps.db,
    {
      organizationId: scope.organizationId,
      locationId,
      terminalId: actor.terminalId,
      requestId: actor.requestId,
    },
    async (tx, recorder) => {
      if (!(await lockLocationRow(tx, scope)))
        throw new ApiError('NOT_FOUND', 'Location not found');
      const known = await existingOperations(
        tx,
        scope,
        valid.map((v) => v.op.id),
      );

      const receivedAt = new Date();
      const fresh: { index: number; op: Operation; conflicts: StoredConflict[] }[] = [];
      const inBatch = new Set<string>();
      for (const { index, op } of valid) {
        const stored = known.get(op.id);
        if (stored || inBatch.has(op.id)) {
          results[index] = {
            id: op.id,
            status: 'duplicate',
            seq: stored ? Number(stored.seq) : null,
            conflicts: (stored?.conflict as StoredConflict[] | null) ?? [],
          };
          continue;
        }
        inBatch.add(op.id);
        // A device clock far ahead would win every last-writer-wins comparison (§3).
        const clamp = clampHlc(op.hlc, receivedAt.getTime());
        fresh.push({
          index,
          op: clamp.clamped ? { ...op, hlc: clamp.hlc } : op,
          conflicts: clamp.clamped
            ? [{ code: 'clock_skew', entityId: op.terminalId, stored: true }]
            : [],
        });
      }
      if (fresh.length === 0) return;

      // Money for a day whose Z is done still happened: it is kept and flagged, and shows as a
      // correction of that closing (RF-D17, RN-21). Only the cloud closes days.
      if (node.kind === 'cloud') {
        const closings = await closingsOf(
          tx,
          scope,
          fresh.flatMap((f) => operationBusinessDate(f.op) ?? []),
        );
        for (const f of fresh) {
          const day = operationBusinessDate(f.op);
          const closingId = day === null ? undefined : closings.get(day);
          if (closingId)
            f.conflicts.push({ code: 'day_closed', entityId: closingId, stored: true });
        }
      }

      const firstSeq = (await lastSeq(tx, scope)) + 1;
      await insertOperations(tx, scope, fresh, firstSeq, receivedAt, {
        cloudAcked: node.kind === 'cloud',
      });
      fresh.forEach((f, offset) => {
        results[f.index] = {
          id: f.op.id,
          status: statusOf(f.conflicts),
          seq: firstSeq + offset,
          conflicts: f.conflicts,
        };
      });
      // The hub only keeps the log; the cloud folds and projects (DEC-028).
      if (node.kind !== 'cloud') return;

      const freshOps = fresh.map((f) => f.op);
      const { statusById: outcome, settings } = await refoldAndProject(
        tx,
        scope,
        freshOps,
        recorder,
      );
      // The shifts refold last: what it says about money in a shift is the final word.
      const shiftOutcome = await refoldShifts(tx, scope, freshOps, settings, recorder);
      for (const f of fresh) {
        const conflicts = shiftOutcome.get(f.op.id) ?? outcome.get(f.op.id) ?? f.conflicts;
        results[f.index] = { ...results[f.index]!, status: statusOf(conflicts), conflicts };
      }
    },
  );
  return { results, serverTime: new Date().toISOString() };
}

interface OperationStatusRow {
  id: string;
  status: string;
  conflict: unknown;
  op: Operation;
}

/**
 * Refolds the groups of orders touched by the new operations, writes the projection, updates
 * the status of every operation of those groups and records audits and events (§4, §10).
 */
async function refoldAndProject(
  tx: Transaction,
  scope: SyncScope,
  fresh: readonly Operation[],
  recorder: CommandRecorder,
): Promise<{ statusById: Map<string, StoredConflict[]>; settings: LocationSettings }> {
  const freshIds = new Set(fresh.map((op) => op.id));
  const [location] = await tx
    .select({ settings: s.locations.settings })
    .from(s.locations)
    .where(eq(s.locations.id, scope.locationId));
  const settings = parseLocationSettings(location?.settings);

  const seeds = [...new Set(fresh.flatMap((op) => operationOrderIds(op)))];
  const group =
    seeds.length > 0
      ? await loadGroup(tx, scope, seeds)
      : { rows: [], orderIds: new Set<string>() };
  // PIN unlocks, failures and the drawer touch no order: they only leave audit entries. Shift
  // operations have their own refold (refoldShifts).
  const rows: OperationStatusRow[] = [
    ...group.rows.map((row) => ({
      id: row.id,
      status: row.status,
      conflict: row.conflict,
      op: row.payload as Operation,
    })),
    ...fresh
      .filter((op) => operationOrderIds(op).length === 0 && !isShiftOperation(op.type))
      .map((op) => ({ id: op.id, status: 'received', conflict: null, op })),
  ];
  const ops = rows.map((row) => row.op);

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
  const projection: ProjectionResult =
    group.orderIds.size > 0
      ? await writeProjection(tx, scope, state, group.orderIds)
      : { previous: new Map(), renumbered: new Map(), insertedReceipts: [], tickets: [] };
  // What the sold items took from stock, from the same fold (DEC-051).
  if (group.orderIds.size > 0) await projectStock(tx, scope, state, group.orderIds);

  // A number stored with a suffix is a conflict of the operation that created the order.
  const renumberedBy = new Map<string, string>();
  for (const op of ops) {
    if (op.type === 'order.open' && projection.renumbered.has(op.orderId)) {
      renumberedBy.set(op.id, op.orderId);
    }
    if (op.type === 'order.split' && projection.renumbered.has(op.payload.newOrderId)) {
      renumberedBy.set(op.id, op.payload.newOrderId);
    }
  }
  const foldConflicts = new Map<string, FoldState['conflicts']>();
  for (const conflict of state.conflicts) {
    foldConflicts.set(conflict.opId, [...(foldConflicts.get(conflict.opId) ?? []), conflict]);
  }

  const statusById = new Map<string, StoredConflict[]>();
  const now = new Date();
  for (const row of rows) {
    let conflicts = mergeConflicts(
      row.conflict,
      foldConflicts.get(row.id) ?? [],
      'order',
      row.op.type,
    );
    const renumbered = renumberedBy.get(row.id);
    if (renumbered && !conflicts.some((c) => c.code === 'duplicate_number')) {
      conflicts = [...conflicts, { code: 'duplicate_number', entityId: renumbered, stored: true }];
    }
    statusById.set(row.id, conflicts);
    const status = statusOf(conflicts);
    const stored = conflicts.length > 0 ? conflicts : null;
    if (
      freshIds.has(row.id) ||
      row.status !== status ||
      JSON.stringify(row.conflict ?? null) !== JSON.stringify(stored)
    ) {
      await tx
        .update(s.syncOperations)
        .set({
          status,
          conflict: stored,
          ...(row.status === 'received' ? { appliedAt: now } : {}),
        })
        .where(
          and(eq(s.syncOperations.locationId, scope.locationId), eq(s.syncOperations.id, row.id)),
        );
    }
    // A conflict that appears now is announced once (RNF-04).
    if (status === 'conflict' && row.status !== 'conflict') {
      recorder.event({
        type: 'sync.conflict_detected',
        aggregateType: 'sync_operation',
        aggregateId: row.id,
        payload: { operationId: row.id, operation: row.op.type, conflicts },
        userId: row.op.userId,
        terminalId: row.op.terminalId,
        occurredAt: new Date(row.op.deviceAt),
      });
    }
  }

  // Audit entries of the new operations only (§10).
  for (const draft of state.audits) {
    if (!freshIds.has(draft.opId)) continue;
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
  for (const event of domainEvents(fresh, statusById, state, projection, group.orderIds)) {
    recorder.event(event);
  }
  return { statusById, settings };
}

/** The Z closings of these business days, by day (RN-21). */
async function closingsOf(
  tx: Transaction,
  scope: SyncScope,
  days: readonly string[],
): Promise<Map<string, string>> {
  if (days.length === 0) return new Map();
  const rows = await tx
    .select({ id: s.dailyClosings.id, businessDate: s.dailyClosings.businessDate })
    .from(s.dailyClosings)
    .where(
      and(
        eq(s.dailyClosings.locationId, scope.locationId),
        inArray(s.dailyClosings.businessDate, [...new Set(days)]),
      ),
    );
  return new Map(rows.map((row) => [row.businessDate, row.id]));
}

const OPERATION_EVENTS: Partial<Record<Operation['type'], EventType>> = {
  'order.open': 'order.created',
  'items.add': 'order.item_added',
  'item.void': 'order.item_voided',
  'items.send': 'order.sent_to_kitchen',
  'items.serve': 'order.item_served',
  'discount.apply': 'order.discount_applied',
  'items.transfer': 'order.transferred',
  'order.merge': 'order.merged',
  'order.split': 'order.split',
  'order.reopen': 'order.reopened',
  'order.void': 'order.voided',
};

/**
 * Domain events (PA-10): one per new operation that took effect, the receipts issued, and the
 * orders that closed with this batch. Payments always take effect, so their events always go out.
 */
function domainEvents(
  fresh: readonly Operation[],
  statusById: ReadonlyMap<string, StoredConflict[]>,
  state: FoldState,
  projection: ProjectionResult,
  orderIds: ReadonlySet<string>,
): EventRecord[] {
  const events: EventRecord[] = [];
  for (const op of fresh) {
    if (op.orderId === null) continue;
    const meta = {
      userId: op.userId,
      terminalId: op.terminalId,
      occurredAt: new Date(op.deviceAt),
    };
    if (op.type === 'payment.record') {
      const payload = {
        paymentId: op.payload.paymentId,
        orderId: op.orderId,
        method: op.payload.method,
        adapter: op.payload.adapter,
        amountRappen: op.payload.amountRappen,
        tipRappen: op.payload.tipRappen,
        roundingRappen: op.payload.roundingRappen,
        shiftId: op.payload.shiftId ?? null,
        businessDate: op.payload.businessDate ?? null,
      };
      for (const type of ['payment.created', 'payment.completed'] as const) {
        events.push({
          type,
          aggregateType: 'payment',
          aggregateId: op.payload.paymentId,
          payload,
          ...meta,
        });
      }
      continue;
    }
    if (op.type === 'refund.record') {
      events.push({
        type: 'payment.refunded',
        aggregateType: 'payment',
        aggregateId: op.payload.paymentId,
        payload: {
          refundId: op.payload.refundId,
          orderId: op.orderId,
          amountRappen: op.payload.amountRappen,
        },
        ...meta,
      });
      continue;
    }
    const type = OPERATION_EVENTS[op.type];
    if (!type || statusOf(statusById.get(op.id) ?? []) !== 'applied') continue;
    events.push({
      type,
      aggregateType: 'order',
      aggregateId: op.orderId,
      payload: { operationId: op.id, ...op.payload },
      ...meta,
    });
  }
  for (const receipt of projection.insertedReceipts) {
    events.push({
      type: 'receipt.issued',
      aggregateType: 'receipt',
      aggregateId: receipt.id,
      payload: {
        receiptId: receipt.id,
        orderId: receipt.orderId,
        paymentId: receipt.paymentId,
        receiptNumber: receipt.receiptNumber,
        copy: receipt.copyOfReceiptId !== null,
      },
      userId: receipt.issuedByUserId,
      terminalId: receipt.terminalId,
      occurredAt: new Date(receipt.issuedAt),
    });
  }
  // Kitchen tickets that became ready with this batch (RF-C23), announced once per readiness:
  // a recalled ticket that is ready again is a new fact.
  for (const ticket of projection.tickets) {
    if (ticket.after !== 'ready' || ticket.before === 'ready' || ticket.before === 'served')
      continue;
    events.push({
      type: 'kitchen.ticket_ready',
      aggregateType: 'kitchen_ticket',
      aggregateId: ticket.id,
      payload: {
        ticketId: ticket.id,
        orderId: ticket.orderId,
        kitchenStationId: ticket.stationId,
        itemIds: ticket.itemIds,
      },
    });
  }
  // Orders that closed with this batch (RN-12), announced once.
  for (const orderId of orderIds) {
    const order = state.orders.get(orderId);
    if (order?.status === 'closed' && projection.previous.get(orderId)?.status !== 'closed') {
      events.push(closedEvent(order));
    }
  }
  return events;
}

function closedEvent(order: OrderState): EventRecord {
  return {
    type: 'order.closed',
    aggregateType: 'order',
    aggregateId: order.id,
    payload: {
      orderId: order.id,
      displayNumber: order.displayNumber,
      totalRappen: order.totalRappen,
      paidRappen: order.paidRappen,
      tipTotalRappen: order.tipTotalRappen,
      tableId: order.tableId,
    },
    ...(order.closedAt ? { occurredAt: new Date(order.closedAt) } : {}),
  };
}
