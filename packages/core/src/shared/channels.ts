/**
 * Canal: por dónde entra la venta (glosario). Define el tipo de consumo por defecto y, con él,
 * la tasa de MWST de cada línea (RF-C07, RN-03). `delivery` existe en el modelo pero no se
 * vende en el MVP (sección 5).
 */
export const CHANNELS = ['table', 'bar', 'takeaway', 'qr', 'web', 'delivery'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Tipo de consumo: decide la tasa junto con la categoría fiscal (RF-B12). */
export const CONSUMPTION_TYPES = ['on_premise', 'takeaway', 'delivery'] as const;
export type ConsumptionType = (typeof CONSUMPTION_TYPES)[number];

/** Tipo de consumo por defecto de cada canal. Un pedido web puede declarar consumo en el local. */
export const DEFAULT_CONSUMPTION_BY_CHANNEL: Readonly<Record<Channel, ConsumptionType>> = {
  table: 'on_premise',
  bar: 'on_premise',
  qr: 'on_premise',
  takeaway: 'takeaway',
  web: 'takeaway',
  delivery: 'delivery',
};
