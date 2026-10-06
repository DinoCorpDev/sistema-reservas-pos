/**
 * Eventos del sistema (sección 16 del documento, PA-10).
 *
 * Nombre fijo `modulo.hecho` en minúscula. Se guardan en `outbox_events` dentro de la misma
 * transacción que el cambio y se publican después. Un evento nunca se edita: si fue un error,
 * se publica otro que lo corrige.
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
 * Sobre común de todo evento: identificador único, hora del dispositivo y del servidor,
 * organización y sede, usuario y terminal de origen, y versión del esquema del payload.
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
  /** ISO 8601, reloj del dispositivo que originó el cambio. */
  occurredAt: string;
  /** ISO 8601, reloj del servidor al recibirlo; null mientras está solo en el dispositivo. */
  recordedAt: string | null;
  payload: TPayload;
}
