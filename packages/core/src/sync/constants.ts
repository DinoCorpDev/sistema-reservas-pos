/**
 * Operation levels, from the most local to the most remote (see docs/ARQUITECTURA.md).
 * The system always runs at the highest level available.
 */
export const SYNC_LEVELS = ['standalone', 'hub', 'cloud'] as const;
export type SyncLevel = (typeof SYNC_LEVELS)[number];

/** Status of an operation made offline and received by the hub or the cloud (RNF-03, RNF-04). */
export const SYNC_OPERATION_STATUSES = ['received', 'applied', 'conflict', 'rejected'] as const;
export type SyncOperationStatus = (typeof SYNC_OPERATION_STATUSES)[number];
