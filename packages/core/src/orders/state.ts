import type { AuditAction } from '../audit/constants';
import type { KitchenItemStatus } from '../kitchen/constants';
import type { PaymentAdapterKey, PaymentMethod } from '../payments/constants';
import type { ReceiptContent } from '../receipts/content';
import type { Channel, ConsumptionType } from '../shared/channels';
import type { ContentLanguage } from '../shared/languages';
import type { Rappen } from '../shared/money';
import type { ConflictCode } from '../sync/constants';
import type { IsoDate } from '../tax/calculation';
import type { TaxCategoryKey, TaxRateCode } from '../tax/constants';
import type { DiscountKind, ItemPrepStatus, OrderPaymentStatus, OrderStatus } from './constants';

/**
 * State of the orders of a location, as produced by folding operations (DEC-021). The shape
 * mirrors the projection tables (`orders`, `order_items`, `discounts`, `payments`, `refunds`,
 * `receipts`); amounts marked "derived" are recalculated from the frozen inputs after every
 * operation. Times are the device ISO instants of the operations.
 */

export interface ItemModifierState {
  id: string;
  modifierId: string;
  name: string;
  priceDeltaRappen: Rappen;
  quantity: number;
}

/** Progress of an item at one kitchen station (DEC-029). */
export interface KitchenProgress {
  /** Ticket the item arrived on at this station (`<send operation id>:<station id>`). */
  ticketKey: string;
  status: KitchenItemStatus;
  preparingAt: string | null;
  readyAt: string | null;
}

export interface OrderItemState {
  id: string;
  orderId: string;
  productId: string;
  variantId: string | null;
  name: string;
  variantName: string | null;
  quantity: number;
  unitPriceRappen: Rappen;
  modifiers: ItemModifierState[];
  taxCategoryKey: TaxCategoryKey;
  taxRateCode: TaxRateCode;
  taxRateBp: number;
  course: number;
  seat: number | null;
  note: string | null;
  stationIds: string[];
  /**
   * Derived from `kitchen` until served or voided: ready when every station is ready,
   * preparing when one has started (RF-C16).
   */
  prepStatus: ItemPrepStatus;
  /** Progress per station the item was sent to (RF-C21, RF-C22). */
  kitchen: Record<string, KitchenProgress>;
  addedAt: string;
  addedByUserId: string;
  sentAt: string | null;
  preparingAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  voidedByUserId: string | null;
  voidAuthorizedByUserId: string | null;
  transferredFromOrderId: string | null;
  /** Derived: surcharge of the modifiers per unit. */
  modifiersRappen: Rappen;
  /** Derived: (unit + modifiers) × quantity. */
  grossRappen: Rappen;
  /** Derived: item discount plus its share of the order discount. */
  discountRappen: Rappen;
  /** Derived: gross − discount, the amount sold. */
  lineTotalRappen: Rappen;
  /** Derived: MWST extracted from the line total (RN-01, DEC-016). */
  taxRappen: Rappen;
}

export interface OrderState {
  id: string;
  organizationId: string;
  locationId: string;
  terminalId: string;
  createdByUserId: string;
  businessDate: IsoDate;
  orderNumber: number;
  orderNumberPrefix: string;
  displayNumber: string;
  channel: Channel;
  consumptionType: ConsumptionType;
  tableId: string | null;
  joinedTableIds: string[];
  guestCount: number | null;
  waiterUserId: string;
  customerName: string | null;
  note: string | null;
  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;
  openedAt: string;
  closedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  reopenedAt: string | null;
  mergedIntoOrderId: string | null;
  splitFromOrderId: string | null;
  /** Last time items were sent to the kitchen (RF-C19). */
  lastSentAt: string | null;
  /** Device time of the last operation applied to the order. */
  updatedAt: string;
  /** Number of operations applied (`orders.version`). */
  version: number;
  /** Derived totals (Rp). `paidRappen` is the sale part paid, net of refunds. */
  subtotalRappen: Rappen;
  discountTotalRappen: Rappen;
  totalRappen: Rappen;
  taxTotalRappen: Rappen;
  paidRappen: Rappen;
  tipTotalRappen: Rappen;
  roundingTotalRappen: Rappen;
  balanceRappen: Rappen;
}

export interface DiscountState {
  id: string;
  orderId: string;
  itemId: string | null;
  kind: DiscountKind;
  value: number;
  reasonCode: string;
  reasonText: string | null;
  appliedByUserId: string;
  authorizedByUserId: string | null;
  appliedAt: string;
  removedAt: string | null;
  /** Derived: amount the discount takes off right now. */
  amountRappen: Rappen;
}

export interface PaymentState {
  id: string;
  orderId: string;
  method: PaymentMethod;
  adapter: PaymentAdapterKey;
  amountRappen: Rappen;
  tipRappen: Rappen;
  tipUserId: string | null;
  roundingRappen: Rappen;
  tenderedRappen: Rappen | null;
  changeRappen: Rappen;
  externalReference: string | null;
  splitLabel: string | null;
  userId: string;
  terminalId: string;
  completedAt: string;
  receiptId: string;
}

export interface RefundState {
  id: string;
  paymentId: string;
  orderId: string;
  method: PaymentMethod;
  adapter: PaymentAdapterKey;
  amountRappen: Rappen;
  tipRappen: Rappen;
  reason: string;
  externalReference: string | null;
  userId: string;
  authorizedByUserId: string | null;
  terminalId: string;
  refundedAt: string;
}

export interface ReceiptState {
  id: string;
  orderId: string;
  paymentId: string;
  receiptNumber: string;
  language: ContentLanguage;
  content: ReceiptContent;
  contentHash: string;
  customerName: string | null;
  customerAddress: string | null;
  terminalId: string;
  issuedByUserId: string;
  issuedAt: string;
  /** Set on reprints (RF-D24): the original receipt this copy repeats. */
  copyOfReceiptId: string | null;
}

/**
 * What one send delivered to one station (RF-C20, DEC-029). The items keep their own state;
 * the status of the ticket is derived from them (`kitchen/tickets.ts`).
 */
export interface KitchenTicketState {
  /** `<send operation id>:<station id>`. */
  key: string;
  /** Frozen by the device in `items.send` (version 2); null for version 1 sends. */
  id: string | null;
  sendOperationId: string;
  stationId: string;
  /** Order the items belonged to when they were sent. */
  orderId: string;
  terminalId: string;
  sentAt: string;
  sentByUserId: string;
  /** Kitchen language frozen at send (RF-C25); null for version 1 sends. */
  language: ContentLanguage | null;
  /** Items in the ticket, including the voided part of a partial void. */
  itemIds: string[];
  reprintCount: number;
}

export interface ConflictRecord {
  opId: string;
  code: ConflictCode;
  /** Entity the conflict is about (order, item, payment…), for the manager's list. */
  entityId: string | null;
}

/** An audit entry produced by an operation (docs/SYNC.md §10). */
export interface AuditDraft {
  opId: string;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  userId: string | null;
  terminalId: string;
  authorizedByUserId: string | null;
  occurredAt: string;
  locationId: string;
}

export type OperationOutcome = 'applied' | 'conflict';

/** Ids of the entities of each order, so recalculating one order never scans the location. */
export type OrderIndex = Map<string, Set<string>>;

export interface FoldState {
  orders: Map<string, OrderState>;
  items: Map<string, OrderItemState>;
  discounts: Map<string, DiscountState>;
  payments: Map<string, PaymentState>;
  refunds: Map<string, RefundState>;
  receipts: Map<string, ReceiptState>;
  /** Kitchen tickets by key (`<send operation id>:<station id>`). */
  tickets: Map<string, KitchenTicketState>;
  itemsByOrder: OrderIndex;
  discountsByOrder: OrderIndex;
  paymentsByOrder: OrderIndex;
  refundsByOrder: OrderIndex;
  /** Tickets by the order they were sent for. */
  ticketsByOrder: OrderIndex;
  /** Ids of the operations folded so far, with their outcome. */
  outcomes: Map<string, OperationOutcome>;
  conflicts: ConflictRecord[];
  audits: AuditDraft[];
  /** HLC and id of the last operation folded; a later one can be applied incrementally. */
  lastHlc: string | null;
  lastId: string | null;
}

export function createFoldState(): FoldState {
  return {
    orders: new Map(),
    items: new Map(),
    discounts: new Map(),
    payments: new Map(),
    refunds: new Map(),
    receipts: new Map(),
    tickets: new Map(),
    itemsByOrder: new Map(),
    discountsByOrder: new Map(),
    paymentsByOrder: new Map(),
    refundsByOrder: new Map(),
    ticketsByOrder: new Map(),
    outcomes: new Map(),
    conflicts: [],
    audits: [],
    lastHlc: null,
    lastId: null,
  };
}

export function indexAdd(index: OrderIndex, orderId: string, id: string): void {
  const ids = index.get(orderId);
  if (ids) ids.add(id);
  else index.set(orderId, new Set([id]));
}

export function indexMove(index: OrderIndex, from: string, to: string, id: string): void {
  index.get(from)?.delete(id);
  indexAdd(index, to, id);
}

function collect<T>(index: OrderIndex, entities: Map<string, T>, orderId: string): T[] {
  const ids = index.get(orderId);
  if (!ids) return [];
  const result: T[] = [];
  for (const id of ids) {
    const entity = entities.get(id);
    if (entity) result.push(entity);
  }
  return result;
}

/** Items of an order, in the order they were added. */
export const itemsOf = (state: FoldState, orderId: string) =>
  collect(state.itemsByOrder, state.items, orderId);
export const discountsOf = (state: FoldState, orderId: string) =>
  collect(state.discountsByOrder, state.discounts, orderId);
export const paymentsOf = (state: FoldState, orderId: string) =>
  collect(state.paymentsByOrder, state.payments, orderId);
export const refundsOf = (state: FoldState, orderId: string) =>
  collect(state.refundsByOrder, state.refunds, orderId);
/** Kitchen tickets sent for an order, in the order they were sent. */
export const ticketsOf = (state: FoldState, orderId: string) =>
  collect(state.ticketsByOrder, state.tickets, orderId);

/** Key of the ticket of one send at one station. */
export const ticketKey = (sendOperationId: string, stationId: string) =>
  `${sendOperationId}:${stationId}`;
