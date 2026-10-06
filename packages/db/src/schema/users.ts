import { boolean, char, int, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { organizationId, primaryId, timestamps, utcDatetime, uuid } from '../columns';
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
    /** The user's UI language, independent of the location and the customer (RF-A08). */
    uiLanguage: char('ui_language', { length: 2 }).notNull().default('de'),
    failedPinAttempts: int('failed_pin_attempts').notNull().default(0),
    lockedUntil: utcDatetime('locked_until'),
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    lastLoginAt: utcDatetime('last_login_at'),
    isActive: boolean('is_active').notNull().default(true),
    deactivatedAt: utcDatetime('deactivated_at'),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_users_email').on(t.email)],
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
