import { char, json, mysqlTable, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { organizationId, primaryId, timestamps, utcDatetime, uuid } from '../columns';
import { locations, organizations } from './organization';
import { users } from './users';

/**
 * Single customer per organization, identified by phone or email and shared by reservations,
 * QR, web and POS (RF-E14). On a deletion request it is anonymized: personal data is cleared and
 * sales and receipts are kept (RF-E16, RN-23).
 */
export const customers = mysqlTable(
  'customers',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    firstName: varchar('first_name', { length: 100 }),
    lastName: varchar('last_name', { length: 100 }),
    /** Phone number in E.164 format (`+41…`). */
    phone: varchar('phone', { length: 20 }),
    email: varchar('email', { length: 254 }),
    language: char('language', { length: 2 }),
    notes: text('notes'),
    /** Allergies declared by the customer themselves (RF-E15). */
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

/** Recorded consent: date, channel and accepted text (RN-23, revDSG). */
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
  /** Exact text the customer accepted. */
  textSnapshot: text('text_snapshot').notNull(),
  grantedAt: utcDatetime('granted_at').notNull(),
  revokedAt: utcDatetime('revoked_at'),
  recordedByUserId: uuid('recorded_by_user_id').references(() => users.id),
  ...timestamps(),
});
