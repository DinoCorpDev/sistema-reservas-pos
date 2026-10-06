import type { LocationSettings } from '@pos/core';
import {
  boolean,
  char,
  int,
  json,
  mysqlTable,
  smallint,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { locationId, organizationId, primaryId, timestamps, utcDatetime, uuid } from '../columns';

/** Opening hours per day: list of `["HH:MM", "HH:MM"]` slots (RF-A02). */
export type OpeningHours = Partial<
  Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', [string, string][]>
>;

/** Organization: the customer company (RF-A01). Root of all multi-tenant isolation. */
export const organizations = mysqlTable(
  'organizations',
  {
    id: primaryId(),
    name: varchar('name', { length: 200 }).notNull(),
    slug: varchar('slug', { length: 80 }).notNull(),
    legalName: varchar('legal_name', { length: 200 }),
    defaultLanguage: char('default_language', { length: 2 }).notNull().default('de'),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    /** Training organization with fictitious data (RF-F22); never mixed with the real one. */
    isTraining: boolean('is_training').notNull().default(false),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_organizations_slug').on(t.slug)],
);

/** Location: physical restaurant with MWST UID, languages, opening hours and receipt data (RF-A02). */
export const locations = mysqlTable(
  'locations',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    name: varchar('name', { length: 200 }).notNull(),
    legalName: varchar('legal_name', { length: 200 }).notNull(),
    street: varchar('street', { length: 200 }).notNull(),
    postalCode: varchar('postal_code', { length: 10 }).notNull(),
    city: varchar('city', { length: 100 }).notNull(),
    canton: char('canton', { length: 2 }),
    country: char('country', { length: 2 }).notNull().default('CH'),
    /** UID with the MWST suffix as printed on the receipt, e.g. `CHE-123.456.788 MWST` (RN-08). */
    vatUid: varchar('vat_uid', { length: 32 }),
    currency: char('currency', { length: 3 }).notNull().default('CHF'),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Europe/Zurich'),
    defaultLanguage: char('default_language', { length: 2 }).notNull().default('de'),
    kitchenLanguage: char('kitchen_language', { length: 2 }).notNull().default('de'),
    languages: json('languages').$type<string[]>().notNull(),
    openingHours: json('opening_hours').$type<OpeningHours>(),
    phone: varchar('phone', { length: 32 }),
    email: varchar('email', { length: 254 }),
    receiptHeader: text('receipt_header'),
    receiptFooter: text('receipt_footer'),
    settings: json('settings').$type<LocationSettings>().notNull(),
    /** Set when the setup checklist is complete (RF-A11). */
    setupCompletedAt: utcDatetime('setup_completed_at'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_locations_org_name').on(t.organizationId, t.name)],
);

/** Area: dining room, terrace, bar. Seasonal areas are deactivated, tables kept (RF-C06). */
export const areas = mysqlTable('areas', {
  id: primaryId(),
  organizationId: organizationId().references(() => organizations.id),
  locationId: locationId().references(() => locations.id),
  name: varchar('name', { length: 100 }).notNull(),
  sortOrder: int('sort_order').notNull().default(0),
  /** What the QR allows in the area; the table can override it (RF-E08). */
  qrMode: varchar('qr_mode', { length: 16 }).notNull().default('view'),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps(),
});

/** Table. The map state is derived from orders and reservations, not stored (RF-C01). */
export const diningTables = mysqlTable(
  'dining_tables',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    locationId: locationId().references(() => locations.id),
    areaId: uuid('area_id')
      .notNull()
      .references(() => areas.id),
    label: varchar('label', { length: 16 }).notNull(),
    /** Public, unguessable code of the table's QR (RF-E06). */
    qrCode: varchar('qr_code', { length: 32 }).notNull(),
    capacity: smallint('capacity').notNull().default(4),
    shape: varchar('shape', { length: 16 }).notNull().default('rect'),
    posX: int('pos_x').notNull().default(0),
    posY: int('pos_y').notNull().default(0),
    width: int('width').notNull().default(1),
    height: int('height').notNull().default(1),
    /** null = inherits the area's QR mode. */
    qrMode: varchar('qr_mode', { length: 16 }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_dining_tables_location_label').on(t.locationId, t.label),
    uniqueIndex('uq_dining_tables_qr_code').on(t.qrCode),
  ],
);

/** Network printer for receipts or kitchen tickets (RF-F17). */
export const printers = mysqlTable('printers', {
  id: primaryId(),
  organizationId: organizationId().references(() => organizations.id),
  locationId: locationId().references(() => locations.id),
  name: varchar('name', { length: 100 }).notNull(),
  kind: varchar('kind', { length: 16 }).notNull(),
  protocol: varchar('protocol', { length: 24 }).notNull().default('escpos'),
  host: varchar('host', { length: 255 }).notNull(),
  port: int('port').notNull().default(9100),
  paperWidthMm: smallint('paper_width_mm').notNull().default(80),
  hasCashDrawer: boolean('has_cash_drawer').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  lastTestAt: utcDatetime('last_test_at'),
  ...timestamps(),
});

/** Kitchen station: hot kitchen, cold kitchen, bar, desserts (RF-A03, RF-C24). */
export const kitchenStations = mysqlTable('kitchen_stations', {
  id: primaryId(),
  organizationId: organizationId().references(() => organizations.id),
  locationId: locationId().references(() => locations.id),
  name: varchar('name', { length: 100 }).notNull(),
  /** null = the location's default threshold (`settings.kitchen.alertAfterMinutes`). */
  alertAfterMinutes: smallint('alert_after_minutes'),
  /** null = the location's kitchen language (RF-C25). */
  language: char('language', { length: 2 }),
  printerId: uuid('printer_id').references(() => printers.id),
  sortOrder: int('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps(),
});

/**
 * Terminal: POS tablet, handheld or KDS (RF-A03). Deactivated, never deleted (RF-A12).
 * `orderNumberPrefix` prevents numbering collisions when operating offline (RN-16).
 */
export const terminals = mysqlTable(
  'terminals',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    locationId: locationId().references(() => locations.id),
    name: varchar('name', { length: 100 }).notNull(),
    type: varchar('type', { length: 16 }).notNull(),
    orderNumberPrefix: varchar('order_number_prefix', { length: 4 }).notNull(),
    kitchenStationId: uuid('kitchen_station_id').references(() => kitchenStations.id),
    receiptPrinterId: uuid('receipt_printer_id').references(() => printers.id),
    appVersion: varchar('app_version', { length: 32 }),
    lastSeenAt: utcDatetime('last_seen_at'),
    isActive: boolean('is_active').notNull().default(true),
    deactivatedAt: utcDatetime('deactivated_at'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_terminals_location_prefix').on(t.locationId, t.orderNumberPrefix)],
);
