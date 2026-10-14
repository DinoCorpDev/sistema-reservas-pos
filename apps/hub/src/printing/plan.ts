import {
  columnsFor,
  type ContentLanguage,
  drawerDocument,
  type FoldState,
  isContentLanguage,
  KITCHEN_LABELS,
  type KitchenCatalog,
  type KitchenTicketState,
  kitchenCatalog,
  normalizeAllergies,
  type Operation,
  type OperationOf,
  type PrintDocument,
  receiptDocument,
  renderAllergyNotice,
  renderKitchenTicket,
  ticketsOf,
  ticketView,
} from '@pos/core';
import type { PrintConfig } from './config';

/**
 * What to print for each operation (DEC-031). The jobs are derived from the operation log, so the
 * KDS, the POS and the hub never disagree about what the kitchen got, and each job has a key that
 * makes it print once, however often the operation arrives.
 *
 * | operation                         | job                                    | printer                 |
 * | --------------------------------- | -------------------------------------- | ----------------------- |
 * | items.send                        | the ticket of each station             | the station's           |
 * | item.void / order.void after send | storno slip (RN-13)                    | the station's           |
 * | kitchen.reprint                   | the ticket again, marked (RF-C26)      | the station's           |
 * | receipt.print / receipt.reprint   | the frozen receipt (DEC-024)           | the terminal's receipt  |
 * | payment.record in cash, drawer.open | drawer kick (RF-D18)                 | the terminal's, if any  |
 * | order.update with allergies after send | allergy notice (DEC-037)        | each station's          |
 */

export type PrintJobKind =
  'kitchen' | 'storno' | 'reprint' | 'allergy' | 'receipt' | 'drawer' | 'test';

export interface PrintJobDraft {
  jobKey: string;
  kind: PrintJobKind;
  printerId: string;
  stationId: string | null;
  document: PrintDocument;
}

/** `wait`: something the job needs (the items of a send) has not reached the hub yet. */
export type PrintPlan = { status: 'ready'; jobs: PrintJobDraft[] } | { status: 'wait' };

/** Operations that can produce print jobs. */
export const PRINTING_OPERATIONS = new Set<Operation['type']>([
  'items.send',
  'item.void',
  'order.void',
  'kitchen.reprint',
  'order.update',
  'receipt.print',
  'receipt.reprint',
  'payment.record',
  'drawer.open',
]);

const catalogs = new WeakMap<PrintConfig, Map<ContentLanguage, KitchenCatalog>>();

function catalogFor(config: PrintConfig, language: ContentLanguage): KitchenCatalog {
  let byLanguage = catalogs.get(config);
  if (!byLanguage) {
    byLanguage = new Map();
    catalogs.set(config, byLanguage);
  }
  let catalog = byLanguage.get(language);
  if (!catalog) {
    catalog = kitchenCatalog(config.catalog, language);
    byLanguage.set(language, catalog);
  }
  return catalog;
}

/** The kitchen language (RF-C25): the ticket's or station's, else the location's, else German. */
export function kitchenLanguageOf(
  config: PrintConfig,
  language: string | null | undefined,
): ContentLanguage {
  if (isContentLanguage(language)) return language;
  return isContentLanguage(config.location.kitchenLanguage)
    ? config.location.kitchenLanguage
    : 'de';
}

const activePrinter = (config: PrintConfig, printerId: string | null | undefined) =>
  printerId ? config.printers.find((p) => p.id === printerId && p.isActive) : undefined;

/** Kitchen ticket document of a ticket at its station, or null if the station prints nowhere. */
function kitchenDocument(
  state: FoldState,
  config: PrintConfig,
  ticket: KitchenTicketState,
  kind: 'ticket' | 'storno' | 'reprint',
  at: string,
  itemIds?: readonly string[],
): { printerId: string; document: PrintDocument } | null {
  const station = config.stations.find((s) => s.id === ticket.stationId);
  const printer = activePrinter(config, station?.printerId);
  if (!station || !printer) return null;
  const language = kitchenLanguageOf(config, ticket.language ?? station.language);
  const view = ticketView(state, ticket, {
    now: at,
    alertAfterMinutes: Number.MAX_SAFE_INTEGER,
    catalog: catalogFor(config, language),
  });
  const items = itemIds ?? view.items.filter((i) => i.status !== 'voided').map((i) => i.itemId);
  if (items.length === 0) return null;
  const order = state.orders.get(ticket.orderId);
  return {
    printerId: printer.id,
    document: renderKitchenTicket(view, {
      kind,
      width: columnsFor(printer.paperWidthMm),
      labels: KITCHEN_LABELS[language],
      timeZone: config.location.timezone,
      stationName: station.name,
      stationNames: Object.fromEntries(config.stations.map((s) => [s.id, s.name])),
      tableLabel: config.tables.find((t) => t.id === order?.tableId)?.label ?? null,
      waiterName: config.users.find((u) => u.id === order?.waiterUserId)?.displayName ?? null,
      at,
      itemIds: items,
    }),
  };
}

function terminalPrinter(config: PrintConfig, terminalId: string) {
  const terminal = config.terminals.find((t) => t.id === terminalId);
  return activePrinter(config, terminal?.receiptPrinterId);
}

/** Storno slips for the items an operation voided after they reached the kitchen (RN-13). */
function stornoJobs(
  op: Operation,
  state: FoldState,
  config: PrintConfig,
  voidedIds: readonly string[],
): PrintJobDraft[] {
  const byTicket = new Map<string, string[]>();
  for (const id of voidedIds) {
    const item = state.items.get(id);
    if (!item || item.prepStatus !== 'voided') continue;
    for (const progress of Object.values(item.kitchen)) {
      byTicket.set(progress.ticketKey, [...(byTicket.get(progress.ticketKey) ?? []), id]);
    }
  }
  const jobs: PrintJobDraft[] = [];
  for (const [key, itemIds] of byTicket) {
    const ticket = state.tickets.get(key);
    if (!ticket) continue;
    const printed = kitchenDocument(state, config, ticket, 'storno', op.deviceAt, itemIds);
    if (printed) {
      jobs.push({
        jobKey: `storno:${op.id}:${key}`,
        kind: 'storno',
        stationId: ticket.stationId,
        ...printed,
      });
    }
  }
  return jobs;
}

/**
 * Allergies noted on an order whose items already reached the kitchen (DEC-037): one notice per
 * station that got them, so nobody relies on a ticket printed before the warning existed.
 */
function allergyJobs(
  op: OperationOf<'order.update'>,
  state: FoldState,
  config: PrintConfig,
): PrintJobDraft[] {
  const allergies = normalizeAllergies(op.payload.allergies ?? null);
  const order = state.orders.get(op.orderId);
  if (!allergies || !order) return [];
  const sentBefore = Date.parse(op.deviceAt);
  const stationIds = new Set(
    ticketsOf(state, order.id)
      .filter((ticket) => Date.parse(ticket.sentAt) <= sentBefore)
      .map((ticket) => ticket.stationId),
  );
  const jobs: PrintJobDraft[] = [];
  for (const stationId of stationIds) {
    const station = config.stations.find((s) => s.id === stationId);
    const printer = activePrinter(config, station?.printerId);
    if (!station || !printer) continue;
    const language = kitchenLanguageOf(config, station.language);
    jobs.push({
      jobKey: `allergy:${op.id}:${stationId}`,
      kind: 'allergy',
      printerId: printer.id,
      stationId,
      document: renderAllergyNotice(
        { channel: order.channel, displayNumber: order.displayNumber, allergies },
        {
          width: columnsFor(printer.paperWidthMm),
          labels: KITCHEN_LABELS[language],
          timeZone: config.location.timezone,
          stationName: station.name,
          tableLabel: config.tables.find((t) => t.id === order.tableId)?.label ?? null,
          waiterName: config.users.find((u) => u.id === order.waiterUserId)?.displayName ?? null,
          at: op.deviceAt,
        },
      ),
    });
  }
  return jobs;
}

export function planPrintJobs(op: Operation, state: FoldState, config: PrintConfig): PrintPlan {
  const ready = (jobs: PrintJobDraft[]): PrintPlan => ({ status: 'ready', jobs });
  switch (op.type) {
    case 'items.send': {
      if (op.payload.itemIds.some((id) => !state.items.has(id))) return { status: 'wait' };
      const jobs: PrintJobDraft[] = [];
      for (const ticket of state.tickets.values()) {
        if (ticket.sendOperationId !== op.id) continue;
        const printed = kitchenDocument(state, config, ticket, 'ticket', op.deviceAt);
        if (printed) {
          jobs.push({
            jobKey: `kitchen:${ticket.key}`,
            kind: 'kitchen',
            stationId: ticket.stationId,
            ...printed,
          });
        }
      }
      return ready(jobs);
    }
    case 'item.void': {
      if (!state.items.has(op.payload.itemId)) return { status: 'wait' };
      // A partial void creates the voided line; a whole void voids the line itself.
      const voidedId = state.items.has(op.payload.voidedItemId)
        ? op.payload.voidedItemId
        : op.payload.itemId;
      const voided = state.items.get(voidedId);
      if (voided?.voidedAt !== op.deviceAt) return ready([]);
      return ready(stornoJobs(op, state, config, [voidedId]));
    }
    case 'order.void': {
      const voided = [...state.items.values()]
        .filter((item) => item.orderId === op.orderId && item.voidedAt === op.deviceAt)
        .map((item) => item.id);
      return ready(stornoJobs(op, state, config, voided));
    }
    case 'kitchen.reprint': {
      const ticket = state.tickets.get(`${op.payload.sendOperationId}:${op.payload.stationId}`);
      if (!ticket) return { status: 'wait' };
      const printed = kitchenDocument(state, config, ticket, 'reprint', op.deviceAt);
      return ready(
        printed
          ? [
              {
                jobKey: `reprint:${op.id}`,
                kind: 'reprint',
                stationId: ticket.stationId,
                ...printed,
              },
            ]
          : [],
      );
    }
    case 'order.update':
      return ready(op.payload.allergies ? allergyJobs(op, state, config) : []);
    case 'receipt.print':
    case 'receipt.reprint': {
      const receipt = state.receipts.get(op.payload.receiptId);
      if (!receipt) return { status: 'wait' };
      // A copy is printed by the hub only when the POS asked for it (it may print it itself).
      if (op.type === 'receipt.reprint' && !op.payload.hubPrint) return ready([]);
      const printer = terminalPrinter(config, op.terminalId);
      if (!printer) return ready([]);
      return ready([
        {
          jobKey: `receipt:${op.id}`,
          kind: 'receipt',
          printerId: printer.id,
          stationId: null,
          document: receiptDocument(receipt.content, {
            width: columnsFor(printer.paperWidthMm),
            ...(op.type === 'receipt.reprint' ? { copyAt: op.deviceAt } : {}),
          }),
        },
      ]);
    }
    case 'payment.record':
    case 'drawer.open': {
      if (op.type === 'payment.record' && op.payload.method !== 'cash') return ready([]);
      const printer = terminalPrinter(config, op.terminalId);
      if (!printer?.hasCashDrawer) return ready([]);
      return ready([
        {
          jobKey: `drawer:${op.id}`,
          kind: 'drawer',
          printerId: printer.id,
          stationId: null,
          document: drawerDocument(),
        },
      ]);
    }
    default:
      return ready([]);
  }
}
