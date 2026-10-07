import {
  CONTENT_LANGUAGES,
  type ContentLanguage,
  type FoldState,
  isContentLanguage,
  parseChf,
  type PaymentState,
  type Rappen,
  rappen,
  refundsOf,
  splitEvenly,
} from '@pos/core';

/**
 * Pure helpers of the payment screens: amounts typed by the cashier, the equal split (DEC-025)
 * and what is left to collect. Money stays in integer rappen; the rules themselves (rounding,
 * change, tips, MWST) are @pos/core's.
 */

// ── Amounts typed on the keypad or the keyboard ─────────────────────────────

/** Up to CHF 999'999.99 with at most 2 decimals, as typed (thousands separators not allowed). */
const TYPED_AMOUNT = /^\d{1,6}([.,]\d{0,2})?$/;

/** A CHF amount typed by the cashier ("20", "20.5", "20.00", "1'234.50"); null if not valid. */
export function parseAmount(text: string): Rappen | null {
  const trimmed = text.trim().replace(/[.,]$/, '');
  if (trimmed === '') return null;
  try {
    const value = parseChf(trimmed);
    return value < 0 ? null : value;
  } catch {
    return null;
  }
}

/** Text of an amount input: "1234.50" (no separator, so it can be typed over and parsed back). */
export function toAmountText(amount: number): string {
  const absolute = Math.abs(amount);
  const francs = Math.trunc(absolute / 100);
  const cents = String(absolute % 100).padStart(2, '0');
  return `${amount < 0 ? '-' : ''}${francs}.${cents}`;
}

/**
 * One key of the on-screen keypad applied to the amount being typed. `replace` starts a new
 * amount (the first key after choosing a field overwrites the proposed value).
 */
export function typeAmountKey(current: string, key: string, replace: boolean): string {
  const base = replace ? '' : current;
  if (key === '.' || key === ',') {
    if (/[.,]/.test(base)) return base;
    return `${base === '' ? '0' : base}.`;
  }
  const next = base === '0' ? key : `${base}${key}`;
  return TYPED_AMOUNT.test(next) ? next : base;
}

export function eraseAmountKey(current: string, replace: boolean): string {
  return replace ? '' : current.slice(0, -1);
}

const BANKNOTES_RAPPEN = [1000, 2000, 5000, 10000, 20000] as const;

/** Quick "given" amounts for cash: the next round amounts in banknotes above what is due. */
export function quickTenders(collect: Rappen, max = 4): Rappen[] {
  const result: number[] = [];
  for (const note of BANKNOTES_RAPPEN) {
    const remainder = collect % note;
    const next = remainder === 0 ? collect : collect + (note - remainder);
    if (next > collect && !result.includes(next)) result.push(next);
  }
  return result.slice(0, max).map((value) => rappen(value));
}

// ── Equal split: payments labelled "k/N" on the same order (DEC-025) ────────

const SPLIT_LABEL = /^(\d{1,2})\/(\d{1,2})$/;

export const MIN_SPLIT_PARTS = 2;
export const MAX_SPLIT_PARTS = 20;

function splitLabelOf(payment: PaymentState): { index: number; parts: number } | null {
  const match = payment.splitLabel ? SPLIT_LABEL.exec(payment.splitLabel) : null;
  if (!match) return null;
  return { index: Number(match[1]), parts: Number(match[2]) };
}

/**
 * Number of parts of an equal split still in progress, read from the payments themselves, so it
 * survives leaving the screen (receipt, "Weiter kassieren") and is the same on every terminal.
 */
export function splitInProgress(payments: readonly PaymentState[]): number | null {
  const labelled = payments
    .map((payment) => ({ payment, label: splitLabelOf(payment) }))
    .filter((entry) => entry.label !== null)
    .sort((a, b) => a.payment.completedAt.localeCompare(b.payment.completedAt));
  const last = labelled.at(-1)?.label;
  if (!last) return null;
  const paid = labelled.filter((entry) => entry.label?.parts === last.parts).length;
  return paid < last.parts ? last.parts : null;
}

export interface EqualSplit {
  parts: number;
  paid: { index: number; payment: PaymentState }[];
  /** Proposed amounts of the parts still to pay: the balance split evenly (largest remainder). */
  upcoming: { index: number; amountRappen: Rappen }[];
}

export function equalSplitOf(
  payments: readonly PaymentState[],
  balance: Rappen,
  parts: number,
): EqualSplit {
  const paid = payments
    .filter((payment) => splitLabelOf(payment)?.parts === parts)
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt))
    .map((payment, position) => ({ index: position + 1, payment }));
  const remaining = parts - paid.length;
  const upcoming =
    remaining > 0 && balance > 0
      ? splitEvenly(balance, remaining).map((amountRappen, position) => ({
          index: paid.length + position + 1,
          amountRappen,
        }))
      : [];
  return { parts, paid, upcoming };
}

// ── Orders still to collect and refunds ─────────────────────────────────────

const isPayable = (fold: FoldState, orderId: string | null | undefined): boolean => {
  const order = orderId ? fold.orders.get(orderId) : undefined;
  return order !== undefined && order.status === 'open' && order.balanceRappen > 0;
};

/**
 * Next order to collect after a payment: the order itself while it has a balance; otherwise the
 * order it was split from, or another part of the same split (RF-C12, DEC-025).
 */
export function nextToCollect(fold: FoldState, orderId: string): string | null {
  if (isPayable(fold, orderId)) return orderId;
  const order = fold.orders.get(orderId);
  if (!order) return null;
  const root = order.splitFromOrderId ?? order.id;
  if (root !== orderId && isPayable(fold, root)) return root;
  for (const other of fold.orders.values()) {
    if (other.id !== orderId && other.splitFromOrderId === root && isPayable(fold, other.id)) {
      return other.id;
    }
  }
  return null;
}

/** What can still be refunded on a payment: sale part and tip, net of earlier refunds (RN-14). */
export function refundableOf(fold: FoldState, payment: PaymentState) {
  let amount = 0;
  let tip = 0;
  for (const refund of refundsOf(fold, payment.orderId)) {
    if (refund.paymentId !== payment.id) continue;
    amount += refund.amountRappen;
    tip += refund.tipRappen;
  }
  return {
    refundedRappen: rappen(amount),
    refundedTipRappen: rappen(tip),
    amountRappen: rappen(Math.max(0, payment.amountRappen - amount)),
    tipRappen: rappen(Math.max(0, payment.tipRappen - tip)),
  };
}

// ── Receipt language (RF-D23) ───────────────────────────────────────────────

/** Content languages offered for the receipt: the location's, defaulting to its main one. */
export function receiptLanguages(
  location: { languages: readonly string[]; defaultLanguage: string } | undefined,
): { options: ContentLanguage[]; initial: ContentLanguage } {
  const offered = [...new Set((location?.languages ?? []).filter(isContentLanguage))];
  const options = offered.length > 0 ? offered : [...CONTENT_LANGUAGES];
  const preferred = location?.defaultLanguage;
  const initial =
    isContentLanguage(preferred) && options.includes(preferred) ? preferred : (options[0] ?? 'de');
  return { options, initial };
}
