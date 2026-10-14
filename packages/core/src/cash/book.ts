/**
 * The daily cash book (Kassenbuch, RF-D16): mandatory in Switzerland when a business takes
 * cash. Every franc that entered or left a drawer that day, in time order, with the running
 * balance: the counted floats, cash sales and refunds with their receipt, the movements and
 * the difference found at each count. Generated from the records, never typed in.
 */

export const CASH_BOOK_KINDS = [
  'opening',
  'sale',
  'refund',
  'cash_in',
  'cash_out',
  'expense',
  'correction',
  'difference',
] as const;
export type CashBookKind = (typeof CASH_BOOK_KINDS)[number];

export interface CashBookEntry {
  /** ISO instant of the fact. */
  at: string;
  kind: CashBookKind;
  shiftId: string | null;
  /** Receipt number, or the movement's reason. */
  reference: string | null;
  /** Signed: + into the drawer. */
  amountRappen: number;
}

export interface CashBookLine extends CashBookEntry {
  balanceRappen: number;
}

export interface CashBook {
  lines: CashBookLine[];
  inRappen: number;
  outRappen: number;
  /** What the drawers held at the end of the day by the book. */
  endBalanceRappen: number;
}

/** Same instant: the opening first and the count difference last. */
const RANK: Record<CashBookKind, number> = {
  opening: 0,
  sale: 1,
  refund: 1,
  cash_in: 1,
  cash_out: 1,
  expense: 1,
  correction: 1,
  difference: 2,
};

export function cashBook(entries: readonly CashBookEntry[]): CashBook {
  const sorted = [...entries].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at) || RANK[a.kind] - RANK[b.kind],
  );
  let balance = 0;
  let inRappen = 0;
  let outRappen = 0;
  const lines = sorted.map((entry) => {
    balance += entry.amountRappen;
    if (entry.amountRappen >= 0) inRappen += entry.amountRappen;
    else outRappen -= entry.amountRappen;
    return { ...entry, balanceRappen: balance };
  });
  return { lines, inRappen, outRappen, endBalanceRappen: balance };
}
