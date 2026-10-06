/**
 * System events (section 16 of the document, PA-10).
 *
 * Fixed lowercase `module.fact` name. They are stored in `outbox_events` within the same
 * transaction as the change and published afterwards. An event is never edited: if it was a
 * mistake, another event that corrects it is published.
 */
export const EVENT_TYPES = [
  'order.created',
  'order.item_added',
  'order.item_voided',
  'order.sent_to_kitchen',
  'kitchen.ticket_ready',
  'order.item_served',
  'order.discount_applied',
  'order.transferred',
  'order.merged',
  'order.split',
  'order.reopened',
  'order.closed',
  'order.voided',
  'payment.created',
  'payment.completed',
  'payment.refunded',
  'receipt.issued',
  'shift.opened',
  'shift.closed',
  'cash.movement_recorded',
  'day.closed',
  'reservation.created',
  'reservation.confirmed',
  'reservation.seated',
  'reservation.no_show',
  'reservation.cancelled',
  'customer.created',
  'customer.consent_recorded',
  'customer.anonymized',
  'catalog.product_updated',
  'catalog.product_sold_out',
  'catalog.product_available',
  'tax.rule_changed',
  'sync.conflict_detected',
  'device.offline',
  'device.online',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Common envelope of every event: unique identifier, device and server time,
 * organization and location, originating user and terminal, and payload schema version.
 */
export interface EventEnvelope<TType extends EventType = EventType, TPayload = unknown> {
  id: string;
  type: TType;
  schemaVersion: number;
  organizationId: string;
  locationId: string | null;
  userId: string | null;
  terminalId: string | null;
  aggregateType: string;
  aggregateId: string;
  /** ISO 8601, clock of the device that originated the change. */
  occurredAt: string;
  /** ISO 8601, server clock on receipt; null while it exists only on the device. */
  recordedAt: string | null;
  payload: TPayload;
}
