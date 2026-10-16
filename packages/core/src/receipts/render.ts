import { formatChf, type Rappen } from '../shared/money';
import { localMoment } from '../shared/time';
import type { ReceiptContent } from './content';

/**
 * Plain-text layout of a receipt for 80 mm paper (42 columns). The POS prints it through the
 * browser in Phase 2; the hub sends the same lines to ESC/POS printers in Phase 3 (DEC-027).
 */
export const RECEIPT_COLUMNS = 42;
/** 58 mm paper prints 32 columns; narrower layouts are not supported. */
const MIN_WIDTH = 24;

const money = (amount: Rappen | number) => formatChf(amount as Rappen, { currency: false });

/** 810 bp → "8.1%". */
export function formatRate(rateBp: number): string {
  const whole = Math.trunc(rateBp / 100);
  const decimals = String(rateBp % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return decimals === '' ? `${whole}%` : `${whole}.${decimals}%`;
}

function center(text: string, width: number): string {
  const trimmed = text.slice(0, width);
  const left = Math.floor((width - trimmed.length) / 2);
  return `${' '.repeat(left)}${trimmed}`.trimEnd();
}

/** Narrowest left part worth keeping next to a right part; below it they go on two lines. */
const MIN_LEFT = 12;

/** `left` and `right` on one line; a long `left` wraps so the amount stays aligned. */
function columns(left: string, right: string, width: number): string[] {
  if (right.length > width - MIN_LEFT) {
    // The right part leaves no room (e.g. a long table label): each part on its own lines.
    const rightLines = wrap(right, width).map((line) => line.padStart(width));
    return [...(left === '' ? [] : wrap(left, width)), ...rightLines];
  }
  const room = width - right.length - 1;
  if (left.length <= room)
    return [`${left}${' '.repeat(width - left.length - right.length)}${right}`];
  const lines: string[] = [];
  let rest = left;
  while (rest.length > room) {
    let cut = rest.lastIndexOf(' ', room);
    if (cut <= 0) cut = room;
    lines.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  lines.push(`${rest}${' '.repeat(Math.max(1, width - rest.length - right.length))}${right}`);
  return lines;
}

function wrap(text: string, width: number): string[] {
  return text
    .split('\n')
    .flatMap((paragraph) => columns(paragraph, '', width).map((line) => line.trimEnd()));
}

export function renderReceiptText(
  content: ReceiptContent,
  options: { copyAt?: string; width?: number } = {},
): string[] {
  const width = Math.max(options.width ?? RECEIPT_COLUMNS, MIN_WIDTH);
  const l = content.labels;
  const rule = '-'.repeat(width);
  const out: string[] = [];
  const when = (iso: string) => {
    const moment = localMoment(new Date(iso), content.timeZone);
    const [year, month, day] = moment.date.split('-');
    return `${day}.${month}.${year} ${moment.time.slice(0, 5)}`;
  };

  // A training receipt says so first and last, where nobody can miss it (RF-F22).
  const trainingMark =
    content.training && l.training
      ? wrap(`*** ${l.training} ***`, width).map((line) => center(line, width))
      : [];
  out.push(...trainingMark);
  const loc = content.location;
  for (const text of [
    loc.name,
    loc.legalName,
    loc.street,
    `${loc.postalCode} ${loc.city}`,
    loc.vatNumber,
  ]) {
    if (text) out.push(center(text, width));
  }
  if (loc.header) out.push(...wrap(loc.header, width).map((line) => center(line, width)));
  out.push(rule);
  out.push(...columns(l.receipt ?? '', `${l.receiptNumber} ${content.receiptNumber}`, width));
  out.push(
    ...columns(
      `${l.order} ${content.orderNumber}`,
      content.tableLabel ? `${l.table} ${content.tableLabel}` : '',
      width,
    ),
  );
  out.push(`${l.date} ${when(content.issuedAt)}`);
  if (content.servedBy) out.push(...wrap(`${l.servedBy} ${content.servedBy}`, width));
  out.push(rule);

  for (const line of content.lines) {
    const perUnit =
      line.unitPriceRappen +
      line.modifiers.reduce((sum, m) => sum + m.priceDeltaRappen * m.quantity, 0);
    const name = line.variantName ? `${line.name} (${line.variantName})` : line.name;
    out.push(...columns(`${line.quantity} x ${name}`, money(perUnit * line.quantity), width));
    for (const modifier of line.modifiers) {
      const label = `  + ${modifier.quantity > 1 ? `${modifier.quantity} x ` : ''}${modifier.name}`;
      out.push(...wrap(label, width));
    }
    if (line.discountRappen !== 0) {
      out.push(...columns(`  ${l.discount}`, money(-line.discountRappen), width));
    }
  }
  out.push(rule);
  if (content.totals.discountRappen !== 0) {
    out.push(...columns(l.subtotal ?? '', money(content.totals.grossRappen), width));
    out.push(...columns(l.discount ?? '', money(-content.totals.discountRappen), width));
  }
  out.push(
    ...columns(`${(l.total ?? '').toUpperCase()} CHF`, money(content.totals.totalRappen), width),
  );
  out.push(rule);

  // MWST per rate (RN-08): rate, gross, tax, net, sized to the paper.
  const cellWidth = Math.min(10, Math.floor((width - 6) / 3));
  const firstWidth = width - 3 * cellWidth;
  const row = (first: string, ...cells: string[]) =>
    // Amounts are never cut: a wrong number on a receipt is worse than a longer line.
    `${first.slice(0, firstWidth).padEnd(firstWidth)}${cells.map((c) => c.padStart(cellWidth)).join('')}`;
  out.push(row(l.vat ?? '', l.gross ?? '', l.vat ?? '', l.net ?? ''));
  for (const tax of content.taxes) {
    out.push(
      row(
        formatRate(tax.rateBp),
        money(tax.grossRappen),
        money(tax.taxRappen),
        money(tax.netRappen),
      ),
    );
  }
  out.push(rule);

  const p = content.payment;
  const method = l[`methods.${p.method}`] ?? p.method;
  const paidLabel = p.splitLabel
    ? `${l.paidWith} ${method} (${p.splitLabel})`
    : `${l.paidWith} ${method}`;
  out.push(...columns(paidLabel, money(p.amountRappen), width));
  if (p.tipRappen !== 0) out.push(...columns(l.tip ?? '', money(p.tipRappen), width));
  if (p.roundingRappen !== 0)
    out.push(...columns(l.rounding ?? '', money(p.roundingRappen), width));
  if (p.tenderedRappen !== null) {
    out.push(...columns(l.tendered ?? '', money(p.tenderedRappen), width));
    out.push(...columns(l.change ?? '', money(p.changeRappen), width));
  }
  if (content.partial) {
    out.push(l.partialPayment ?? '');
    out.push(...columns(l.paidBefore ?? '', money(content.partial.paidBeforeRappen), width));
    out.push(...columns(l.balance ?? '', money(content.partial.balanceAfterRappen), width));
  }
  if (content.customer) {
    out.push(rule);
    out.push(...wrap(`${l.customer}: ${content.customer.name}`, width));
    if (content.customer.address) out.push(...wrap(content.customer.address, width));
  }
  out.push(rule);
  if (loc.footer) out.push(...wrap(loc.footer, width).map((line) => center(line, width)));
  out.push(center(l.thankYou ?? '', width));
  if (options.copyAt) out.push('', center(`*** ${l.copy} ${when(options.copyAt)} ***`, width));
  if (trainingMark.length > 0) out.push('', ...trainingMark);
  return out;
}
