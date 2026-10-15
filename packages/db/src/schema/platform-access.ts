import {
  boolean,
  char,
  index,
  json,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { locationId, organizationId, primaryId, timestamps, utcDatetime, uuid } from '../columns';
import { organizations } from './organization';
import { users } from './users';

/**
 * API credentials per organization (RF-F14): the restaurant's website and other apps read the
 * menu and availability, create reservations and orders. Only a SHA-256 of the key is stored;
 * the key itself is shown once.
 */
export const apiKeys = mysqlTable(
  'api_keys',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    name: varchar('name', { length: 100 }).notNull(),
    /** First characters of the key, to recognize it in lists (`pos_live_ab12cd`). */
    keyPrefix: varchar('key_prefix', { length: 24 }).notNull(),
    keyHash: char('key_hash', { length: 64 }).notNull(),
    scopes: json('scopes').$type<string[]>().notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    lastUsedAt: utcDatetime('last_used_at'),
    expiresAt: utcDatetime('expires_at'),
    revokedAt: utcDatetime('revoked_at'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_api_keys_hash').on(t.keyHash),
    uniqueIndex('uq_api_keys_prefix').on(t.keyPrefix),
  ],
);

/**
 * DINOLABS support staff (platform level, outside any organization). They create organizations
 * (Flujo 7) and can enter one only with the owner's time-limited permission (RF-A10).
 */
export const platformStaff = mysqlTable(
  'platform_staff',
  {
    id: primaryId(),
    email: varchar('email', { length: 254 }).notNull(),
    displayName: varchar('display_name', { length: 100 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    totpSecret: varchar('totp_secret', { length: 64 }),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: utcDatetime('last_login_at'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_platform_staff_email').on(t.email)],
);

/** Owner's permission for DINOLABS support to enter the organization, until `expiresAt` (RF-A10). */
export const supportAccessGrants = mysqlTable('support_access_grants', {
  id: primaryId(),
  organizationId: organizationId().references(() => organizations.id),
  grantedByUserId: uuid('granted_by_user_id')
    .notNull()
    .references(() => users.id),
  /** null = any active support staff member. */
  staffId: uuid('staff_id').references(() => platformStaff.id),
  reason: text('reason'),
  expiresAt: utcDatetime('expires_at').notNull(),
  revokedAt: utcDatetime('revoked_at'),
  ...timestamps(),
});

/**
 * Manager approvals already used (RN-15, DEC-015): an approval token works once. Kept in the
 * database so every instance of the API sees it (two web containers, DEC-045). `id` is the
 * token's id (`jti`); rows past `expires_at` are cleaned up as new ones arrive.
 */
export const approvalUses = mysqlTable(
  'approval_uses',
  {
    id: uuid('id').primaryKey(),
    organizationId: organizationId(),
    locationId: locationId(),
    expiresAt: utcDatetime('expires_at').notNull(),
  },
  (t) => [index('idx_approval_uses_expires').on(t.expiresAt)],
);
