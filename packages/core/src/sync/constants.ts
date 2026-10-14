/**
 * Operation levels, from the most local to the most remote (see docs/ARQUITECTURA.md).
 * The system always runs at the highest level available.
 */
export const SYNC_LEVELS = ['standalone', 'hub', 'cloud'] as const;
export type SyncLevel = (typeof SYNC_LEVELS)[number];

/** Status of an operation made offline and received by the hub or the cloud (RNF-03, RNF-04). */
export const SYNC_OPERATION_STATUSES = ['received', 'applied', 'conflict', 'rejected'] as const;
export type SyncOperationStatus = (typeof SYNC_OPERATION_STATUSES)[number];

/**
 * Conflict codes of docs/SYNC.md §5. A conflict never blocks the restaurant: what happened is
 * recorded and the manager reviews it (`sync.conflict_detected`).
 */
export const CONFLICT_CODES = [
  'overpayment',
  'payment_on_closed_order',
  'refund_exceeds_payment',
  'source_has_payments',
  'order_not_found',
  'order_state',
  'item_not_found',
  'item_state',
  'implicit_reopen',
  'approval_invalid',
  'user_inactive',
  'duplicate_number',
  'clock_skew',
  'invalid',
  // cash (DEC-038)
  'cash_without_shift',
  'shift_not_found',
  'shift_closed',
  'shift_mismatch',
  'shift_already_open',
  'shift_count_mismatch',
  'day_closed',
  // tables that belong to their waiter (DEC-039)
  'not_table_owner',
] as const;
export type ConflictCode = (typeof CONFLICT_CODES)[number];

/** Conflicts about a shift: the refold of shifts owns them, the refold of orders the rest. */
export const SHIFT_CONFLICT_CODES: readonly ConflictCode[] = [
  'shift_not_found',
  'shift_closed',
  'shift_mismatch',
  'shift_already_open',
  'shift_count_mismatch',
];
