/**
 * Voids, discounts and refunds by person (RF-F06): who did it, why and for how much, so the
 * owner sees unusual patterns. Each list keeps its records; the summary groups them by person.
 */

export interface VoidRecord {
  at: string;
  userId: string | null;
  authorizedByUserId: string | null;
  reason: string | null;
  productName: string;
  quantity: number;
  /** Value of the voided line before discounts. */
  grossRappen: number;
  orderNumber: string;
}

export interface DiscountRecord {
  at: string;
  userId: string | null;
  authorizedByUserId: string | null;
  reason: string | null;
  /** The effect on the order. */
  amountRappen: number;
  orderNumber: string;
}

export interface RefundRecord {
  at: string;
  userId: string | null;
  authorizedByUserId: string | null;
  reason: string;
  amountRappen: number;
  orderNumber: string;
}

export interface AdjustmentTotals {
  count: number;
  rappen: number;
}

export interface AdjustmentsByPerson {
  userId: string | null;
  voids: AdjustmentTotals;
  discounts: AdjustmentTotals;
  refunds: AdjustmentTotals;
}

export interface AdjustmentsReport {
  voids: AdjustmentTotals;
  discounts: AdjustmentTotals;
  refunds: AdjustmentTotals;
  byPerson: AdjustmentsByPerson[];
  byReason: {
    kind: 'void' | 'discount' | 'refund';
    reason: string | null;
    count: number;
    rappen: number;
  }[];
  /** Newest first. */
  records: {
    voids: VoidRecord[];
    discounts: DiscountRecord[];
    refunds: RefundRecord[];
  };
}

const empty = (): AdjustmentTotals => ({ count: 0, rappen: 0 });

export function adjustmentsReport(input: {
  voids: readonly VoidRecord[];
  discounts: readonly DiscountRecord[];
  refunds: readonly RefundRecord[];
}): AdjustmentsReport {
  const people = new Map<string | null, AdjustmentsByPerson>();
  const reasons = new Map<string, AdjustmentsReport['byReason'][number]>();
  const totals = { voids: empty(), discounts: empty(), refunds: empty() };
  const add = (
    kind: 'void' | 'discount' | 'refund',
    record: { userId: string | null; reason: string | null },
    amount: number,
  ) => {
    const field = kind === 'void' ? 'voids' : kind === 'discount' ? 'discounts' : 'refunds';
    const person = people.get(record.userId) ?? {
      userId: record.userId,
      voids: empty(),
      discounts: empty(),
      refunds: empty(),
    };
    person[field].count += 1;
    person[field].rappen += amount;
    people.set(record.userId, person);
    totals[field].count += 1;
    totals[field].rappen += amount;
    const key = `${kind}|${record.reason ?? ''}`;
    const reason = reasons.get(key) ?? { kind, reason: record.reason, count: 0, rappen: 0 };
    reason.count += 1;
    reason.rappen += amount;
    reasons.set(key, reason);
  };
  for (const record of input.voids) add('void', record, record.grossRappen);
  for (const record of input.discounts) add('discount', record, record.amountRappen);
  for (const record of input.refunds) add('refund', record, record.amountRappen);
  const weight = (person: AdjustmentsByPerson) =>
    person.voids.rappen + person.discounts.rappen + person.refunds.rappen;
  const newest = <T extends { at: string }>(records: readonly T[]) =>
    [...records].sort((a, b) => b.at.localeCompare(a.at));
  return {
    ...totals,
    byPerson: [...people.values()].sort((a, b) => weight(b) - weight(a)),
    byReason: [...reasons.values()].sort((a, b) => b.rappen - a.rappen),
    records: {
      voids: newest(input.voids),
      discounts: newest(input.discounts),
      refunds: newest(input.refunds),
    },
  };
}
