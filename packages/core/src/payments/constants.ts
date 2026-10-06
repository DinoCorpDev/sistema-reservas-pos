/** Medios de pago (tender) que ve el usuario (RF-D01). */
export const PAYMENT_METHODS = ['cash', 'card', 'twint', 'online', 'voucher'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Adaptadores de pago (PA-04, RF-D10). El motor de órdenes no conoce al proveedor.
 * MVP: `cash` y `external-terminal`; `online` es un stub con interfaz definida (DEC-003).
 */
export const PAYMENT_ADAPTERS = ['cash', 'external-terminal', 'online'] as const;
export type PaymentAdapterKey = (typeof PAYMENT_ADAPTERS)[number];

/** Estado de un registro de pago. Un pago completado no se modifica (RN-14). */
export const PAYMENT_RECORD_STATUSES = ['pending', 'completed', 'failed'] as const;
export type PaymentRecordStatus = (typeof PAYMENT_RECORD_STATUSES)[number];
