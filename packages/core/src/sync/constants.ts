/**
 * Niveles de operación, del más local al más remoto (ver docs/ARQUITECTURA.md).
 * El sistema siempre opera en el nivel más alto disponible.
 */
export const SYNC_LEVELS = ['standalone', 'hub', 'cloud'] as const;
export type SyncLevel = (typeof SYNC_LEVELS)[number];

/** Estado de una operación hecha sin conexión y recibida por el hub o la nube (RNF-03, RNF-04). */
export const SYNC_OPERATION_STATUSES = ['received', 'applied', 'conflict', 'rejected'] as const;
export type SyncOperationStatus = (typeof SYNC_OPERATION_STATUSES)[number];
