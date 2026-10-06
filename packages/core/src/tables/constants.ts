/**
 * Visible state of a table on the map (RF-C01). It is DERIVED from its orders and reservations;
 * nobody changes it by hand, so it is not stored as a column.
 */
export const TABLE_STATES = [
  'free',
  'reserved',
  'occupied',
  'awaiting_order',
  'in_kitchen',
  'ready',
  'awaiting_payment',
] as const;
export type TableState = (typeof TABLE_STATES)[number];

/** What the QR of an area or table allows (RF-E08, RN-24). */
export const QR_MODES = ['disabled', 'view', 'order', 'order_pay'] as const;
export type QrMode = (typeof QR_MODES)[number];
