/**
 * Channel: where the sale comes in (glossary). It sets the default consumption type and, with it,
 * the MWST rate of each line (RF-C07, RN-03). `delivery` exists in the model but is not
 * sold in the MVP (section 5).
 */
export const CHANNELS = ['table', 'bar', 'takeaway', 'qr', 'web', 'delivery'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Consumption type: decides the rate together with the tax category (RF-B12). */
export const CONSUMPTION_TYPES = ['on_premise', 'takeaway', 'delivery'] as const;
export type ConsumptionType = (typeof CONSUMPTION_TYPES)[number];

/** Default consumption type per channel. A web order can declare on-premise consumption. */
export const DEFAULT_CONSUMPTION_BY_CHANNEL: Readonly<Record<Channel, ConsumptionType>> = {
  table: 'on_premise',
  bar: 'on_premise',
  qr: 'on_premise',
  takeaway: 'takeaway',
  web: 'takeaway',
  delivery: 'delivery',
};
