import { columnsAt, type PrintDocument, type PrintLine, rule, wrapped } from '../printing/document';
import { localMoment } from '../shared/time';
import type { KitchenTicketView } from './board';
import { allergenName, courseLabel, type KitchenLabels } from './labels';

/**
 * The kitchen ticket as printed at the station (RF-C26), in the kitchen language (RF-C25):
 * station, table or number in large letters, course, time and waiter, then the items with their
 * modifiers, note, seat and allergens (RF-C20). A storno slip lists only the voided items (RN-13).
 */

export type KitchenPrintKind = 'ticket' | 'storno' | 'reprint';

export interface KitchenRenderOptions {
  kind: KitchenPrintKind;
  /** Columns at the normal size (`columnsFor(paperWidthMm)`). */
  width: number;
  labels: KitchenLabels;
  timeZone: string;
  stationName: string;
  tableLabel: string | null;
  waiterName: string | null;
  /** When it is printed: the time of a storno or a reprint. */
  at: string;
  /** Only these items (a storno prints the voided ones). Default: all live items. */
  itemIds?: readonly string[];
}

const hhmm = (iso: string, timeZone: string) =>
  localMoment(new Date(iso), timeZone).time.slice(0, 5);

export function renderKitchenTicket(
  view: KitchenTicketView,
  options: KitchenRenderOptions,
): PrintDocument {
  const { width, labels: l } = options;
  const lines: PrintLine[] = [];
  const only = options.itemIds ? new Set(options.itemIds) : null;
  const items = view.items.filter((item) =>
    only ? only.has(item.itemId) : item.status !== 'voided',
  );

  lines.push({ text: options.stationName.toUpperCase(), bold: true, align: 'center' });
  if (options.kind !== 'ticket') {
    const banner = options.kind === 'storno' ? l.storno : l.reprint;
    lines.push({
      text: `*** ${banner} ${hhmm(options.at, options.timeZone)} ***`,
      bold: true,
      size: 'large',
      align: 'center',
    });
  }
  const where =
    view.channel === 'table' && options.tableLabel
      ? `${l.table} ${options.tableLabel}`
      : `${l.channels[view.channel]} ${view.displayNumber}`;
  lines.push(...wrapped(where, width, { bold: true, size: 'large' }));
  const meta = [
    view.channel === 'table' ? `${l.order} ${view.displayNumber}` : null,
    hhmm(view.sentAt, options.timeZone),
    options.waiterName ? `${l.sentBy}: ${options.waiterName}` : null,
  ].filter((part): part is string => part !== null);
  lines.push(...wrapped(meta.join(' · '), width));

  for (const course of [...new Set(items.map((i) => i.course))].sort((a, b) => a - b)) {
    lines.push(rule(width));
    lines.push({ text: courseLabel(l, course).toUpperCase(), bold: true });
    for (const item of items.filter((i) => i.course === course)) {
      const name = item.variantName ? `${item.name} (${item.variantName})` : item.name;
      lines.push(...wrapped(`${item.quantity}x ${name}`, width, { bold: true, size: 'tall' }));
      for (const modifier of item.modifiers) {
        const quantity = modifier.quantity > 1 ? `${modifier.quantity}x ` : '';
        lines.push(...wrapped(`+ ${quantity}${modifier.name}`, width, {}, '   '));
      }
      if (item.note)
        lines.push(...wrapped(`> ${l.note}: ${item.note}`, width, { bold: true }, '   '));
      if (item.seat !== null) lines.push(...wrapped(`${l.seat} ${item.seat}`, width, {}, '   '));
      const contains = item.allergens.filter((a) => a.presence === 'contains');
      const traces = item.allergens.filter((a) => a.presence !== 'contains');
      if (contains.length > 0 || traces.length > 0) {
        const parts = [
          contains.map((a) => allergenName(l, a.allergen)).join(', '),
          traces.length > 0
            ? `${l.traces}: ${traces.map((a) => allergenName(l, a.allergen)).join(', ')}`
            : '',
        ].filter((part) => part !== '');
        lines.push(...wrapped(`! ${l.allergens}: ${parts.join('; ')}`, width, {}, '   '));
      }
    }
  }
  lines.push(rule(width));
  return { lines, cut: true, openDrawer: false };
}

/** Test page of a printer (RF-F17). */
export function renderTestPage(options: {
  width: number;
  labels: KitchenLabels;
  printerName: string;
  timeZone: string;
  at: string;
}): PrintDocument {
  const moment = localMoment(new Date(options.at), options.timeZone);
  const sample = 'ÄÖÜ äöü éèàç ß € 0123456789';
  return {
    lines: [
      { text: options.labels.testPage, bold: true, size: 'large', align: 'center' },
      ...wrapped(options.printerName, options.width, { align: 'center' }),
      { text: `${moment.date} ${moment.time.slice(0, 5)}`, align: 'center' },
      rule(options.width),
      ...wrapped(options.labels.testPageBody, options.width),
      { text: sample.slice(0, columnsAt(options.width)) },
      rule(options.width),
    ],
    cut: true,
    openDrawer: false,
  };
}
