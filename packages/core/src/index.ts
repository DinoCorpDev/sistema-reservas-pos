/**
 * @pos/core — pure domain of Zitas POS.
 *
 * Rules for this package (see CLAUDE.md):
 * - No framework, ORM, network or UI dependencies (enforced by ESLint).
 * - Money always in integer rappen; MWST rates always as data with a validity period.
 * - Every business rule and every money calculation has a unit test.
 */
export * from './shared/money';
export * from './shared/countries';
export * from './shared/ids';
export * from './shared/languages';
export * from './shared/channels';
export * from './shared/events';
export * from './shared/time';
export * from './shared/hlc';
export * from './shared/csv';

export * from './organization';
export * from './catalog';
export * from './tax';
export * from './tables';
export * from './orders';
export * from './kitchen';
export * from './payments';
export * from './cash';
export * from './receipts';
export * from './printing';
export * from './customers';
export * from './reservations';
export * from './reports';
export * from './platform';
export * from './audit';
export * from './sync';
