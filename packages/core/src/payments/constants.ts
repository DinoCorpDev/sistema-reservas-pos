/** Payment methods (tenders) the user sees (RF-D01). */
export const PAYMENT_METHODS = ['cash', 'card', 'twint', 'online', 'voucher'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Payment adapters (PA-04, RF-D10). The order engine does not know the provider.
 * MVP: `cash` and `external-terminal`; `online` is a stub with a defined interface (DEC-003).
 */
export const PAYMENT_ADAPTERS = ['cash', 'external-terminal', 'online'] as const;
export type PaymentAdapterKey = (typeof PAYMENT_ADAPTERS)[number];

/** Status of a payment record. A completed payment is never modified (RN-14). */
export const PAYMENT_RECORD_STATUSES = ['pending', 'completed', 'failed'] as const;
export type PaymentRecordStatus = (typeof PAYMENT_RECORD_STATUSES)[number];
