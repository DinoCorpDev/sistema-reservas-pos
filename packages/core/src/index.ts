/**
 * @pos/core — dominio puro del Sistema Reservas POS.
 *
 * Reglas de este paquete (ver CLAUDE.md):
 * - Sin dependencias de framework, ORM, red ni UI (lo vigila ESLint).
 * - Dinero siempre en rappen enteros; tasas de MWST siempre como datos con vigencia.
 * - Toda regla de negocio y todo cálculo de dinero tiene test unitario.
 */
export * from './shared/money';
export * from './shared/ids';
export * from './shared/languages';
export * from './shared/channels';
export * from './shared/events';

export * from './organization';
export * from './catalog';
export * from './tax';
export * from './tables';
export * from './orders';
export * from './kitchen';
export * from './payments';
export * from './cash';
export * from './receipts';
export * from './customers';
export * from './reservations';
export * from './reports';
export * from './audit';
export * from './sync';
