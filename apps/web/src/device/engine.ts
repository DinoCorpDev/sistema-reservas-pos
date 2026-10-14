import {
  applyOperations,
  DEFAULT_LOCATION_SETTINGS,
  type FoldContext,
  foldOperations,
  isShiftOperation,
  type Operation,
  operationOrderIds,
  operationShiftId,
  paymentsOf,
  type Permission,
  refundsOf,
  sortsAfter,
} from '@pos/core';
import { deviceDb, type OperationRow } from './db';
import { getPos, usePos } from './store';

/**
 * The order engine on the device (DEC-021): the same fold as the cloud, over every operation the
 * device knows. A new local operation is applied incrementally (RNF-06: < 200 ms per item); an
 * operation that arrives late from another device makes it refold from scratch.
 */

const known = new Map<string, Operation>();

function context(): FoldContext {
  const { bootstrap, credentials } = getPos();
  const permissions = new Map<string, ReadonlySet<Permission>>(
    (credentials?.users ?? []).map((user) => [user.id, new Set(user.permissions as Permission[])]),
  );
  return {
    settings: bootstrap?.location.settings ?? DEFAULT_LOCATION_SETTINGS,
    // Without credentials yet, nothing can be checked locally; the cloud re-validates anyway.
    permissionsOf: credentials ? (userId) => permissions.get(userId) ?? null : undefined,
  };
}

function publish(fold = getPos().fold): void {
  usePos.setState((state) => ({ fold, foldVersion: state.foldVersion + 1 }));
}

/** Folds every stored operation (at start, after pruning, or when the context changed). */
export async function refold(): Promise<void> {
  const rows = await deviceDb().ops.toArray();
  known.clear();
  for (const row of rows) if (!row.rejected) known.set(row.id, row.op);
  publish(foldOperations([...known.values()], context()));
}

/** Applies new operations to the in-memory state; refolds when one sorts before the last. */
function absorb(ops: readonly Operation[]): void {
  const fresh = ops.filter((op) => !known.has(op.id));
  if (fresh.length === 0) return;
  for (const op of fresh) known.set(op.id, op);
  const { fold } = getPos();
  if (fresh.every((op) => sortsAfter(fold, op))) {
    applyOperations(fold, fresh, context());
    publish(fold);
  } else {
    publish(foldOperations([...known.values()], context()));
  }
}

/**
 * Other tabs or windows of the same app on this device share its database, and with it the pull
 * cursor: an operation one of them made or pulled never reaches the others through the network.
 * Each tab tells the others what it stored, so all of them fold the same operations at once.
 */
let tabs: BroadcastChannel | null | undefined;

function otherTabs(): BroadcastChannel | null {
  if (tabs === undefined) {
    tabs =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel(`ops:${deviceDb().name}`);
    if (tabs) {
      // Already stored by the tab that sent them: only the in-memory state catches up.
      tabs.onmessage = (event: MessageEvent<{ ops?: Operation[] }>) => {
        if (Array.isArray(event.data?.ops)) absorb(event.data.ops);
      };
    }
  }
  return tabs;
}

function tellOtherTabs(ops: readonly Operation[]): void {
  if (ops.length > 0) otherTabs()?.postMessage({ ops });
}

/** Starts listening to the other tabs of this app on the device (called at boot). */
export function listenToOtherTabs(): void {
  otherTabs();
}

/**
 * Records an operation made on this device: stored first (so nothing is lost if the tablet
 * restarts), then applied. Returns once both are done.
 */
export async function dispatch(op: Operation): Promise<void> {
  const row: OperationRow = {
    id: op.id,
    hlc: op.hlc,
    op,
    own: 1,
    cloudAcked: 0,
    ackedBy: [],
    conflicts: [],
    rejected: 0,
  };
  await deviceDb().ops.put(row);
  absorb([op]);
  tellOtherTabs([op]);
  usePos.setState((state) => ({ sync: { ...state.sync, pending: state.sync.pending + 1 } }));
}

/** Operations received from a node (pull): stored and applied. */
export async function ingest(rows: readonly OperationRow[]): Promise<void> {
  if (rows.length === 0) return;
  await deviceDb().ops.bulkPut([...rows]);
  const ops = rows.filter((row) => !row.rejected).map((row) => row.op);
  absorb(ops);
  tellOtherTabs(ops);
}

/** True when the operation is already known (pull of an operation made here). */
export const isKnown = (id: string) => known.has(id);

/** Hours a closed order stays on the device for refunds, copies and reopening (§4). */
const KEEP_CLOSED_HOURS = 36;

/**
 * Drops from the device the operations of orders closed or voided long ago, once the cloud has
 * all of them (docs/SYNC.md §13). The cloud keeps them; older corrections need a connection.
 */
export async function prune(now = Date.now()): Promise<number> {
  const { fold } = getPos();
  const limit = now - KEEP_CLOSED_HOURS * 3_600_000;
  // A shift keeps its money on the device while open and for the same hours after its close,
  // so its expected cash never changes under the cashier (DEC-038).
  const oldShifts = new Set(
    [...fold.shifts.values()]
      .filter((shift) => shift.closedAt !== null && Date.parse(shift.closedAt) < limit)
      .map((shift) => shift.id),
  );
  const inKeptShift = (shiftId: string | null) => shiftId !== null && !oldShifts.has(shiftId);
  const finished = new Set(
    [...fold.orders.values()]
      .filter((order) => {
        const end = order.closedAt ?? order.voidedAt;
        return order.status !== 'open' && end !== null && Date.parse(end) < limit;
      })
      .filter(
        (order) =>
          !paymentsOf(fold, order.id).some((p) => inKeptShift(p.shiftId)) &&
          !refundsOf(fold, order.id).some((r) => inKeptShift(r.shiftId)),
      )
      .map((order) => order.id),
  );
  if (finished.size === 0 && oldShifts.size === 0) return 0;
  const rows = await deviceDb().ops.toArray();
  const removable = rows.filter((row) => {
    if (row.cloudAcked !== 1) return false;
    if (isShiftOperation(row.op.type)) return oldShifts.has(operationShiftId(row.op) ?? '');
    const orders = operationOrderIds(row.op);
    return orders.length > 0 && orders.every((id) => finished.has(id));
  });
  if (removable.length === 0) return 0;
  await deviceDb().ops.bulkDelete(removable.map((row) => row.id));
  await refold();
  return removable.length;
}
