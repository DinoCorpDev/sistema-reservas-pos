/** Reservation statuses (RF-E03). Walk-ins are visits without a reservation. */
export const RESERVATION_STATUSES = [
  'pending',
  'confirmed',
  'seated',
  'completed',
  'no_show',
  'cancelled',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const VISIT_STATUSES = ['active', 'completed'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];
