import { boolean, char, int, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { organizationId, primaryId, timestamps, utcDatetime, uuid } from '../columns';
import { locations, organizations } from './organization';

/**
 * Usuario de la organización (RF-A04). Entra al backoffice con correo y contraseña (RF-A07) y al
 * POS con un PIN de 4-6 dígitos hasheado con argon2 (RF-A06). Se desactiva, nunca se borra (RF-A12).
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
    /** Idioma de la interfaz del usuario, independiente de la sede y del cliente (RF-A08). */
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

/** Sedes en las que trabaja un usuario (RF-A04: varias sedes). */
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

/** Rol de la organización. Los predefinidos (`isSystem`) son admin, manager, cashier, waiter, kitchen. */
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

/** Roles de un usuario; `locationId` null = en todas sus sedes (RF-A04: varios roles). */
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

/** Permiso concedido a un rol; la clave es una de `PERMISSIONS` de @pos/core (RF-A05). */
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
