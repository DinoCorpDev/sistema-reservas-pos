import type { PrinterKind, RoleKey, TerminalType, UiLanguage } from '@pos/core';
import type { OpeningHours } from '../../schema';
import type { StationKey } from './catalog';

/**
 * Data of the "Restaurant Demo Zürich" (DEC-004: Zürich, DE for location and kitchen).
 * Everything is fictitious; the UID is a demo one with a valid check digit.
 */
export const DEMO_ORGANIZATION = {
  name: 'Demo Gastro AG',
  slug: 'demo-gastro',
  legalName: 'Demo Gastro AG',
  defaultLanguage: 'de',
} as const;

const LUNCH_AND_DINNER: [string, string][] = [
  ['11:00', '14:30'],
  ['17:30', '23:00'],
];

export const DEMO_LOCATION = {
  name: 'Restaurant Demo Zürich',
  legalName: 'Demo Gastro AG',
  street: 'Musterstrasse 1',
  postalCode: '8001',
  city: 'Zürich',
  canton: 'ZH',
  country: 'CH',
  vatUid: 'CHE-123.456.788 MWST',
  currency: 'CHF',
  timezone: 'Europe/Zurich',
  defaultLanguage: 'de',
  kitchenLanguage: 'de',
  languages: ['de', 'fr', 'it', 'en'],
  phone: '+41 44 000 00 00',
  email: 'info@demo-zuerich.test',
  receiptFooter: 'Vielen Dank für Ihren Besuch!',
  openingHours: {
    mon: [],
    tue: LUNCH_AND_DINNER,
    wed: LUNCH_AND_DINNER,
    thu: LUNCH_AND_DINNER,
    fri: LUNCH_AND_DINNER,
    sat: [['17:30', '23:30']],
    sun: [['11:00', '15:00']],
  } satisfies OpeningHours,
};

/** Two areas, 12 tables: Saal 1-8, Terrasse T1-T4 (seasonal). */
export const DEMO_AREAS = [
  { name: 'Saal', qrMode: 'order_pay', tables: ['1', '2', '3', '4', '5', '6', '7', '8'] },
  { name: 'Terrasse', qrMode: 'order', tables: ['T1', 'T2', 'T3', 'T4'] },
] as const;

/** Bar and pastry send to the kitchen while nobody is there (DEC-033). */
export const DEMO_STATIONS: {
  key: StationKey;
  name: string;
  alertAfterMinutes: number | null;
  fallback?: StationKey;
}[] = [
  { key: 'kitchen', name: 'Küche', alertAfterMinutes: null },
  { key: 'bar', name: 'Bar', alertAfterMinutes: 5, fallback: 'kitchen' },
  { key: 'dessert', name: 'Patisserie', alertAfterMinutes: 8, fallback: 'kitchen' },
];

export const DEMO_PRINTERS: {
  key: string;
  name: string;
  kind: PrinterKind;
  host: string;
  hasCashDrawer: boolean;
  station?: StationKey;
}[] = [
  {
    key: 'receipt',
    name: 'Bondrucker Kasse',
    kind: 'receipt',
    host: '192.168.1.50',
    hasCashDrawer: true,
  },
  {
    key: 'kitchen',
    name: 'Küchendrucker',
    kind: 'kitchen',
    host: '192.168.1.51',
    hasCashDrawer: false,
    station: 'kitchen',
  },
];

export const DEMO_TERMINALS: {
  name: string;
  type: TerminalType;
  prefix: string;
  station?: StationKey;
  receiptPrinter?: string;
}[] = [
  { name: 'Kasse 1', type: 'pos', prefix: 'K1', receiptPrinter: 'receipt' },
  { name: 'Handheld 1', type: 'handheld', prefix: 'H1' },
  { name: 'Handheld 2', type: 'handheld', prefix: 'H2' },
  { name: 'KDS Küche', type: 'kds', prefix: 'D1', station: 'kitchen' },
  { name: 'KDS Bar', type: 'kds', prefix: 'D2', station: 'bar' },
  // Every station needs a display or a printer, or its tickets show up nowhere (station_output).
  { name: 'KDS Patisserie', type: 'kds', prefix: 'D3', station: 'dessert' },
  // No fixed station: it asks before the PIN which one the cook works at (DEC-042).
  { name: 'KDS Allgemein', type: 'kds', prefix: 'D4' },
];

/**
 * TEST users. The PINs and the password are development values; never used in
 * production. The backoffice password can be overridden with SEED_ADMIN_PASSWORD.
 */
export const DEMO_USERS: {
  displayName: string;
  email?: string;
  roles: RoleKey[];
  pin: string;
  uiLanguage: UiLanguage;
}[] = [
  {
    displayName: 'Sandra Keller',
    email: 'admin@demo-zuerich.test',
    roles: ['admin'],
    pin: '1000',
    uiLanguage: 'de',
  },
  {
    displayName: 'Marco Brunner',
    email: 'manager@demo-zuerich.test',
    roles: ['manager'],
    pin: '2000',
    uiLanguage: 'de',
  },
  { displayName: 'Lea Meier', roles: ['cashier', 'waiter'], pin: '3000', uiLanguage: 'de' },
  { displayName: 'Anna Huber', roles: ['waiter'], pin: '4001', uiLanguage: 'de' },
  { displayName: 'Luca Rossi', roles: ['waiter'], pin: '4002', uiLanguage: 'it' },
  { displayName: 'Jonas Weber', roles: ['kitchen'], pin: '5000', uiLanguage: 'de' },
];

export const DEMO_BACKOFFICE_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'demo-zuerich-2026';

export const DEMO_CUSTOMERS = [
  {
    firstName: 'Peter',
    lastName: 'Muster',
    phone: '+41790000001',
    email: 'peter.muster@example.com',
    language: 'de',
    declaredAllergies: 'Nüsse',
    tags: ['VIP'],
  },
  {
    firstName: 'Claire',
    lastName: 'Exemple',
    phone: '+41790000002',
    email: 'claire.exemple@example.com',
    language: 'fr',
    declaredAllergies: null,
    tags: ['habitual'],
  },
] as const;

export const DEMO_CONSENT_TEXT =
  'Ich bin einverstanden, dass Demo Gastro AG meine Kontaktdaten für Reservationen und Belege speichert (revDSG).';

/**
 * DINOLABS support account of the development database (platform level, RF-A10). TEST value only;
 * can be overridden with SEED_SUPPORT_PASSWORD.
 */
export const DEMO_SUPPORT_STAFF = {
  email: 'support@dinolabs.test',
  displayName: 'DINOLABS Support',
  password: process.env.SEED_SUPPORT_PASSWORD ?? 'support-dinolabs-2026',
};
