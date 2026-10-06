/** Turno abierto por terminal o por cajero, según configure la sede (RF-D12, RN-19). */
export const SHIFT_MODES = ['terminal', 'cashier'] as const;
export type ShiftMode = (typeof SHIFT_MODES)[number];

export const SHIFT_STATUSES = ['open', 'closed'] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

/** Movimientos de caja (RF-D13). `correction` referencia un cierre ya hecho (RF-D17, RN-21). */
export const CASH_MOVEMENT_KINDS = ['cash_in', 'cash_out', 'expense', 'correction'] as const;
export type CashMovementKind = (typeof CASH_MOVEMENT_KINDS)[number];

/** Denominaciones CHF en circulación, en rappen, para el arqueo (RF-D14). */
export const CHF_DENOMINATIONS = [
  5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 100000,
] as const;
export type ChfDenomination = (typeof CHF_DENOMINATIONS)[number];
