/**
 * Estado visible de una mesa en el mapa (RF-C01). Se DERIVA de sus órdenes y reservas;
 * nadie lo cambia a mano, por eso no se guarda como columna.
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

/** Qué permite el QR de un área o mesa (RF-E08, RN-24). */
export const QR_MODES = ['disabled', 'view', 'order', 'order_pay'] as const;
export type QrMode = (typeof QR_MODES)[number];
