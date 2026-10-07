import type { sync } from '@pos/api';
import { formatChf, rappen } from '@pos/core';

/**
 * What the conflict screen shows of each stored operation. The frozen payload stays on the
 * server (a payment carries its whole receipt); only a short hint about the order goes along.
 */
export type ConflictHint =
  | { kind: 'payment' | 'refund'; amount: string; method: string }
  | { kind: 'opened' | 'split'; number: string };

export type ConflictRow = Pick<
  sync.SyncConflictDto,
  | 'id'
  | 'operation'
  | 'orderId'
  | 'terminalId'
  | 'userId'
  | 'deviceAt'
  | 'receivedAt'
  | 'resolvedAt'
  | 'resolvedByUserId'
> & {
  /** Conflict codes of docs/SYNC.md §5, each once, in the order they were found. */
  codes: string[];
  hint: ConflictHint | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function hintOf(operation: string, payload: unknown): ConflictHint | null {
  if (!isRecord(payload)) return null;
  if (operation === 'payment.record' || operation === 'refund.record') {
    const { amountRappen, method } = payload;
    if (typeof amountRappen !== 'number' || !Number.isSafeInteger(amountRappen)) return null;
    if (typeof method !== 'string') return null;
    return {
      kind: operation === 'payment.record' ? 'payment' : 'refund',
      amount: formatChf(rappen(amountRappen)),
      method,
    };
  }
  if (operation === 'order.open' || operation === 'order.split') {
    const number = payload.number;
    if (!isRecord(number) || typeof number.display !== 'string') return null;
    return { kind: operation === 'order.open' ? 'opened' : 'split', number: number.display };
  }
  return null;
}

/** Open conflicts first, then the resolved ones; each group newest first (as listed). */
export function toConflictRows(conflicts: sync.SyncConflictDto[]): ConflictRow[] {
  const rows = conflicts.map((conflict): ConflictRow => ({
    id: conflict.id,
    operation: conflict.operation,
    orderId: conflict.orderId,
    terminalId: conflict.terminalId,
    userId: conflict.userId,
    deviceAt: conflict.deviceAt,
    receivedAt: conflict.receivedAt,
    resolvedAt: conflict.resolvedAt,
    resolvedByUserId: conflict.resolvedByUserId,
    codes: [...new Set(conflict.conflicts.map((c) => c.code))],
    hint: hintOf(conflict.operation, conflict.payload),
  }));
  return [...rows.filter((row) => !row.resolvedAt), ...rows.filter((row) => row.resolvedAt)];
}
