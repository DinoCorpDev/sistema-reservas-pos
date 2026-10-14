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

/**
 * Who may work on a table's order (DEC-039):
 * - `open`: any waiter takes orders, sends and collects at any table; the table stays with the
 *   waiter who opened it (and so does the tip) until someone takes it over;
 * - `restricted`: only the table's waiter, or whoever has `order.any_table` (the till, managers);
 *   another waiter takes the table over first, which is recorded.
 */
export const TABLE_OWNERSHIP_MODES = ['open', 'restricted'] as const;
export type TableOwnershipMode = (typeof TABLE_OWNERSHIP_MODES)[number];
