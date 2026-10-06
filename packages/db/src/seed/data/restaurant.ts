import type {
  ConsumptionType,
  PrinterKind,
  RoleKey,
  TaxCategoryKey,
  TaxRateCode,
  TerminalType,
  UiLanguage,
} from '@pos/core';
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

export const DEMO_STATIONS: { key: StationKey; name: string; alertAfterMinutes: number | null }[] =
  [
    { key: 'kitchen', name: 'Küche', alertAfterMinutes: null },
    { key: 'bar', name: 'Bar', alertAfterMinutes: 5 },
    { key: 'dessert', name: 'Patisserie', alertAfterMinutes: 8 },
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
];

export const DEMO_ROLE_NAMES: Record<RoleKey, string> = {
  admin: 'Administrator',
  manager: 'Geschäftsführung',
  cashier: 'Kasse',
  waiter: 'Service',
  kitchen: 'Küche',
};

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
 * Swiss MWST template as DATA (RN-02): rates in force since 2024 plus the previous ones,
 * so validity periods can be tested. Edited from the backoffice (RF-B13).
 */
export const SWISS_TAX_CATEGORIES: { key: TaxCategoryKey; name: string }[] = [
  { key: 'food', name: 'Speisen' },
  { key: 'non_alcoholic_beverage', name: 'Alkoholfreie Getränke' },
  { key: 'alcoholic_beverage', name: 'Alkoholische Getränke' },
  { key: 'accommodation', name: 'Beherbergung' },
  { key: 'other', name: 'Übrige' },
];

export const SWISS_TAX_RATES: {
  code: TaxRateCode;
  rateBp: number;
  validFrom: string;
  validTo: string | null;
}[] = [
  { code: 'normal', rateBp: 770, validFrom: '2018-01-01', validTo: '2023-12-31' },
  { code: 'reduced', rateBp: 250, validFrom: '2018-01-01', validTo: '2023-12-31' },
  { code: 'accommodation', rateBp: 370, validFrom: '2018-01-01', validTo: '2023-12-31' },
  { code: 'normal', rateBp: 810, validFrom: '2024-01-01', validTo: null },
  { code: 'reduced', rateBp: 260, validFrom: '2024-01-01', validTo: null },
  { code: 'accommodation', rateBp: 380, validFrom: '2024-01-01', validTo: null },
];

/** RN-03: on premise, normal rate; food and soft drinks for takeaway or delivery, reduced; alcohol always normal. */
export const SWISS_TAX_RULES: Record<TaxCategoryKey, Record<ConsumptionType, TaxRateCode>> = {
  food: { on_premise: 'normal', takeaway: 'reduced', delivery: 'reduced' },
  non_alcoholic_beverage: { on_premise: 'normal', takeaway: 'reduced', delivery: 'reduced' },
  alcoholic_beverage: { on_premise: 'normal', takeaway: 'normal', delivery: 'normal' },
  accommodation: {
    on_premise: 'accommodation',
    takeaway: 'accommodation',
    delivery: 'accommodation',
  },
  other: { on_premise: 'normal', takeaway: 'normal', delivery: 'normal' },
};
