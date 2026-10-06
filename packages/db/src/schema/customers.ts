import { char, json, mysqlTable, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { organizationId, primaryId, timestamps, utcDatetime, uuid } from '../columns';
import { locations, organizations } from './organization';
import { users } from './users';

/**
 * Cliente único por organización, identificado por teléfono o correo y compartido por reservas,
 * QR, web y POS (RF-E14). Al pedir el borrado se anonimiza: los datos personales se vacían y las
 * ventas y recibos se conservan (RF-E16, RN-23).
 */
export const customers = mysqlTable(
  'customers',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    firstName: varchar('first_name', { length: 100 }),
    lastName: varchar('last_name', { length: 100 }),
    /** Teléfono en formato E.164 (`+41…`). */
    phone: varchar('phone', { length: 20 }),
    email: varchar('email', { length: 254 }),
    language: char('language', { length: 2 }),
    notes: text('notes'),
    /** Alergias declaradas por el propio cliente (RF-E15). */
    declaredAllergies: text('declared_allergies'),
    tags: json('tags').$type<string[]>(),
    anonymizedAt: utcDatetime('anonymized_at'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_customers_org_phone').on(t.organizationId, t.phone),
    uniqueIndex('uq_customers_org_email').on(t.organizationId, t.email),
  ],
);

/** Consentimiento registrado: fecha, canal y texto aceptado (RN-23, revDSG). */
export const consents = mysqlTable('consents', {
  id: primaryId(),
  organizationId: organizationId().references(() => organizations.id),
  locationId: uuid('location_id').references(() => locations.id),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id),
  purpose: varchar('purpose', { length: 32 }).notNull(),
  source: varchar('source', { length: 16 }).notNull(),
  textVersion: varchar('text_version', { length: 32 }).notNull(),
  /** Texto exacto que el cliente aceptó. */
  textSnapshot: text('text_snapshot').notNull(),
  grantedAt: utcDatetime('granted_at').notNull(),
  revokedAt: utcDatetime('revoked_at'),
  recordedByUserId: uuid('recorded_by_user_id').references(() => users.id),
  ...timestamps(),
});
