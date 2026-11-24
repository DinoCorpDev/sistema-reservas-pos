import {
  boolean,
  char,
  index,
  int,
  mysqlTable,
  smallint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { locationId, organizationId, primaryId, timestamps, utcDatetime, uuid } from '../columns';
import { locations, organizations } from './organization';

/**
 * Organization user (RF-A04). Signs in to the backoffice with email and password (RF-A07) and to
 * the POS with a 4-6 digit PIN hashed with argon2 (RF-A06). Deactivated, never deleted (RF-A12).
 */
export const users = mysqlTable(
  'users',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    displayName: varchar('display_name', { length: 100 }).notNull(),
    email: varchar('email', { length: 254 }),
    passwordHash: varchar('password_hash', { length: 255 }),
    pinHash: varchar('pin_hash', { length: 255 }),
    /**
     * HMAC-SHA256 of the PIN with the organization's `pin_key` (DEC-015): identifies the user from
     * the PIN alone and makes PINs unique within the organization.
     */
    pinLookup: char('pin_lookup', { length: 64 }),
    /** The user's UI language, independent of the location and the customer (RF-A08). */
    uiLanguage: char('ui_language', { length: 2 }).notNull().default('de'),
    failedPinAttempts: int('failed_pin_attempts').notNull().default(0),
    lockedUntil: utcDatetime('locked_until'),
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    /** Base32 TOTP secret for backoffice 2FA (RF-A07). */
    totpSecret: varchar('totp_secret', { length: 64 }),
    /** Set when support creates the account with a temporary password. */
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    lastLoginAt: utcDatetime('last_login_at'),
    isActive: boolean('is_active').notNull().default(true),
    deactivatedAt: utcDatetime('deactivated_at'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_users_email').on(t.email),
    uniqueIndex('uq_users_org_pin_lookup').on(t.organizationId, t.pinLookup),
  ],
);

/** Locations where a user works (RF-A04: multiple locations). */
export const userLocations = mysqlTable(
  'user_locations',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_user_locations').on(t.userId, t.locationId)],
);

/** Organization role. The predefined ones (`isSystem`) are admin, manager, cashier, waiter, kitchen. */
export const roles = mysqlTable(
  'roles',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    key: varchar('key', { length: 32 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_roles_org_key').on(t.organizationId, t.key)],
);

/** A user's roles; `locationId` null = at all of their locations (RF-A04: multiple roles). */
export const userRoles = mysqlTable(
  'user_roles',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    locationId: uuid('location_id').references(() => locations.id),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_user_roles').on(t.userId, t.roleId, t.locationId)],
);

/** Permission granted to a role; the key is one of `PERMISSIONS` from @pos/core (RF-A05). */
export const rolePermissions = mysqlTable(
  'role_permissions',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    permission: varchar('permission', { length: 64 }).notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_role_permissions').on(t.roleId, t.permission)],
);

/**
 * A code to join the team from one's own phone (DEC-055), shown as a QR by a manager: an hour,
 * up to ten people, and it dies after five rejected attempts. Only its hash is stored.
 */
export const staffInvites = mysqlTable(
  'staff_invites',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    locationId: locationId().references(() => locations.id),
    /** SHA-256 of the normalized code. */
    codeHash: char('code_hash', { length: 64 }).notNull(),
    /** The role the people who join get (a waiter). */
    roleKey: varchar('role_key', { length: 32 }).notNull().default('waiter'),
    expiresAt: utcDatetime('expires_at').notNull(),
    maxUses: smallint('max_uses').notNull().default(10),
    uses: smallint('uses').notNull().default(0),
    failedAttempts: smallint('failed_attempts').notNull().default(0),
    createdByUserId: uuid('created_by_user_id'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_staff_invites_code').on(t.codeHash)],
);

/**
 * Someone who joined with an invitation and waits for the manager (DEC-055). The PIN is kept
 * only as its hash and its lookup, ready to become a user on approval; nothing opens before.
 */
export const staffRegistrations = mysqlTable(
  'staff_registrations',
  {
    id: primaryId(),
    organizationId: organizationId().references(() => organizations.id),
    locationId: locationId().references(() => locations.id),
    inviteId: uuid('invite_id')
      .notNull()
      .references(() => staffInvites.id),
    displayName: varchar('display_name', { length: 100 }).notNull(),
    uiLanguage: char('ui_language', { length: 2 }).notNull().default('de'),
    pinHash: varchar('pin_hash', { length: 255 }).notNull(),
    pinLookup: char('pin_lookup', { length: 64 }).notNull(),
    /** `pending`, `approved` or `rejected` (REGISTRATION_STATUSES). */
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    decidedByUserId: uuid('decided_by_user_id'),
    decidedAt: utcDatetime('decided_at'),
    /** The user created on approval. */
    userId: uuid('user_id').references(() => users.id),
    ...timestamps(),
  },
  (t) => [index('idx_staff_registrations_status').on(t.locationId, t.status)],
);
