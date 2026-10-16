import type { ClosingDto, DayClosePreview } from '@pos/api';
import {
  asCountry,
  type AuthorizationDecision,
  authorize,
  buildLineSnapshot,
  buildReceipt,
  canApprove,
  countTotal,
  type DenominationCount,
  type Channel,
  type ContentLanguage,
  DEFAULT_CONSUMPTION_BY_CHANNEL,
  type DiscountKind,
  isContentLanguage,
  itemsOf,
  openShiftOf,
  type LineSelection,
  newId,
  type OperationApproval,
  type OrderAllergies,
  type PaymentAdapterKey,
  type PaymentMethod,
  PAYMENT_ADAPTER_REGISTRY,
  paymentsOf,
  rappen,
  type ReceiptContent,
  receiptContentHash,
  type Redirect,
  type RoutedTicket,
  routeSend,
  type SensitiveAction,
  settleRefund,
  type ShiftOwner,
  shiftOwnerFor,
  type ShiftReport,
  shiftReport,
  type ShiftState,
  type TerminalType,
  type VoidReason,
} from '@pos/core';
import { ratesFor, translatedName } from './catalog';
import { posCurrency, posRoundingStep } from './money';
import { correctedNow } from '@/device/clock';
import { dispatch } from '@/device/engine';
import { CLOUD, callNode } from '@/device/http';
import { currentBusinessDate, nextOrderNumber, nextReceiptNumber } from './numbers';
import { makeOperation } from '@/device/operations';
import { identify } from '@/device/pin';
import { getPos } from '@/device/store';
import { flushToCloud, requestSync } from '@/device/sync';

/**
 * What the POS screens can do (RF-C02…RF-C19, RF-D02…RF-D25). Every action becomes one operation
 * (docs/SYNC.md §2) stored locally and synchronized later, so all of them work offline.
 */

function context() {
  const { bootstrap, user, fold } = getPos();
  if (!bootstrap) throw new Error('No configuration on this terminal yet');
  if (!user) throw new Error('Unlock the terminal with a PIN first');
  return { bootstrap, user, fold };
}

async function record(...args: Parameters<typeof makeOperation>): Promise<void> {
  await dispatch(await makeOperation(...args));
  requestSync();
}

function orderOf(orderId: string) {
  const order = getPos().fold.orders.get(orderId);
  if (!order) throw new Error('Unknown order');
  return order;
}

// ── Manager approval (RN-15, RF-A05) ────────────────────────────────────────

/** Whether the person on the terminal may do this alone, or needs a manager's PIN. */
export function checkAction(action: SensitiveAction): AuthorizationDecision {
  const { bootstrap, user } = context();
  return authorize(
    { userId: user.id, permissions: user.permissions },
    action,
    bootstrap.location.settings,
  );
}

/** A manager enters their PIN on the same device (DEC-023); null if it does not authorize. */
export async function approveWithPin(
  pin: string,
  decision: AuthorizationDecision,
): Promise<OperationApproval | null> {
  if (decision.status === 'allowed') return null;
  const approver = await identify(pin);
  if (!approver || approver === 'no_credentials') return null;
  if (!canApprove({ userId: approver.id, permissions: approver.permissions }, decision))
    return null;
  return { approverUserId: approver.id, permissions: decision.permissions };
}

// ── Orders (RF-C02, RF-C07, RF-C17) ─────────────────────────────────────────

export async function openOrder(input: {
  channel: Channel;
  tableId?: string | null;
  guestCount?: number | null;
  customerName?: string | null;
}): Promise<string> {
  const { user } = context();
  const orderId = newId();
  const number = await nextOrderNumber(orderId);
  await record('order.open', orderId, {
    channel: input.channel,
    consumptionType: DEFAULT_CONSUMPTION_BY_CHANNEL[input.channel],
    tableId: input.tableId ?? null,
    guestCount: input.guestCount ?? null,
    waiterUserId: user.id,
    customerName: input.customerName ?? null,
    number,
  });
  return orderId;
}

export async function updateOrder(
  orderId: string,
  fields: {
    guestCount?: number | null;
    waiterUserId?: string;
    tableId?: string | null;
    joinedTableIds?: string[];
    customerName?: string | null;
    note?: string | null;
    /** A guest's allergies, warned on every kitchen ticket (DEC-037); null clears them. */
    allergies?: OrderAllergies | null;
  },
): Promise<void> {
  await record('order.update', orderId, fields);
}

/**
 * Hands a table to another waiter, e.g. at a change of shift: from then on it is theirs, with
 * its tips. A manager or an admin approves it with their PIN (DEC-039); it is audited.
 */
export async function handOverOrder(
  orderId: string,
  waiterUserId: string,
  approval: OperationApproval | null = null,
): Promise<void> {
  await record('order.update', orderId, { waiterUserId }, { approval });
}

/**
 * Whether the person on the device may work on this order (DEC-039): always, unless the location
 * keeps tables with their waiter, it is someone else's table and they may not work on any table.
 */
export function mayWorkOn(order: { tableId: string | null; waiterUserId: string }): boolean {
  const { bootstrap, user } = getPos();
  if (!bootstrap || !user) return false;
  if (bootstrap.location.settings.tableOwnership !== 'restricted') return true;
  return (
    order.tableId === null ||
    order.waiterUserId === user.id ||
    user.permissions.has('order.any_table')
  );
}

/** Channel change before payment recalculates the MWST of every line (RN-05). */
export async function changeChannel(orderId: string, channel: Channel): Promise<void> {
  const consumptionType = DEFAULT_CONSUMPTION_BY_CHANNEL[channel];
  await record('order.change_channel', orderId, {
    channel,
    consumptionType,
    rates: ratesFor(consumptionType),
  });
}

// ── Items (RF-C08, RF-C09, RF-C10) ──────────────────────────────────────────

/**
 * Adds a product (RF-C08). Tapping the same simple product again raises the quantity of the
 * pending line instead of adding a new one (≤ 3 taps, RNF-22).
 */
export async function addItem(orderId: string, selection: LineSelection): Promise<string> {
  const { bootstrap, fold } = context();
  const order = orderOf(orderId);
  const course = selection.course ?? selection.product.defaultCourse;
  const variants = selection.product.variants;
  const variantId =
    selection.variantId ?? (variants.find((v) => v.isDefault) ?? variants[0])?.id ?? null;
  const same = itemsOf(fold, orderId).find(
    (item) =>
      item.prepStatus === 'pending' &&
      item.productId === selection.product.id &&
      item.variantId === variantId &&
      item.modifiers.length === 0 &&
      selection.modifiers.length === 0 &&
      item.note === null &&
      !selection.note &&
      item.seat === selection.seat &&
      item.course === course,
  );
  if (same) {
    await record('item.update', orderId, {
      itemId: same.id,
      quantity: Math.min(999, same.quantity + selection.quantity),
    });
    return same.id;
  }
  const line = buildLineSnapshot({
    selection: { ...selection, course },
    ids: { itemId: newId(), modifierRowIds: selection.modifiers.map(() => newId()) },
    consumptionType: order.consumptionType,
    saleDate: currentBusinessDate(),
    taxRules: bootstrap.tax.rules,
    taxRates: bootstrap.tax.rates,
  });
  await record('items.add', orderId, { items: [line] });
  return line.itemId;
}

export async function updateItem(
  orderId: string,
  itemId: string,
  fields: { quantity?: number; note?: string | null; seat?: number | null; course?: number },
): Promise<void> {
  await record('item.update', orderId, { itemId, ...fields });
}

/**
 * Sends what is pending, or only one course ("marching" it, RF-C09). Each active station that
 * receives something gets a ticket, with its id and the kitchen language frozen here (RF-C21,
 * RF-C25, DEC-029).
 */
/** What a send does: its items, the tickets by station and which stations are replaced. */
export interface SendPlan {
  itemIds: string[];
  tickets: RoutedTicket[];
  redirected: Redirect[];
}

/**
 * Plans sending the pending items (of one course) to the kitchen (RF-C21): each item goes to its
 * stations, and a station where nobody would see the ticket is replaced by the one the owner chose
 * ("if nobody is there, send to…", DEC-033), from who is at the kitchen displays right now.
 */
export function planSend(
  orderId: string,
  course?: number,
  newTicketId: () => string = newId,
): SendPlan {
  const { fold, bootstrap } = context();
  const { presence } = getPos();
  const items = itemsOf(fold, orderId).filter(
    (item) => item.prepStatus === 'pending' && (course === undefined || item.course === course),
  );
  const kitchenLanguage = bootstrap.location.kitchenLanguage;
  // A configuration cached before DEC-033 has no displays nor replacements yet.
  const displays = (bootstrap.kitchenDisplays as BootstrapDisplays | undefined) ?? [];
  const { tickets, redirected } = routeSend({
    items: items.map((item) => ({ id: item.id, stationIds: item.stationIds })),
    stations: bootstrap.stations.map((station) => ({
      ...station,
      fallbackStationId: station.fallbackStationId ?? null,
    })),
    // A display without a fixed station attends the one it chose at sign-in (DEC-042).
    displays: displays.map((display) => ({
      terminalId: display.terminalId,
      kitchenStationId: display.kitchenStationId ?? null,
    })),
    activePrinterIds: new Set(
      bootstrap.printers.filter((printer) => printer.isActive).map((printer) => printer.id),
    ),
    presence,
    now: Date.now(),
    kitchenLanguage: isContentLanguage(kitchenLanguage) ? kitchenLanguage : 'de',
    isLanguage: isContentLanguage,
    newTicketId,
  });
  return { itemIds: items.map((item) => item.id), tickets, redirected };
}

type BootstrapDisplays = NonNullable<ReturnType<typeof getPos>['bootstrap']>['kitchenDisplays'];

/**
 * Sends the pending items (of one course) to the kitchen. `plan` is the one the waiter confirmed
 * (stations nobody is at); without it, the send is planned now.
 */
export async function sendItems(
  orderId: string,
  course?: number,
  plan: SendPlan = planSend(orderId, course),
): Promise<{ count: number; redirected: Redirect[] }> {
  if (plan.itemIds.length === 0) return { count: 0, redirected: [] };
  await record('items.send', orderId, { itemIds: plan.itemIds, tickets: plan.tickets });
  return { count: plan.itemIds.length, redirected: plan.redirected };
}

/** Served at the table, or handed over at the bar/counter (RF-C17). */
export async function serveItems(orderId: string, itemIds?: string[]): Promise<void> {
  const { fold } = context();
  const ids =
    itemIds ??
    itemsOf(fold, orderId)
      .filter((item) => item.prepStatus !== 'voided' && item.prepStatus !== 'served')
      .map((item) => item.id);
  if (ids.length > 0) await record('items.serve', orderId, { itemIds: ids });
}

export async function voidItem(
  orderId: string,
  itemId: string,
  input: { quantity: number; reason: VoidReason; reasonText?: string | null },
  approval: OperationApproval | null = null,
): Promise<void> {
  await record(
    'item.void',
    orderId,
    {
      itemId,
      quantity: input.quantity,
      voidedItemId: newId(),
      reason: input.reason,
      reasonText: input.reasonText ?? null,
    },
    { approval },
  );
}

// ── Discounts (RF-C11) ──────────────────────────────────────────────────────

export async function applyDiscount(
  orderId: string,
  input: {
    itemId: string | null;
    kind: DiscountKind;
    value: number;
    reasonCode: string;
    reasonText?: string | null;
  },
  approval: OperationApproval | null = null,
): Promise<void> {
  await record(
    'discount.apply',
    orderId,
    { discountId: newId(), ...input, reasonText: input.reasonText ?? null },
    { approval },
  );
}

export async function removeDiscount(orderId: string, discountId: string): Promise<void> {
  await record('discount.remove', orderId, { discountId });
}

// ── Moving bills (RF-C03, RF-C12, RF-C13) ───────────────────────────────────

export async function transferItems(
  fromOrderId: string,
  itemIds: string[],
  toOrderId: string,
  approval: OperationApproval | null = null,
): Promise<void> {
  await record('items.transfer', fromOrderId, { itemIds, toOrderId }, { approval });
}

export async function mergeOrders(
  orderId: string,
  intoOrderId: string,
  approval: OperationApproval | null = null,
): Promise<void> {
  await record('order.merge', orderId, { intoOrderId }, { approval });
}

/** Splits by items or by seat into a child order that is paid on its own (DEC-025). */
export async function splitOrder(
  orderId: string,
  itemIds: string[],
  approval: OperationApproval | null = null,
): Promise<string> {
  const newOrderId = newId();
  const number = await nextOrderNumber(newOrderId);
  await record('order.split', orderId, { newOrderId, itemIds, number }, { approval });
  return newOrderId;
}

export async function reopenOrder(
  orderId: string,
  reason: string,
  approval: OperationApproval | null = null,
): Promise<void> {
  await record('order.reopen', orderId, { reason }, { approval });
}

/** An order without payments is cancelled (RN-12). */
export async function voidOrder(
  orderId: string,
  reason: VoidReason,
  reasonText: string | null = null,
  approval: OperationApproval | null = null,
): Promise<void> {
  await record('order.void', orderId, { reason, reasonText }, { approval });
}

// ── Payments and receipts (RF-D02…RF-D07, RF-D20…RF-D25) ────────────────────

export interface PaymentInput {
  adapter: Exclude<PaymentAdapterKey, 'online'>;
  method: PaymentMethod;
  /** Part of the balance this payment settles. */
  amountRappen: number;
  tipRappen?: number;
  /** Cash handed over. */
  tenderedRappen?: number;
  /** External terminal: amount approved on the terminal (sale + tip). */
  approvedRappen?: number;
  splitLabel?: string | null;
  language: ContentLanguage;
  customer?: { name: string; address: string | null } | null;
}

export interface IssuedReceipt {
  paymentId: string;
  receiptId: string;
  content: ReceiptContent;
}

/**
 * Takes a payment through its adapter (RF-D10), builds and freezes the receipt on the device
 * (DEC-024) and records both in one operation. Throws when the receipt cannot be issued (e.g.
 * the customer name from CHF 400, RN-08), before anything is recorded.
 */
export async function pay(orderId: string, input: PaymentInput): Promise<IssuedReceipt> {
  const { bootstrap, fold } = context();
  const order = orderOf(orderId);
  // Cash goes into the open shift of its drawer or wallet; without one it is refused (RN-19).
  const shift = shiftForMoney(input.method);
  const breakdown = PAYMENT_ADAPTER_REGISTRY[input.adapter].settle({
    balanceRappen: order.balanceRappen,
    amountRappen: rappen(input.amountRappen),
    tipRappen: input.tipRappen === undefined ? undefined : rappen(input.tipRappen),
    tenderedRappen: input.tenderedRappen === undefined ? undefined : rappen(input.tenderedRappen),
    approvedRappen: input.approvedRappen === undefined ? undefined : rappen(input.approvedRappen),
    roundingStep: posRoundingStep(),
  });
  const location = bootstrap.location;
  const language = input.language;
  const waiter = bootstrap.users.find((u) => u.id === order.waiterUserId);
  const table = bootstrap.tables.find((t) => t.id === order.tableId);
  const receiptNumber = await nextReceiptNumber();
  const content = buildReceipt({
    language,
    training: bootstrap.organization.isTraining,
    location: {
      name: location.name,
      legalName: location.legalName,
      street: location.street,
      postalCode: location.postalCode,
      city: location.city,
      vatUid: location.vatUid,
      header: location.receiptHeader,
      footer: location.receiptFooter,
      country: asCountry(location.country),
      taxLabel: location.settings.tax?.label ?? null,
    },
    currency: posCurrency(),
    receiptNumber,
    orderNumber: order.displayNumber,
    tableLabel: table?.label ?? null,
    servedBy: waiter?.displayName ?? null,
    timeZone: location.timezone,
    issuedAt: new Date(correctedNow()).toISOString(),
    order,
    lines: itemsOf(fold, orderId)
      .filter((item) => item.prepStatus !== 'voided')
      .map((item) => ({
        name: translatedName(item.productId, item.name, language),
        variantName: item.variantName
          ? translatedName(item.variantId, item.variantName, language)
          : null,
        quantity: item.quantity,
        unitPriceRappen: item.unitPriceRappen,
        modifiers: item.modifiers.map((m) => ({
          name: translatedName(m.modifierId, m.name, language),
          priceDeltaRappen: m.priceDeltaRappen,
          quantity: m.quantity,
        })),
        discountRappen: item.discountRappen,
        lineTotalRappen: item.lineTotalRappen,
        taxRappen: item.taxRappen,
        taxRateCode: item.taxRateCode,
        taxRateBp: item.taxRateBp,
      })),
    payment: {
      method: input.method,
      amountRappen: breakdown.amountRappen,
      tipRappen: breakdown.tipRappen,
      roundingRappen: breakdown.roundingRappen,
      tenderedRappen: breakdown.tenderedRappen,
      changeRappen: breakdown.changeRappen,
      splitLabel: input.splitLabel ?? null,
    },
    paidBeforeRappen: order.paidRappen,
    customer: input.customer ?? null,
    customerNameFromRappen: location.settings.receipts.customerNameFromRappen,
  });
  const paymentId = newId();
  const receiptId = newId();
  await record('payment.record', orderId, {
    paymentId,
    method: input.method,
    adapter: input.adapter,
    amountRappen: breakdown.amountRappen,
    tipRappen: breakdown.tipRappen,
    // The tip goes to the waiter of the order, fixed now (RN-07).
    tipUserId: breakdown.tipRappen > 0 ? order.waiterUserId : null,
    roundingRappen: breakdown.roundingRappen,
    tenderedRappen: breakdown.tenderedRappen,
    changeRappen: breakdown.changeRappen,
    externalReference: null,
    splitLabel: input.splitLabel ?? null,
    receipt: {
      receiptId,
      receiptNumber,
      language,
      content,
      contentHash: await receiptContentHash(content),
      customerName: content.customer?.name ?? null,
      customerAddress: content.customer?.address ?? null,
    },
    shiftId: shift?.id ?? null,
    businessDate: shift?.businessDate ?? currentBusinessDate(),
  });
  return { paymentId, receiptId, content };
}

/** Refund linked to the original payment, same method (RF-D07, RN-14). */
export async function refundPayment(
  orderId: string,
  paymentId: string,
  input: { amountRappen: number; tipRappen?: number; reason: string },
  approval: OperationApproval | null = null,
): Promise<void> {
  const payment = getPos().fold.payments.get(paymentId);
  if (!payment) throw new Error('Unknown payment');
  // Cash goes back out of the open drawer, rounded to CHF 0.05 (RN-06, DEC-038).
  const shift = shiftForMoney(payment.method);
  const settled = settleRefund(payment.method === 'cash' ? 'cash' : 'other', {
    amountRappen: rappen(input.amountRappen),
    tipRappen: rappen(input.tipRappen ?? 0),
    roundingStep: posRoundingStep(),
  });
  await record(
    'refund.record',
    orderId,
    {
      refundId: newId(),
      paymentId,
      method: payment.method,
      adapter: payment.adapter,
      amountRappen: input.amountRappen,
      tipRappen: input.tipRappen ?? 0,
      roundingRappen: settled.roundingRappen,
      reason: input.reason,
      externalReference: null,
      shiftId: shift?.id ?? null,
      businessDate: shift?.businessDate ?? currentBusinessDate(),
    },
    { approval },
  );
}

/**
 * The receipt printer of this terminal when the hub can print on it (DEC-031): the terminal
 * works through a hub and has an active printer. Otherwise the browser prints (DEC-027).
 */
export function hubReceiptPrinter() {
  const { bootstrap, sync, printers } = getPos();
  if (sync.level !== 'hub' || !bootstrap?.terminal.receiptPrinterId) return null;
  const printer = bootstrap.printers.find(
    (p) => p.id === bootstrap.terminal.receiptPrinterId && p.isActive,
  );
  return printer ? { ...printer, health: printers[printer.id] ?? null } : null;
}

/** Prints the original receipt on the terminal's printer through the hub (RF-D20, DEC-031). */
export async function printReceipt(orderId: string, receiptId: string): Promise<void> {
  await record('receipt.print', orderId, { receiptId });
}

/**
 * Reprint marked as a copy, audited (RF-D24, RN-09). With a hub and a receipt printer the hub
 * prints it; otherwise the screen shows it for the browser to print.
 */
export async function reprintReceipt(
  orderId: string,
  receiptId: string,
): Promise<{ content: ReceiptContent; copyAt: string; printedByHub: boolean }> {
  const receipt = getPos().fold.receipts.get(receiptId);
  if (!receipt) throw new Error('Unknown receipt');
  const copyAt = new Date(correctedNow()).toISOString();
  const hubPrint = hubReceiptPrinter() !== null;
  await record('receipt.reprint', orderId, { receiptId, copyId: newId(), hubPrint });
  return { content: receipt.content, copyAt, printedByHub: hubPrint };
}

/** Whether this terminal has a cash drawer the hub can open (RF-D18). */
export function hasCashDrawer(): boolean {
  return hubReceiptPrinter()?.hasCashDrawer === true;
}

/** Opens the drawer without a sale: with the permission or a manager's approval (RF-D18). */
export async function openDrawer(
  reason: string | null,
  approval: OperationApproval | null = null,
): Promise<void> {
  await record('drawer.open', null, { reason }, { approval });
}

// ── Cash: shifts, movements and counts (RF-D12…RF-D15, RN-19, DEC-038) ──────

/** Cash needs an open shift of its drawer or wallet (RN-19). */
export class NoShiftError extends Error {
  override readonly name = 'NoShiftError';
}

/** This device takes no cash: a waiter's phone when only the till collects it (DEC-038). */
export class NoCashHereError extends Error {
  override readonly name = 'NoCashHereError';
}

/** Whose drawer or wallet the cash of this person on this device goes into; null = none. */
export function cashOwner(): ShiftOwner | null {
  const { bootstrap, user } = getPos();
  if (!bootstrap || !user) return null;
  return shiftOwnerFor(
    bootstrap.location.settings.shiftMode,
    { id: bootstrap.terminal.id, type: bootstrap.terminal.type as TerminalType },
    user.id,
  );
}

/** The open shift cash goes into here, if any (with all its operations, from every device). */
export function currentShift(): ShiftState | null {
  const owner = cashOwner();
  return owner ? (openShiftOf(getPos().fold, owner) ?? null) : null;
}

/** The shift money of `method` goes into; cash without one is refused before it happens. */
function shiftForMoney(method: PaymentMethod): ShiftState | null {
  const shift = currentShift();
  if (method === 'cash' && !shift) {
    throw cashOwner()
      ? new NoShiftError('Open a shift first')
      : new NoCashHereError('No cash here');
  }
  return shift;
}

/** The name a shift's report carries: the person of a wallet, or this till. */
function shiftOwnerName(shift: ShiftState): string {
  const { bootstrap } = context();
  if (shift.scope === 'personal') {
    return bootstrap.users.find((u) => u.id === shift.cashierUserId)?.displayName ?? '?';
  }
  return shift.terminalId === bootstrap.terminal.id ? bootstrap.terminal.name : '?';
}

/** Opens the shift of this till or of this person's wallet, with the counted float (RF-D12). */
export async function openShift(
  count: DenominationCount,
  approval: OperationApproval | null = null,
): Promise<string> {
  const owner = cashOwner();
  if (!owner) throw new NoCashHereError('No cash here');
  if (currentShift()) throw new Error('A shift is already open');
  const shiftId = newId();
  await record(
    'shift.open',
    null,
    {
      shiftId,
      scope: owner.scope,
      cashierUserId: owner.scope === 'personal' ? owner.userId : null,
      businessDate: currentBusinessDate(),
      openingFloatRappen: countTotal(count),
      openingCount: count,
    },
    { approval },
  );
  return shiftId;
}

/** Cash in, cash out or a small expense in the open shift (RF-D13). `amount` is positive. */
export async function recordMovement(
  kind: 'cash_in' | 'cash_out' | 'expense',
  amountRappen: number,
  reason: string,
  approval: OperationApproval | null = null,
): Promise<void> {
  const shift = currentShift();
  if (!shift) throw new NoShiftError('Open a shift first');
  await record(
    'cash.movement',
    null,
    {
      movementId: newId(),
      shiftId: shift.id,
      businessDate: shift.businessDate,
      kind,
      amountRappen: kind === 'cash_in' ? amountRappen : -amountRappen,
      reason,
      dailyClosingId: null,
    },
    { approval },
  );
}

/** The report of the open shift right now (X report). */
export function currentShiftReport(): ShiftReport | null {
  const shift = currentShift();
  if (!shift) return null;
  return shiftReport(getPos().fold, shift.id, {
    until: new Date(correctedNow()).toISOString(),
    ownerName: shiftOwnerName(shift),
    timeZone: context().bootstrap.location.timezone,
  });
}

/**
 * Closes the open shift with the count (RF-D14, RF-D15): the expected cash and the report are
 * frozen as this device sees them now; a difference needs a comment. Works offline.
 */
export async function closeShift(
  count: DenominationCount,
  differenceComment: string | null,
  approval: OperationApproval | null = null,
): Promise<{ report: ShiftReport; countedRappen: number; expectedRappen: number }> {
  const shift = currentShift();
  if (!shift) throw new NoShiftError('No shift open');
  const report = currentShiftReport()!;
  const countedRappen = countTotal(count);
  const expectedRappen = report.cash.expectedRappen;
  await record(
    'shift.close',
    null,
    {
      shiftId: shift.id,
      businessDate: shift.businessDate,
      countByDenomination: count,
      countedCashRappen: countedRappen,
      expectedCashRappen: expectedRappen,
      differenceComment: countedRappen === expectedRappen ? null : differenceComment,
      hubPrint: hubReceiptPrinter() !== null,
      report,
    },
    { approval },
  );
  return { report, countedRappen, expectedRappen };
}

// ── Closing the day (Z, RF-D15, RF-D19): needs the cloud and a manager ──────

/** A manager's session on this device for the cloud, from their PIN (POST /terminals/unlock). */
export async function managerSession(pin: string): Promise<string> {
  const device = getPos().device;
  if (!device) throw new Error('This device is not paired');
  const { token } = await callNode<{ token: string }>(CLOUD, '/terminals/unlock', {
    method: 'POST',
    deviceToken: device.deviceToken,
    body: { pin },
  });
  return token;
}

const asManager = (token: string) => ({
  deviceToken: getPos().device?.deviceToken ?? null,
  headers: { authorization: `Bearer ${token}` },
  timeoutMs: 20_000,
});

/** Everything this device did must be in the cloud before the Z: how many are still missing. */
export const sendPendingToCloud = (): Promise<number> => flushToCloud();

export const businessDayNow = (): string => currentBusinessDate();

export function dayClosePreview(token: string, businessDate: string) {
  return callNode<DayClosePreview>(
    CLOUD,
    `/cash/day-close/preview?businessDate=${encodeURIComponent(businessDate)}`,
    asManager(token),
  );
}

export function closeBusinessDay(
  token: string,
  input: {
    businessDate: string;
    reconciliations: {
      method: PaymentMethod;
      terminalTotalRappen: number;
      reason: string | null;
    }[];
  },
) {
  return callNode<ClosingDto>(CLOUD, '/cash/day-close', {
    ...asManager(token),
    method: 'POST',
    body: input,
  });
}

// ── Waiters' own phones (DEC-036) ───────────────────────────────────────────

/** A code for waiters' phones, shown as a QR on this cashier POS; needs the cloud. */
export async function issuePhoneCode(): Promise<{ code: string; expiresAt: string }> {
  const device = getPos().device;
  if (!device) throw new Error('This device is not paired');
  return callNode(CLOUD, '/terminals/phone-pairing-code', {
    method: 'POST',
    deviceToken: device.deviceToken,
  });
}

/** What a waiter's phone opens to pair with this code: the POS, straight at the PIN. */
export const phonePairingUrl = (code: string): string =>
  `${window.location.origin}/pos?phone=${encodeURIComponent(code)}`;

/** The device unpairs itself, after sending everything to the cloud (DEC-036): phones and tills. */
export {
  signOutPhone as unpairThisDevice,
  signOutPhone,
  UnsentOperationsError,
} from '@/device/phone';

/** True when nothing has been paid yet: transfer, merge and split are allowed (DEC-025). */
export const hasPayments = (orderId: string) => paymentsOf(getPos().fold, orderId).length > 0;
