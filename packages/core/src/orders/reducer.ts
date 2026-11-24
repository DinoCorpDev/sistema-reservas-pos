import type { AuditAction } from '../audit/constants';
import type { ShiftScope } from '../cash/constants';
import { sameShiftOwner, type ShiftOwner } from '../cash/owner';
import { expectedCash, openShiftOf, ownerOf } from '../cash/shifts';
import type { KitchenItemStatus } from '../kitchen/constants';
import { authorize, type SensitiveAction } from '../organization/authorization';
import type { Permission } from '../organization/permissions';
import type { LocationSettings } from '../organization/settings';
import { compareOperations } from '../shared/hlc';
import { type Rappen, rappen } from '../shared/money';
import type { ConflictCode } from '../sync/constants';
import { mergeAllergies, normalizeAllergies } from './allergies';
import type { Operation, OperationOf } from './operations';
import {
  type ConflictRecord,
  createFoldState,
  discountsOf,
  type FoldState,
  indexAdd,
  indexMove,
  itemsOf,
  movementsOfShift,
  type OrderItemState,
  type OrderState,
  paymentsOf,
  paymentsOfShift,
  refundsOf,
  refundsOfShift,
  ticketKey,
} from './state';
import { discountAmount, isReadyToClose, lineGross, recalculateOrder } from './totals';

/**
 * The order engine (DEC-021, docs/SYNC.md §4-§5): folds operations in canonical order `(hlc, id)`
 * into the state of the location's orders. The same code runs on the device, the hub and the
 * cloud, so all of them reach the same state whatever the arrival order.
 *
 * Rules of this file: it never reads the clock and never creates ids (everything comes frozen in
 * the operations), and it never throws on business rules: what happened in the restaurant is
 * applied and, if it breaks a rule, recorded as a conflict for the manager. Payments in
 * particular are never lost.
 */

export interface FoldContext {
  settings: LocationSettings;
  /**
   * Permissions of a user at the location: the database on the server, the offline credentials
   * on the device. `null` = unknown or inactive user. Without it, authorization is not checked.
   */
  permissionsOf?: (userId: string) => ReadonlySet<Permission> | null;
}

/** Folds a set of operations from scratch (duplicates are ignored). */
export function foldOperations(ops: readonly Operation[], context: FoldContext): FoldState {
  const state = createFoldState();
  applyOperations(state, ops, context);
  return state;
}

/** True when `op` sorts after everything already folded, so it can be applied incrementally. */
export function sortsAfter(state: FoldState, op: Pick<Operation, 'hlc' | 'id'>): boolean {
  if (state.lastHlc === null || state.lastId === null) return true;
  return compareOperations({ hlc: state.lastHlc, id: state.lastId }, op) < 0;
}

/**
 * Applies operations on top of `state` in canonical order. Callers refold from scratch when an
 * operation sorts before the last one already applied (see `sortsAfter`).
 */
export function applyOperations(
  state: FoldState,
  ops: readonly Operation[],
  context: FoldContext,
): void {
  for (const op of [...ops].sort(compareOperations)) applyOperation(state, op, context);
}

const MAX_MERGE_DEPTH = 20;

/** The order that receives new items: follows merges to the order that absorbed this one. */
function liveOrder(state: FoldState, orderId: string): OrderState | undefined {
  let order = state.orders.get(orderId);
  for (let depth = 0; order?.mergedIntoOrderId && depth < MAX_MERGE_DEPTH; depth += 1) {
    order = state.orders.get(order.mergedIntoOrderId);
  }
  return order;
}

function newOrder(
  op: Operation,
  fields: Pick<
    OrderState,
    | 'id'
    | 'channel'
    | 'consumptionType'
    | 'tableId'
    | 'joinedTableIds'
    | 'guestCount'
    | 'waiterUserId'
    | 'customerName'
    | 'splitFromOrderId'
  > & { number: OperationOf<'order.open'>['payload']['number'] },
): OrderState {
  const zero = rappen(0);
  return {
    id: fields.id,
    organizationId: op.organizationId,
    locationId: op.locationId,
    terminalId: op.terminalId,
    createdByUserId: op.userId!,
    businessDate: fields.number.businessDate,
    orderNumber: fields.number.number,
    orderNumberPrefix: fields.number.prefix,
    displayNumber: fields.number.display,
    channel: fields.channel,
    consumptionType: fields.consumptionType,
    tableId: fields.tableId,
    joinedTableIds: [...fields.joinedTableIds],
    guestCount: fields.guestCount,
    waiterUserId: fields.waiterUserId,
    customerName: fields.customerName,
    note: null,
    allergies: null,
    status: 'open',
    paymentStatus: 'unpaid',
    openedAt: op.deviceAt,
    closedAt: null,
    voidedAt: null,
    voidReason: null,
    reopenedAt: null,
    mergedIntoOrderId: null,
    splitFromOrderId: fields.splitFromOrderId,
    lastSentAt: null,
    updatedAt: op.deviceAt,
    version: 0,
    subtotalRappen: zero,
    discountTotalRappen: zero,
    totalRappen: zero,
    taxTotalRappen: zero,
    paidRappen: zero,
    tipTotalRappen: zero,
    roundingTotalRappen: zero,
    balanceRappen: zero,
  };
}

/** Base of a discount: the line gross, or the order after item discounts. */
function discountBase(state: FoldState, orderId: string, itemId: string | null): Rappen {
  if (itemId !== null) {
    const item = state.items.get(itemId);
    return item ? lineGross(item) : rappen(0);
  }
  let base = 0;
  const itemDiscounts = new Map(
    discountsOf(state, orderId)
      .filter((d) => d.removedAt === null && d.itemId !== null)
      .map((d) => [d.itemId!, d]),
  );
  for (const item of itemsOf(state, orderId)) {
    if (item.prepStatus === 'voided') continue;
    const gross = lineGross(item);
    const discount = itemDiscounts.get(item.id);
    base += gross - (discount ? discountAmount(discount, gross) : 0);
  }
  return rappen(base);
}

/** What RN-15 / RF-A05 checks for this operation, from the state BEFORE it is applied. */
function sensitiveActionOf(state: FoldState, op: Operation): SensitiveAction | null {
  switch (op.type) {
    // PIN events, and the working time that anyone who unlocked records for themself (DEC-054).
    case 'terminal.unlocked':
    case 'terminal.pin_failed':
    case 'staff.clock_in':
    case 'staff.clock_out':
      return null;
    case 'drawer.open':
      return { kind: 'open_drawer' };
    case 'kitchen.start':
    case 'kitchen.ready':
    case 'kitchen.recall':
    case 'kitchen.reprint':
      return { kind: 'permission', permission: 'kitchen.operate' };
    case 'items.serve':
      // The floor serves; the kitchen may too (RF-C22).
      return { kind: 'permission', permission: 'order.create', orPermission: 'kitchen.operate' };
    case 'receipt.print':
      return { kind: 'permission', permission: 'payment.take' };
    case 'item.void':
      return {
        kind: 'void_item',
        prepStatus: state.items.get(op.payload.itemId)?.prepStatus ?? 'pending',
      };
    case 'order.void':
      return { kind: 'void_order' };
    case 'order.reopen':
      return { kind: 'reopen_order' };
    case 'refund.record':
      return { kind: 'refund', amountRappen: rappen(op.payload.amountRappen) };
    case 'discount.apply': {
      const base = discountBase(state, op.orderId, op.payload.itemId);
      const amount = discountAmount(op.payload, base);
      const percentBp = base > 0 ? Math.ceil((amount * 10000) / base) : 0;
      return { kind: 'discount', percentBp };
    }
    case 'items.transfer':
    case 'order.merge':
    case 'order.split':
      return { kind: 'permission', permission: 'order.transfer' };
    case 'payment.record':
      return { kind: 'permission', permission: 'payment.take' };
    case 'shift.open':
      return { kind: 'permission', permission: 'shift.open' };
    case 'shift.close':
      return { kind: 'permission', permission: 'shift.close' };
    case 'cash.movement':
      return { kind: 'permission', permission: 'cash.movement' };
    case 'receipt.reprint':
      return { kind: 'permission', permission: 'receipt.reprint' };
    case 'order.update': {
      // Handing a table to another waiter needs a manager or an admin (DEC-039).
      const waiter = op.payload.waiterUserId;
      const order = state.orders.get(op.orderId);
      return waiter !== undefined && order && waiter !== order.waiterUserId
        ? { kind: 'permission', permission: 'order.reassign' }
        : { kind: 'permission', permission: 'order.create' };
    }
    default:
      return { kind: 'permission', permission: 'order.create' };
  }
}

function authorizationConflict(
  op: Operation,
  action: SensitiveAction,
  context: FoldContext,
): ConflictCode | null {
  const permissionsOf = context.permissionsOf;
  if (!permissionsOf || op.userId === null) return null;
  const permissions = permissionsOf(op.userId);
  if (!permissions) return 'user_inactive';
  const decision = authorize({ userId: op.userId, permissions }, action, context.settings);
  if (decision.status === 'allowed') return null;
  if (!op.approval) return 'approval_invalid';
  const approver = permissionsOf(op.approval.approverUserId);
  const approved = approver && decision.permissions.every((p) => approver.has(p));
  return approved ? null : 'approval_invalid';
}

/** Work on an order that, with restricted tables, only its waiter may do (DEC-039). */
const OWNED_OPERATIONS = new Set<Operation['type']>([
  'order.change_channel',
  'items.add',
  'item.update',
  'items.send',
  'items.serve',
  'item.void',
  'discount.apply',
  'discount.remove',
  'payment.record',
  'items.transfer',
  'order.merge',
  'order.split',
  'order.void',
]);

/**
 * The table order this operation touches when it belongs to another waiter and the location
 * keeps tables with their waiter (DEC-039); null when it is fine. Bar and take-away orders are
 * shared; whoever has `order.any_table` (the till, managers) or an approval with it works on any
 * table, and taking the table over (`order.update` of the waiter) is always allowed.
 */
function ownershipConflict(state: FoldState, op: Operation, context: FoldContext): string | null {
  if (context.settings.tableOwnership !== 'restricted' || !context.permissionsOf) return null;
  if (op.orderId === null || op.userId === null || !OWNED_OPERATIONS.has(op.type)) return null;
  const order = liveOrder(state, op.orderId);
  if (!order || order.tableId === null || order.waiterUserId === op.userId) return null;
  if (context.permissionsOf(op.userId)?.has('order.any_table')) return null;
  const approver = op.approval;
  if (
    approver?.permissions.includes('order.any_table') &&
    context.permissionsOf(approver.approverUserId)?.has('order.any_table')
  ) {
    return null;
  }
  return order.id;
}

/**
 * The item's own status while it is in the kitchen, from its progress at its stations: ready when
 * all of them are ready, preparing when one has started (DEC-029). Served and voided are final.
 */
function deriveKitchenStatus(item: OrderItemState): void {
  if (item.prepStatus === 'served' || item.prepStatus === 'voided') return;
  if (item.prepStatus === 'pending') return;
  const progress = Object.values(item.kitchen);
  if (progress.length === 0) return;
  const byTime = (a: string, b: string) => Date.parse(a) - Date.parse(b);
  const started = progress.flatMap((p) => (p.preparingAt === null ? [] : [p.preparingAt]));
  item.preparingAt = started.sort(byTime)[0] ?? null;
  if (progress.every((p) => p.status === 'ready')) {
    item.prepStatus = 'ready';
    item.readyAt = progress.map((p) => p.readyAt!).sort(byTime)[progress.length - 1]!;
  } else {
    item.prepStatus = progress.some((p) => p.status !== 'sent') ? 'preparing' : 'sent';
    item.readyAt = null;
  }
}

/** Status an item reaches at a station with each kitchen operation; null = no change. */
function kitchenTransition(
  type: 'kitchen.start' | 'kitchen.ready' | 'kitchen.recall',
  current: KitchenItemStatus,
): KitchenItemStatus | null {
  switch (type) {
    case 'kitchen.start':
      return current === 'sent' ? 'preparing' : null;
    case 'kitchen.ready':
      return current === 'ready' ? null : 'ready';
    case 'kitchen.recall':
      return current === 'ready' ? 'preparing' : null;
  }
}

function applyOperation(state: FoldState, op: Operation, context: FoldContext): void {
  if (state.outcomes.has(op.id)) return;
  const conflicts: ConflictRecord[] = [];
  const touched = new Set<string>();
  const afterRecalculation: (() => void)[] = [];
  const flag = (code: ConflictCode, entityId: string | null = null) =>
    conflicts.push({ opId: op.id, code, entityId });
  const audit = (
    action: AuditAction,
    entityType: string,
    entityId: string | null,
    before: unknown,
    after: unknown,
    reason: string | null = null,
  ) =>
    state.audits.push({
      opId: op.id,
      action,
      entityType,
      entityId,
      before,
      after,
      reason,
      userId: op.userId,
      terminalId: op.terminalId,
      authorizedByUserId: op.approval?.approverUserId ?? null,
      occurredAt: op.deviceAt,
      locationId: op.locationId,
    });

  const sensitive = sensitiveActionOf(state, op);
  if (sensitive) {
    const code = authorizationConflict(op, sensitive, context);
    if (code) flag(code, op.userId);
  }
  // Tables that belong to their waiter (DEC-039): what someone else did still happened.
  const foreignTable = ownershipConflict(state, op, context);
  if (foreignTable) flag('not_table_owner', foreignTable);

  const moveItem = (item: OrderItemState, toOrderId: string) => {
    const fromOrderId = item.orderId;
    indexMove(state.itemsByOrder, fromOrderId, toOrderId, item.id);
    item.orderId = toOrderId;
    item.transferredFromOrderId = fromOrderId;
    // An item discount follows its item.
    for (const discount of discountsOf(state, fromOrderId)) {
      if (discount.itemId !== item.id) continue;
      indexMove(state.discountsByOrder, fromOrderId, toOrderId, discount.id);
      discount.orderId = toOrderId;
    }
    touched.add(fromOrderId).add(toOrderId);
  };

  const voidItem = (item: OrderItemState, reason: string) => {
    item.prepStatus = 'voided';
    item.voidedAt = op.deviceAt;
    item.voidReason = reason;
    item.voidedByUserId = op.userId;
    item.voidAuthorizedByUserId = op.approval?.approverUserId ?? null;
    item.voidedTerminalId = op.terminalId;
  };

  /**
   * Money that names a shift is indexed there and checked (DEC-038): the shift must exist, be
   * open and belong to who handled the money. Cash without a shift breaks RN-19 (version 3 on;
   * before, payments had no shift, DEC-026). Recorded either way: money is never lost.
   */
  const intoShift = (
    index: FoldState['paymentsByShift'],
    shiftId: string | null,
    id: string,
    method: string,
  ) => {
    if (shiftId === null) {
      if (method === 'cash' && op.schemaVersion >= 3) flag('cash_without_shift', id);
      return;
    }
    indexAdd(index, shiftId, id);
    const shift = state.shifts.get(shiftId);
    if (!shift) flag('shift_not_found', shiftId);
    else if (shift.status !== 'open') flag('shift_closed', shiftId);
    else if (!sameShiftOwner(ownerOf(shift), handlerOf(shift.scope))) {
      flag('shift_mismatch', shiftId);
    }
  };
  const handlerOf = (scope: ShiftScope): ShiftOwner =>
    scope === 'terminal'
      ? { scope, terminalId: op.terminalId }
      : { scope, userId: op.userId ?? '' };

  switch (op.type) {
    case 'order.open': {
      if (state.orders.has(op.orderId)) {
        flag('invalid', op.orderId);
        break;
      }
      const p = op.payload;
      state.orders.set(
        op.orderId,
        newOrder(op, {
          id: op.orderId,
          channel: p.channel,
          consumptionType: p.consumptionType,
          tableId: p.tableId,
          joinedTableIds: [],
          guestCount: p.guestCount,
          waiterUserId: p.waiterUserId,
          customerName: p.customerName,
          splitFromOrderId: null,
          number: p.number,
        }),
      );
      touched.add(op.orderId);
      break;
    }

    case 'order.update': {
      const order = state.orders.get(op.orderId);
      if (!order) {
        flag('order_not_found', op.orderId);
        break;
      }
      if (order.status !== 'open') {
        flag('order_state', op.orderId);
        break;
      }
      // Canonical order makes this "last change per field wins" (RNF-04).
      const p = op.payload;
      if (p.guestCount !== undefined) order.guestCount = p.guestCount;
      if (p.waiterUserId !== undefined && p.waiterUserId !== order.waiterUserId) {
        // Taking a table over (DEC-039) is always allowed, and always recorded.
        audit(
          'order.waiter_changed',
          'order',
          order.id,
          { waiterUserId: order.waiterUserId },
          { waiterUserId: p.waiterUserId },
        );
        order.waiterUserId = p.waiterUserId;
      }
      if (p.tableId !== undefined) order.tableId = p.tableId;
      if (p.joinedTableIds !== undefined) order.joinedTableIds = [...p.joinedTableIds];
      if (p.customerName !== undefined) order.customerName = p.customerName;
      if (p.note !== undefined) order.note = p.note;
      if (p.allergies !== undefined) order.allergies = normalizeAllergies(p.allergies);
      touched.add(order.id);
      break;
    }

    case 'order.change_channel': {
      const order = state.orders.get(op.orderId);
      if (!order) {
        flag('order_not_found', op.orderId);
        break;
      }
      // RN-05: only while nothing has been paid.
      if (order.status !== 'open' || paymentsOf(state, order.id).length > 0) {
        flag('order_state', order.id);
        break;
      }
      const rateOf = new Map(op.payload.rates.map((r) => [r.taxCategoryKey, r]));
      const lines = itemsOf(state, order.id).filter((item) => item.prepStatus !== 'voided');
      const snapshot = () =>
        lines.map((l) => ({ id: l.id, taxRateCode: l.taxRateCode, taxRateBp: l.taxRateBp }));
      const before = {
        channel: order.channel,
        consumptionType: order.consumptionType,
        lines: snapshot(),
      };
      for (const line of lines) {
        const rate = rateOf.get(line.taxCategoryKey);
        if (!rate) {
          flag('invalid', line.id);
          continue;
        }
        line.taxRateCode = rate.taxRateCode;
        line.taxRateBp = rate.taxRateBp;
      }
      order.channel = op.payload.channel;
      order.consumptionType = op.payload.consumptionType;
      audit('order.channel_changed', 'order', order.id, before, {
        channel: order.channel,
        consumptionType: order.consumptionType,
        lines: snapshot(),
      });
      touched.add(order.id);
      break;
    }

    case 'items.add': {
      const order = liveOrder(state, op.orderId);
      if (!order) {
        flag('order_not_found', op.orderId);
        break;
      }
      if (order.status !== 'open') {
        // Items ordered on another device after the order closed: they happened (SYNC.md §5).
        order.status = 'open';
        order.closedAt = null;
        order.voidedAt = null;
        order.voidReason = null;
        flag('implicit_reopen', order.id);
      }
      for (const line of op.payload.items) {
        if (state.items.has(line.itemId)) {
          flag('invalid', line.itemId);
          continue;
        }
        state.items.set(line.itemId, {
          id: line.itemId,
          orderId: order.id,
          productId: line.productId,
          variantId: line.variantId,
          name: line.name,
          variantName: line.variantName,
          quantity: line.quantity,
          unitPriceRappen: rappen(line.unitPriceRappen),
          modifiers: line.modifiers.map((m) => ({
            ...m,
            priceDeltaRappen: rappen(m.priceDeltaRappen),
          })),
          taxCategoryKey: line.taxCategoryKey,
          taxRateCode: line.taxRateCode,
          taxRateBp: line.taxRateBp,
          course: line.course,
          seat: line.seat,
          note: line.note,
          stationIds: [...line.stationIds],
          prepStatus: 'pending',
          kitchen: {},
          addedAt: op.deviceAt,
          addedByUserId: op.userId,
          sentAt: null,
          preparingAt: null,
          readyAt: null,
          servedAt: null,
          voidedAt: null,
          voidReason: null,
          voidedByUserId: null,
          voidAuthorizedByUserId: null,
          voidedTerminalId: null,
          transferredFromOrderId: null,
          modifiersRappen: rappen(0),
          grossRappen: rappen(0),
          discountRappen: rappen(0),
          lineTotalRappen: rappen(0),
          taxRappen: rappen(0),
        });
        indexAdd(state.itemsByOrder, order.id, line.itemId);
      }
      touched.add(order.id);
      break;
    }

    case 'item.update': {
      const item = state.items.get(op.payload.itemId);
      if (!item) {
        flag('item_not_found', op.payload.itemId);
        break;
      }
      // Only what has not reached the kitchen can still change (RF-C08).
      if (item.prepStatus !== 'pending') {
        flag('item_state', item.id);
        break;
      }
      const p = op.payload;
      if (p.quantity !== undefined) item.quantity = p.quantity;
      if (p.note !== undefined) item.note = p.note;
      if (p.seat !== undefined) item.seat = p.seat;
      if (p.course !== undefined) item.course = p.course;
      touched.add(item.orderId);
      break;
    }

    case 'items.send': {
      // Version 2 names the tickets (active stations only); version 1 routes to every station.
      const frozen = new Map((op.payload.tickets ?? []).map((t) => [t.stationId, t]));
      // A station nobody attends is replaced by another one (DEC-033).
      const standIn = new Map<string, string>();
      for (const ticket of op.payload.tickets ?? []) {
        for (const replaced of ticket.replaces ?? []) standIn.set(replaced, ticket.stationId);
      }
      const routed = (item: OrderItemState) =>
        op.schemaVersion >= 2
          ? [
              ...new Set(
                item.stationIds.flatMap((stationId) => {
                  if (frozen.has(stationId)) return [stationId];
                  const target = standIn.get(stationId);
                  return target ? [target] : [];
                }),
              ),
            ]
          : item.stationIds;
      for (const itemId of op.payload.itemIds) {
        const item = state.items.get(itemId);
        if (!item) {
          flag('item_not_found', itemId);
          continue;
        }
        if (item.prepStatus !== 'pending') continue;
        item.prepStatus = 'sent';
        item.sentAt = op.deviceAt;
        for (const stationId of routed(item)) {
          const key = ticketKey(op.id, stationId);
          let ticket = state.tickets.get(key);
          if (!ticket) {
            ticket = {
              key,
              id: frozen.get(stationId)?.ticketId ?? null,
              sendOperationId: op.id,
              stationId,
              orderId: item.orderId,
              terminalId: op.terminalId,
              sentAt: op.deviceAt,
              sentByUserId: op.userId,
              language: frozen.get(stationId)?.language ?? null,
              replaces: [...(frozen.get(stationId)?.replaces ?? [])],
              itemIds: [],
              reprintCount: 0,
            };
            state.tickets.set(key, ticket);
            indexAdd(state.ticketsByOrder, item.orderId, key);
          }
          ticket.itemIds.push(item.id);
          item.kitchen[stationId] = {
            ticketKey: key,
            status: 'sent',
            preparingAt: null,
            readyAt: null,
          };
        }
        const order = state.orders.get(item.orderId);
        if (order) order.lastSentAt = op.deviceAt;
        touched.add(item.orderId);
      }
      break;
    }

    case 'kitchen.start':
    case 'kitchen.ready':
    case 'kitchen.recall': {
      const { stationId } = op.payload;
      for (const itemId of op.payload.itemIds) {
        const item = state.items.get(itemId);
        if (!item) {
          flag('item_not_found', itemId);
          continue;
        }
        // The floor served or voided it first: the normal race with the kitchen (DEC-029).
        if (item.prepStatus === 'served' || item.prepStatus === 'voided') continue;
        const progress = item.kitchen[stationId];
        if (!progress) {
          flag('item_state', item.id);
          continue;
        }
        const next = kitchenTransition(op.type, progress.status);
        if (next === null) continue;
        progress.status = next;
        if (next === 'preparing' && progress.preparingAt === null)
          progress.preparingAt = op.deviceAt;
        if (next === 'ready') {
          progress.preparingAt ??= op.deviceAt;
          progress.readyAt = op.deviceAt;
        } else {
          progress.readyAt = null;
        }
        deriveKitchenStatus(item);
        touched.add(item.orderId);
      }
      break;
    }

    case 'kitchen.reprint': {
      const ticket = state.tickets.get(ticketKey(op.payload.sendOperationId, op.payload.stationId));
      if (!ticket) {
        flag('item_not_found', op.payload.sendOperationId);
        break;
      }
      ticket.reprintCount += 1;
      audit('kitchen.ticket_reprinted', 'kitchen_ticket', ticket.id, null, {
        sendOperationId: ticket.sendOperationId,
        stationId: ticket.stationId,
        orderId: ticket.orderId,
      });
      break;
    }

    case 'items.serve': {
      for (const itemId of op.payload.itemIds) {
        const item = state.items.get(itemId);
        if (!item) {
          flag('item_not_found', itemId);
          continue;
        }
        if (item.prepStatus === 'voided' || item.prepStatus === 'served') continue;
        item.prepStatus = 'served';
        item.servedAt = op.deviceAt;
        touched.add(item.orderId);
      }
      break;
    }

    case 'item.void': {
      const p = op.payload;
      const item = state.items.get(p.itemId);
      if (!item) {
        flag('item_not_found', p.itemId);
        break;
      }
      if (item.prepStatus === 'voided') break;
      const order = state.orders.get(item.orderId);
      // A void on a closed order still happened; the manager settles the difference.
      if (order && order.status !== 'open') flag('order_state', order.id);
      const before = { quantity: item.quantity, prepStatus: item.prepStatus };
      const reason = p.reasonText ? `${p.reason}: ${p.reasonText}` : p.reason;
      if (p.quantity >= item.quantity) {
        voidItem(item, p.reason);
      } else if (state.items.has(p.voidedItemId)) {
        flag('invalid', p.voidedItemId);
        break;
      } else {
        // Part of the quantity: the voided part becomes its own line, nothing is deleted (RN-11).
        item.quantity -= p.quantity;
        const voided: OrderItemState = {
          ...item,
          id: p.voidedItemId,
          quantity: p.quantity,
          modifiers: item.modifiers.map((m) => ({ ...m })),
          stationIds: [...item.stationIds],
          kitchen: Object.fromEntries(
            Object.entries(item.kitchen).map(([stationId, progress]) => [
              stationId,
              { ...progress },
            ]),
          ),
        };
        voidItem(voided, p.reason);
        state.items.set(voided.id, voided);
        indexAdd(state.itemsByOrder, voided.orderId, voided.id);
        // The voided part stays on the kitchen tickets, struck through (RN-13).
        for (const progress of Object.values(voided.kitchen)) {
          state.tickets.get(progress.ticketKey)?.itemIds.push(voided.id);
        }
      }
      audit(
        'order.item_voided',
        'order_item',
        item.id,
        before,
        { voidedQuantity: Math.min(p.quantity, before.quantity) },
        reason,
      );
      touched.add(item.orderId);
      break;
    }

    case 'discount.apply': {
      const p = op.payload;
      const order = state.orders.get(op.orderId);
      if (!order) {
        flag('order_not_found', op.orderId);
        break;
      }
      if (order.status !== 'open') {
        flag('order_state', order.id);
        break;
      }
      if (state.discounts.has(p.discountId)) {
        flag('invalid', p.discountId);
        break;
      }
      if (p.itemId !== null) {
        const item = state.items.get(p.itemId);
        if (!item || item.orderId !== order.id || item.prepStatus === 'voided') {
          flag('item_not_found', p.itemId);
          break;
        }
      }
      // One discount per line and one per order: a new one replaces the previous.
      for (const previous of discountsOf(state, order.id)) {
        if (previous.removedAt === null && previous.itemId === p.itemId) {
          previous.removedAt = op.deviceAt;
        }
      }
      state.discounts.set(p.discountId, {
        id: p.discountId,
        orderId: order.id,
        itemId: p.itemId,
        kind: p.kind,
        value: p.value,
        reasonCode: p.reasonCode,
        reasonText: p.reasonText,
        appliedByUserId: op.userId,
        authorizedByUserId: op.approval?.approverUserId ?? null,
        terminalId: op.terminalId,
        appliedAt: op.deviceAt,
        removedAt: null,
        amountRappen: rappen(0),
      });
      indexAdd(state.discountsByOrder, order.id, p.discountId);
      audit(
        'order.discount_applied',
        p.itemId === null ? 'order' : 'order_item',
        p.itemId ?? order.id,
        null,
        { discountId: p.discountId, kind: p.kind, value: p.value, reasonCode: p.reasonCode },
        p.reasonText,
      );
      touched.add(order.id);
      break;
    }

    case 'discount.remove': {
      const discount = state.discounts.get(op.payload.discountId);
      if (!discount) {
        flag('item_not_found', op.payload.discountId);
        break;
      }
      if (discount.removedAt !== null) break;
      const order = state.orders.get(discount.orderId);
      if (order && order.status !== 'open') {
        flag('order_state', order.id);
        break;
      }
      discount.removedAt = op.deviceAt;
      audit(
        'order.discount_removed',
        'discount',
        discount.id,
        { amountRappen: discount.amountRappen },
        null,
      );
      touched.add(discount.orderId);
      break;
    }

    case 'payment.record': {
      const p = op.payload;
      if (state.payments.has(p.paymentId)) {
        flag('invalid', p.paymentId);
        break;
      }
      // A payment is never lost or rejected (RNF-04): it is recorded first, then checked.
      state.payments.set(p.paymentId, {
        id: p.paymentId,
        orderId: op.orderId,
        method: p.method,
        adapter: p.adapter,
        amountRappen: rappen(p.amountRappen),
        tipRappen: rappen(p.tipRappen),
        tipUserId: p.tipUserId,
        roundingRappen: rappen(p.roundingRappen),
        tenderedRappen: p.tenderedRappen === null ? null : rappen(p.tenderedRappen),
        changeRappen: rappen(p.changeRappen),
        externalReference: p.externalReference,
        splitLabel: p.splitLabel,
        userId: op.userId,
        terminalId: op.terminalId,
        completedAt: op.deviceAt,
        receiptId: p.receipt.receiptId,
        shiftId: p.shiftId ?? null,
        businessDate: p.businessDate ?? null,
      });
      indexAdd(state.paymentsByOrder, op.orderId, p.paymentId);
      intoShift(state.paymentsByShift, p.shiftId ?? null, p.paymentId, p.method);
      if (!state.receipts.has(p.receipt.receiptId)) {
        state.receipts.set(p.receipt.receiptId, {
          id: p.receipt.receiptId,
          orderId: op.orderId,
          paymentId: p.paymentId,
          receiptNumber: p.receipt.receiptNumber,
          language: p.receipt.language,
          content: p.receipt.content,
          contentHash: p.receipt.contentHash,
          customerName: p.receipt.customerName,
          customerAddress: p.receipt.customerAddress,
          terminalId: op.terminalId,
          issuedByUserId: op.userId,
          issuedAt: op.deviceAt,
          copyOfReceiptId: null,
        });
      }
      const order = state.orders.get(op.orderId);
      if (!order) {
        flag('order_not_found', op.orderId);
        break;
      }
      if (order.status !== 'open') flag('payment_on_closed_order', order.id);
      afterRecalculation.push(() => {
        if (order.paidRappen > order.totalRappen) flag('overpayment', order.id);
      });
      touched.add(order.id);
      break;
    }

    case 'refund.record': {
      const p = op.payload;
      if (state.refunds.has(p.refundId)) {
        flag('invalid', p.refundId);
        break;
      }
      const payment = state.payments.get(p.paymentId);
      const orderId = payment?.orderId ?? op.orderId;
      // Money already handed back: recorded first, then checked (RN-14).
      state.refunds.set(p.refundId, {
        id: p.refundId,
        paymentId: p.paymentId,
        orderId,
        method: p.method,
        adapter: p.adapter,
        amountRappen: rappen(p.amountRappen),
        tipRappen: rappen(p.tipRappen),
        roundingRappen: rappen(p.roundingRappen ?? 0),
        reason: p.reason,
        externalReference: p.externalReference,
        userId: op.userId,
        authorizedByUserId: op.approval?.approverUserId ?? null,
        terminalId: op.terminalId,
        refundedAt: op.deviceAt,
        shiftId: p.shiftId ?? null,
        businessDate: p.businessDate ?? null,
      });
      indexAdd(state.refundsByOrder, orderId, p.refundId);
      intoShift(state.refundsByShift, p.shiftId ?? null, p.refundId, p.method);
      if (!payment) {
        flag('item_not_found', p.paymentId);
      } else {
        const refunded = refundsOf(state, orderId)
          .filter((r) => r.paymentId === payment.id)
          .reduce((sum, r) => sum + r.amountRappen, 0);
        if (refunded > payment.amountRappen) flag('refund_exceeds_payment', payment.id);
      }
      audit(
        'payment.refunded',
        'payment',
        p.paymentId,
        null,
        { refundId: p.refundId, amountRappen: p.amountRappen, tipRappen: p.tipRappen },
        p.reason,
      );
      touched.add(orderId);
      break;
    }

    case 'receipt.reprint': {
      const original = state.receipts.get(op.payload.receiptId);
      if (!original) {
        flag('item_not_found', op.payload.receiptId);
        break;
      }
      if (state.receipts.has(op.payload.copyId)) break;
      state.receipts.set(op.payload.copyId, {
        ...original,
        id: op.payload.copyId,
        terminalId: op.terminalId,
        issuedByUserId: op.userId,
        issuedAt: op.deviceAt,
        copyOfReceiptId: original.id,
      });
      audit('receipt.reprinted', 'receipt', original.id, null, { copyId: op.payload.copyId });
      break;
    }

    case 'receipt.print':
      // Only the hub acts on it (it prints); the state does not change (DEC-031).
      if (!state.receipts.has(op.payload.receiptId)) flag('item_not_found', op.payload.receiptId);
      break;

    case 'items.transfer': {
      const target = liveOrder(state, op.payload.toOrderId);
      if (!target) {
        flag('order_not_found', op.payload.toOrderId);
        break;
      }
      if (target.status !== 'open') {
        flag('order_state', target.id);
        break;
      }
      const moved: string[] = [];
      for (const itemId of op.payload.itemIds) {
        const item = state.items.get(itemId);
        if (!item) {
          flag('item_not_found', itemId);
          continue;
        }
        if (item.prepStatus === 'voided' || item.orderId === target.id) continue;
        // What has been paid stays where it was paid (RN-14, DEC-025).
        if (paymentsOf(state, item.orderId).length > 0) {
          flag('source_has_payments', item.orderId);
          continue;
        }
        moved.push(item.id);
        moveItem(item, target.id);
      }
      audit('order.items_transferred', 'order', op.orderId, null, {
        toOrderId: target.id,
        itemIds: moved,
      });
      break;
    }

    case 'order.merge': {
      const source = state.orders.get(op.orderId);
      const target = liveOrder(state, op.payload.intoOrderId);
      if (!source || !target) {
        flag('order_not_found', source ? op.payload.intoOrderId : op.orderId);
        break;
      }
      if (source.id === target.id) {
        flag('invalid', source.id);
        break;
      }
      if (source.status !== 'open' || target.status !== 'open') {
        flag('order_state', source.status !== 'open' ? source.id : target.id);
        break;
      }
      if (paymentsOf(state, source.id).length > 0) {
        flag('source_has_payments', source.id);
        break;
      }
      for (const item of itemsOf(state, source.id)) moveItem(item, target.id);
      // The guests come along: no allergy warning may get lost (DEC-037).
      target.allergies = mergeAllergies(target.allergies, source.allergies);
      // An order discount belonged to the old order; it does not carry over.
      for (const discount of discountsOf(state, source.id)) {
        if (discount.itemId === null && discount.removedAt === null)
          discount.removedAt = op.deviceAt;
      }
      source.status = 'voided';
      source.voidedAt = op.deviceAt;
      source.voidReason = 'merged';
      source.mergedIntoOrderId = target.id;
      audit('order.merged', 'order', source.id, null, { intoOrderId: target.id });
      touched.add(source.id).add(target.id);
      break;
    }

    case 'order.split': {
      const p = op.payload;
      const source = state.orders.get(op.orderId);
      if (!source) {
        flag('order_not_found', op.orderId);
        break;
      }
      if (source.status !== 'open') {
        flag('order_state', source.id);
        break;
      }
      if (paymentsOf(state, source.id).length > 0) {
        flag('source_has_payments', source.id);
        break;
      }
      if (state.orders.has(p.newOrderId)) {
        flag('invalid', p.newOrderId);
        break;
      }
      const child = newOrder(op, {
        id: p.newOrderId,
        channel: source.channel,
        consumptionType: source.consumptionType,
        tableId: source.tableId,
        joinedTableIds: source.joinedTableIds,
        guestCount: null,
        waiterUserId: source.waiterUserId,
        customerName: null,
        splitFromOrderId: source.id,
        number: p.number,
      });
      // Same table, same guests: the allergy warning goes with the new part (DEC-037).
      child.allergies = mergeAllergies(source.allergies, null);
      state.orders.set(child.id, child);
      const moved: string[] = [];
      for (const itemId of p.itemIds) {
        const item = state.items.get(itemId);
        if (!item || item.orderId !== source.id || item.prepStatus === 'voided') {
          flag('item_not_found', itemId);
          continue;
        }
        moved.push(item.id);
        moveItem(item, child.id);
      }
      audit('order.split', 'order', source.id, null, { newOrderId: child.id, itemIds: moved });
      touched.add(source.id).add(child.id);
      break;
    }

    case 'order.reopen': {
      const order = state.orders.get(op.orderId);
      if (!order) {
        flag('order_not_found', op.orderId);
        break;
      }
      if (order.status !== 'closed') {
        flag('order_state', order.id);
        break;
      }
      order.status = 'open';
      order.closedAt = null;
      order.reopenedAt = op.deviceAt;
      audit(
        'order.reopened',
        'order',
        order.id,
        { status: 'closed' },
        { status: 'open' },
        op.payload.reason,
      );
      touched.add(order.id);
      break;
    }

    case 'order.void': {
      const order = state.orders.get(op.orderId);
      if (!order) {
        flag('order_not_found', op.orderId);
        break;
      }
      // RN-12: only an order without payments is voided; one with payments is refunded.
      if (order.status !== 'open' || paymentsOf(state, order.id).length > 0) {
        flag('order_state', order.id);
        break;
      }
      const reason = op.payload.reasonText
        ? `${op.payload.reason}: ${op.payload.reasonText}`
        : op.payload.reason;
      for (const item of itemsOf(state, order.id)) {
        if (item.prepStatus !== 'voided') voidItem(item, op.payload.reason);
      }
      order.status = 'voided';
      order.voidedAt = op.deviceAt;
      order.voidReason = op.payload.reason;
      audit('order.voided', 'order', order.id, { status: 'open' }, { status: 'voided' }, reason);
      touched.add(order.id);
      break;
    }

    case 'terminal.unlocked':
      audit('terminal.unlocked', 'terminal', op.terminalId, null, { userId: op.userId });
      break;

    case 'terminal.pin_failed':
      audit('terminal.pin_failed', 'terminal', op.terminalId, null, {
        attempt: op.payload.attempt,
      });
      break;

    case 'staff.clock_in': {
      // Never a conflict (DEC-054): the cloud may fold a clock operation without its pair.
      const id = op.payload.timeEntryId;
      const entry = state.timeEntries.get(id);
      if (!entry) {
        state.timeEntries.set(id, {
          id,
          userId: op.userId,
          clockInAt: op.deviceAt,
          clockOutAt: null,
          clockInTerminalId: op.terminalId,
          clockOutTerminalId: null,
        });
      } else if (entry.clockInAt === null) {
        entry.clockInAt = op.deviceAt;
        entry.clockInTerminalId = op.terminalId;
      }
      audit('staff.clocked_in', 'time_entry', id, null, { userId: op.userId });
      break;
    }

    case 'staff.clock_out': {
      const id = op.payload.timeEntryId;
      const entry = state.timeEntries.get(id);
      if (!entry) {
        state.timeEntries.set(id, {
          id,
          userId: op.userId,
          clockInAt: null,
          clockOutAt: op.deviceAt,
          clockInTerminalId: null,
          clockOutTerminalId: op.terminalId,
        });
      } else if (entry.clockOutAt === null) {
        // The first exit counts; a repeated one changes nothing.
        entry.clockOutAt = op.deviceAt;
        entry.clockOutTerminalId = op.terminalId;
      }
      audit('staff.clocked_out', 'time_entry', id, null, { userId: op.userId });
      break;
    }

    case 'drawer.open':
      audit('cash.drawer_opened', 'terminal', op.terminalId, null, null, op.payload.reason);
      break;

    case 'shift.open': {
      const p = op.payload;
      if (state.shifts.has(p.shiftId)) {
        flag('invalid', p.shiftId);
        break;
      }
      const owner: ShiftOwner =
        p.scope === 'terminal'
          ? { scope: 'terminal', terminalId: op.terminalId }
          : { scope: 'personal', userId: p.cashierUserId ?? '' };
      // RN-19: one open shift per drawer or wallet. A second one opened offline elsewhere still
      // happened; it is flagged for the manager.
      const other = openShiftOf(state, owner);
      if (other) flag('shift_already_open', other.id);
      state.shifts.set(p.shiftId, {
        id: p.shiftId,
        scope: p.scope,
        terminalId: op.terminalId,
        cashierUserId: p.cashierUserId,
        businessDate: p.businessDate,
        status: 'open',
        openedAt: op.deviceAt,
        openedByUserId: op.userId,
        openingFloatRappen: rappen(p.openingFloatRappen),
        openingCount: p.openingCount,
        closedAt: null,
        closedByUserId: null,
        expectedCashRappen: null,
        countedCashRappen: null,
        differenceRappen: null,
        countByDenomination: null,
        differenceComment: null,
        report: null,
      });
      audit('shift.opened', 'shift', p.shiftId, null, {
        scope: p.scope,
        cashierUserId: p.cashierUserId,
        businessDate: p.businessDate,
        openingFloatRappen: p.openingFloatRappen,
      });
      break;
    }

    case 'cash.movement': {
      const p = op.payload;
      if (state.cashMovements.has(p.movementId)) {
        flag('invalid', p.movementId);
        break;
      }
      // Cash that moved is recorded first, then checked.
      state.cashMovements.set(p.movementId, {
        id: p.movementId,
        shiftId: p.shiftId,
        kind: p.kind,
        amountRappen: rappen(p.amountRappen),
        reason: p.reason,
        dailyClosingId: p.dailyClosingId,
        businessDate: p.businessDate,
        userId: op.userId,
        terminalId: op.terminalId,
        occurredAt: op.deviceAt,
      });
      indexAdd(state.movementsByShift, p.shiftId, p.movementId);
      const shift = state.shifts.get(p.shiftId);
      if (!shift) flag('shift_not_found', p.shiftId);
      else if (shift.status !== 'open') flag('shift_closed', p.shiftId);
      audit(
        'cash.movement_recorded',
        'shift',
        p.shiftId,
        null,
        { movementId: p.movementId, kind: p.kind, amountRappen: p.amountRappen },
        p.reason,
      );
      break;
    }

    case 'shift.close': {
      const p = op.payload;
      const shift = state.shifts.get(p.shiftId);
      if (!shift) {
        flag('shift_not_found', p.shiftId);
        break;
      }
      // The first close is the one that counts; a second one is flagged.
      if (shift.status !== 'open') {
        flag('shift_closed', shift.id);
        break;
      }
      // What this node knows must match what the device saw when it closed: a payment of another
      // device that sorts before the close but was not there is a difference to explain.
      const expected = expectedCash({
        openingFloatRappen: shift.openingFloatRappen,
        payments: paymentsOfShift(state, shift.id),
        refunds: refundsOfShift(state, shift.id),
        movements: movementsOfShift(state, shift.id),
      });
      if (expected !== p.expectedCashRappen) flag('shift_count_mismatch', shift.id);
      shift.status = 'closed';
      shift.closedAt = op.deviceAt;
      shift.closedByUserId = op.userId;
      shift.expectedCashRappen = rappen(p.expectedCashRappen);
      shift.countedCashRappen = rappen(p.countedCashRappen);
      shift.differenceRappen = rappen(p.countedCashRappen - p.expectedCashRappen);
      shift.countByDenomination = p.countByDenomination;
      shift.differenceComment = p.differenceComment;
      shift.report = p.report;
      audit(
        'shift.closed',
        'shift',
        shift.id,
        { status: 'open' },
        {
          status: 'closed',
          expectedCashRappen: p.expectedCashRappen,
          countedCashRappen: p.countedCashRappen,
          differenceRappen: p.countedCashRappen - p.expectedCashRappen,
        },
        p.differenceComment,
      );
      break;
    }
  }

  for (const orderId of touched) {
    const order = state.orders.get(orderId);
    if (!order) continue;
    recalculateOrder(state, order);
    order.version += 1;
    order.updatedAt = op.deviceAt;
    // RN-12. An explicit reopen leaves the order open until the next change.
    if (op.type !== 'order.reopen' && isReadyToClose(state, order)) {
      order.status = 'closed';
      order.closedAt = op.deviceAt;
    }
  }
  for (const check of afterRecalculation) check();

  state.outcomes.set(op.id, conflicts.length > 0 ? 'conflict' : 'applied');
  state.conflicts.push(...conflicts);
  state.lastHlc = op.hlc;
  state.lastId = op.id;
}
