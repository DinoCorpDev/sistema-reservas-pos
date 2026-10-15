import {
  type createUserSchema,
  PERMISSIONS,
  ROLE_KEYS,
  type RoleKey,
  type setPasswordSchema,
  type setPinSchema,
  type setRolePermissionsSchema,
  type updateUserSchema,
} from '@pos/core';
import {
  hashPassword,
  inOrg,
  newPinKey,
  notDeleted,
  ownedByOrg,
  pinLookup,
  runCommand,
  schema as s,
  type Transaction,
} from '@pos/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { type Actor, assertPermission, requireLocationId } from '../../actor';
import { ApiError, isDuplicateKey, notFound } from '../../errors';
import { changedFields, iso, type ServiceDeps } from '../shared';
import { assertGrowth } from '../platform/plans';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Brings a link table (user roles, user locations, role permissions) to the desired set of keys
 * without deleting anything (PA-06): extra rows are soft-deleted, soft-deleted ones are restored
 * and only the missing keys are inserted, so the unique indexes never collide.
 */
async function syncLinks<K extends string>(
  rows: { id: string; key: string; deletedAt: Date | null }[],
  desired: readonly K[],
  ops: {
    setDeleted: (ids: string[], deletedAt: Date | null) => Promise<unknown>;
    insert: (keys: K[]) => Promise<unknown>;
  },
): Promise<void> {
  const wanted = new Set<string>(desired);
  const active = new Set(rows.filter((row) => !row.deletedAt).map((row) => row.key));
  const remove = rows.filter((row) => !row.deletedAt && !wanted.has(row.key)).map((row) => row.id);
  // One row per key is enough (NULL columns in a unique index allow several deleted ones).
  const restore = new Map(
    rows
      .filter((row) => row.deletedAt && wanted.has(row.key) && !active.has(row.key))
      .map((row) => [row.key, row.id]),
  );
  const insert = [...wanted].filter((key) => !active.has(key) && !restore.has(key)) as K[];
  if (remove.length > 0) await ops.setDeleted(remove, new Date());
  if (restore.size > 0) await ops.setDeleted([...restore.values()], null);
  if (insert.length > 0) await ops.insert(insert);
}

/** Every id must be a location of the actor's organization; others are 404 (RNF-12). */
async function assertLocations(deps: ServiceDeps, actor: Actor, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  const rows = await deps.db
    .select({ id: s.locations.id })
    .from(s.locations)
    .where(inOrg(s.locations, actor, inArray(s.locations.id, unique), notDeleted(s.locations)));
  if (rows.length !== unique.length) throw notFound('Location');
  return unique;
}

async function roleIdsByKey(deps: ServiceDeps, actor: Actor, keys: readonly RoleKey[]) {
  const unique = [...new Set(keys)];
  const rows = await deps.db
    .select({ id: s.roles.id, key: s.roles.key })
    .from(s.roles)
    .where(inOrg(s.roles, actor, inArray(s.roles.key, unique), notDeleted(s.roles)));
  if (rows.length !== unique.length) throw notFound('Role');
  return rows.map((row) => row.id);
}

/** The organization's PIN key (DEC-015), created on first use. */
async function ensurePinKey(deps: ServiceDeps, actor: Actor): Promise<string> {
  const read = async () => {
    const [org] = await deps.db
      .select({ pinKey: s.organizations.pinKey })
      .from(s.organizations)
      .where(eq(s.organizations.id, actor.organizationId));
    if (!org) throw notFound('Organization');
    return org.pinKey;
  };
  const current = await read();
  if (current) return current;
  // Conditional: two first PINs at the same time end up with the same key.
  await deps.db
    .update(s.organizations)
    .set({ pinKey: newPinKey() })
    .where(and(eq(s.organizations.id, actor.organizationId), isNull(s.organizations.pinKey)));
  return (await read())!;
}

/** Maps the unique indexes of `users` to a 409 that names the field, never the other user. */
function userConflict(error: unknown): never {
  if (isDuplicateKey(error)) {
    const text = [error, (error as { cause?: unknown }).cause]
      .map((e) => (e as { message?: string } | undefined)?.message ?? '')
      .join(' ');
    if (text.includes('uq_users_org_pin_lookup')) {
      throw new ApiError(
        'CONFLICT',
        'This PIN is already used in the organization; choose another',
        {
          field: 'pin',
        },
      );
    }
    if (text.includes('uq_users_email')) {
      throw new ApiError('CONFLICT', 'This email is already used by another account', {
        field: 'email',
      });
    }
  }
  throw error;
}

// ── Users (RF-A04, RF-A06…RF-A08, RF-A12) ───────────────────────────────────

type UserRow = typeof s.users.$inferSelect;

function toUserDto(row: UserRow, roles: string[], locationIds: string[]) {
  return {
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    uiLanguage: row.uiLanguage,
    roles,
    locationIds,
    hasPin: row.pinHash !== null,
    hasPassword: row.passwordHash !== null,
    twoFactorEnabled: row.twoFactorEnabled,
    mustChangePassword: row.mustChangePassword,
    isActive: row.isActive,
    lastLoginAt: iso(row.lastLoginAt),
    deactivatedAt: iso(row.deactivatedAt),
  };
}
export type UserDto = ReturnType<typeof toUserDto>;

const roleOrder = (key: string) => {
  const index = (ROLE_KEYS as readonly string[]).indexOf(key);
  return index === -1 ? ROLE_KEYS.length : index;
};

async function toUserDtos(deps: ServiceDeps, actor: Actor, users: UserRow[]): Promise<UserDto[]> {
  if (users.length === 0) return [];
  const ids = users.map((user) => user.id);
  const roleRows = await deps.db
    .select({ userId: s.userRoles.userId, key: s.roles.key })
    .from(s.userRoles)
    .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
    .where(
      inOrg(
        s.userRoles,
        actor,
        inArray(s.userRoles.userId, ids),
        notDeleted(s.userRoles),
        notDeleted(s.roles),
      ),
    );
  const locationRows = await deps.db
    .select({ userId: s.userLocations.userId, locationId: s.userLocations.locationId })
    .from(s.userLocations)
    .where(
      inOrg(
        s.userLocations,
        actor,
        inArray(s.userLocations.userId, ids),
        notDeleted(s.userLocations),
      ),
    );
  return users.map((user) => {
    const roles = [...new Set(roleRows.filter((r) => r.userId === user.id).map((r) => r.key))];
    roles.sort((a, b) => roleOrder(a) - roleOrder(b));
    const locationIds = locationRows.filter((l) => l.userId === user.id).map((l) => l.locationId);
    return toUserDto(user, roles, locationIds);
  });
}

async function loadUser(deps: ServiceDeps, actor: Actor, id: string) {
  const [row] = await deps.db
    .select()
    .from(s.users)
    .where(inOrg(s.users, actor, eq(s.users.id, id), notDeleted(s.users)));
  if (!row) throw notFound('User');
  return row;
}

export async function getUser(deps: ServiceDeps, actor: Actor, id: string): Promise<UserDto> {
  assertPermission(actor, 'user.manage');
  const [dto] = await toUserDtos(deps, actor, [await loadUser(deps, actor, id)]);
  return dto!;
}

/** Users of the organization, optionally only those who work at the actor's location. */
export async function listUsers(
  deps: ServiceDeps,
  actor: Actor,
  options: { currentLocation?: boolean } = {},
): Promise<UserDto[]> {
  assertPermission(actor, 'user.manage');
  let filter;
  if (options.currentLocation) {
    const locationId = requireLocationId(actor);
    const members = await deps.db
      .select({ userId: s.userLocations.userId })
      .from(s.userLocations)
      .where(
        inOrg(
          s.userLocations,
          actor,
          eq(s.userLocations.locationId, locationId),
          notDeleted(s.userLocations),
        ),
      );
    if (members.length === 0) return [];
    filter = inArray(
      s.users.id,
      members.map((m) => m.userId),
    );
  }
  const rows = await deps.db
    .select()
    .from(s.users)
    .where(inOrg(s.users, actor, notDeleted(s.users), filter))
    .orderBy(asc(s.users.displayName));
  return toUserDtos(deps, actor, rows);
}

async function syncUserRoles(tx: Transaction, actor: Actor, userId: string, roleIds: string[]) {
  const rows = await tx
    .select()
    .from(s.userRoles)
    .where(inOrg(s.userRoles, actor, eq(s.userRoles.userId, userId)));
  // Roles set here apply at all of the user's locations; location-scoped rows are replaced.
  await syncLinks(
    rows.map((row) => ({
      ...row,
      key: row.locationId ? `${row.roleId}@${row.locationId}` : row.roleId,
    })),
    roleIds,
    {
      setDeleted: (ids, deletedAt) =>
        tx
          .update(s.userRoles)
          .set({ deletedAt })
          .where(inOrg(s.userRoles, actor, inArray(s.userRoles.id, ids))),
      insert: (keys) =>
        tx
          .insert(s.userRoles)
          .values(keys.map((roleId) => ownedByOrg(actor, { userId, roleId, locationId: null }))),
    },
  );
}

async function syncUserLocations(
  tx: Transaction,
  actor: Actor,
  userId: string,
  locationIds: string[],
) {
  const rows = await tx
    .select()
    .from(s.userLocations)
    .where(inOrg(s.userLocations, actor, eq(s.userLocations.userId, userId)));
  await syncLinks(
    rows.map((row) => ({ ...row, key: row.locationId })),
    locationIds,
    {
      setDeleted: (ids, deletedAt) =>
        tx
          .update(s.userLocations)
          .set({ deletedAt })
          .where(inOrg(s.userLocations, actor, inArray(s.userLocations.id, ids))),
      insert: (keys) =>
        tx
          .insert(s.userLocations)
          .values(keys.map((locationId) => ownedByOrg(actor, { userId, locationId }))),
    },
  );
}

async function currentLinks(tx: Transaction, actor: Actor, userId: string) {
  const roles = await tx
    .select({ key: s.roles.key })
    .from(s.userRoles)
    .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
    .where(inOrg(s.userRoles, actor, eq(s.userRoles.userId, userId), notDeleted(s.userRoles)));
  const locations = await tx
    .select({ locationId: s.userLocations.locationId })
    .from(s.userLocations)
    .where(
      inOrg(
        s.userLocations,
        actor,
        eq(s.userLocations.userId, userId),
        notDeleted(s.userLocations),
      ),
    );
  return {
    roles: [...new Set(roles.map((r) => r.key))].sort((a, b) => roleOrder(a) - roleOrder(b)),
    locationIds: locations.map((l) => l.locationId).sort(),
  };
}

/**
 * Serializes changes that could leave the organization without an administrator (row lock on
 * the admin role), then verifies, after applying them, that one active admin remains.
 */
async function lockAdminRole(tx: Transaction, actor: Actor) {
  const [role] = await tx
    .select({ id: s.roles.id })
    .from(s.roles)
    .where(inOrg(s.roles, actor, eq(s.roles.key, 'admin'), notDeleted(s.roles)))
    .for('update');
  return role?.id ?? null;
}

async function assertAdminRemains(tx: Transaction, actor: Actor, adminRoleId: string | null) {
  if (!adminRoleId) return;
  const [admin] = await tx
    .select({ id: s.users.id })
    .from(s.userRoles)
    .innerJoin(s.users, eq(s.users.id, s.userRoles.userId))
    .where(
      inOrg(
        s.userRoles,
        actor,
        eq(s.userRoles.roleId, adminRoleId),
        notDeleted(s.userRoles),
        eq(s.users.isActive, true),
        notDeleted(s.users),
      ),
    )
    .limit(1);
  if (!admin) {
    throw new ApiError('CONFLICT', 'The organization must keep at least one active administrator');
  }
}

export async function createUser(
  deps: ServiceDeps,
  actor: Actor,
  input: z.output<typeof createUserSchema>,
): Promise<UserDto> {
  assertPermission(actor, 'user.manage');
  await assertGrowth(deps.db, actor.organizationId, { limit: 'users' });
  const locationIds = await assertLocations(deps, actor, input.locationIds);
  const roleIds = await roleIdsByKey(deps, actor, input.roles);
  const pinKey = input.pin ? await ensurePinKey(deps, actor) : null;
  // argon2 is deliberately slow: hash outside the transaction.
  const [passwordHash, pinHash] = await Promise.all([
    input.password ? hashPassword(input.password) : null,
    input.pin ? hashPassword(input.pin) : null,
  ]);
  const email = input.email?.toLowerCase() ?? null;

  const id = await runCommand(deps.db, actor, async (tx, recorder) => {
    const [row] = await tx
      .insert(s.users)
      .values(
        ownedByOrg(actor, {
          displayName: input.displayName,
          email,
          uiLanguage: input.uiLanguage,
          passwordHash,
          pinHash,
          pinLookup: pinKey && input.pin ? pinLookup(pinKey, input.pin) : null,
        }),
      )
      .$returningId();
    const userId = row!.id;
    await tx
      .insert(s.userLocations)
      .values(locationIds.map((locationId) => ownedByOrg(actor, { userId, locationId })));
    await tx
      .insert(s.userRoles)
      .values(roleIds.map((roleId) => ownedByOrg(actor, { userId, roleId, locationId: null })));
    recorder.audit({
      action: 'user.created',
      entityType: 'user',
      entityId: userId,
      locationId: null,
      after: {
        displayName: input.displayName,
        email,
        uiLanguage: input.uiLanguage,
        roles: [...new Set(input.roles)],
        locationIds,
        hasPin: pinHash !== null,
        hasPassword: passwordHash !== null,
      },
    });
    return userId;
  }).catch(userConflict);
  return getUser(deps, actor, id);
}

/**
 * Updates a user; roles and locations are replaced as a whole. `isActive: false` deactivates the
 * user without deleting anything (RF-A12). Nobody deactivates themselves, and the organization
 * always keeps an active administrator.
 */
export async function updateUser(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: z.output<typeof updateUserSchema>,
): Promise<UserDto> {
  assertPermission(actor, 'user.manage');
  const current = await loadUser(deps, actor, id);
  if (input.isActive === false && id === actor.userId) {
    throw new ApiError('CONFLICT', 'You cannot deactivate your own user');
  }
  const locationIds = input.locationIds && (await assertLocations(deps, actor, input.locationIds));
  const roleIds = input.roles && (await roleIdsByKey(deps, actor, input.roles));
  const patch: Partial<UserRow> = {};
  if (input.displayName !== undefined) patch.displayName = input.displayName;
  if (input.email !== undefined) patch.email = input.email?.toLowerCase() ?? null;
  if (input.uiLanguage !== undefined) patch.uiLanguage = input.uiLanguage;
  if (input.isActive !== undefined && input.isActive !== current.isActive) {
    // Back in use: one more person of the plan (DEC-045).
    if (input.isActive) await assertGrowth(deps.db, actor.organizationId, { limit: 'users' });
    patch.isActive = input.isActive;
    patch.deactivatedAt = input.isActive ? null : new Date();
  }

  await runCommand(deps.db, actor, async (tx, recorder) => {
    const guardsAdmin = roleIds !== undefined || patch.isActive === false;
    const adminRoleId = guardsAdmin ? await lockAdminRole(tx, actor) : null;
    const before = await currentLinks(tx, actor, id);
    if (Object.keys(patch).length > 0) {
      await tx
        .update(s.users)
        .set(patch)
        .where(inOrg(s.users, actor, eq(s.users.id, id)));
    }
    if (roleIds) await syncUserRoles(tx, actor, id, roleIds);
    if (locationIds) await syncUserLocations(tx, actor, id, locationIds);
    if (guardsAdmin) await assertAdminRemains(tx, actor, adminRoleId);

    const after = await currentLinks(tx, actor, id);
    const diff = changedFields(
      { ...current, ...before } as unknown as Record<string, unknown>,
      { ...patch, deactivatedAt: undefined, ...after } as Record<string, unknown>,
    );
    if (Object.keys(diff.after).length > 0) {
      recorder.audit({
        action: 'user.changed',
        entityType: 'user',
        entityId: id,
        locationId: null,
        ...diff,
      });
    }
  }).catch(userConflict);
  return getUser(deps, actor, id);
}

/** Sets the POS PIN (RF-A06): argon2 hash plus the lookup that keeps it unique (DEC-015). */
export async function setUserPin(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: z.output<typeof setPinSchema>,
): Promise<void> {
  assertPermission(actor, 'user.manage');
  await loadUser(deps, actor, id);
  const pinKey = await ensurePinKey(deps, actor);
  const pinHash = await hashPassword(input.pin);
  await runCommand(deps.db, actor, async (tx, recorder) => {
    await tx
      .update(s.users)
      .set({
        pinHash,
        pinLookup: pinLookup(pinKey, input.pin),
        failedPinAttempts: 0,
        lockedUntil: null,
      })
      .where(inOrg(s.users, actor, eq(s.users.id, id)));
    recorder.audit({
      action: 'user.pin_changed',
      entityType: 'user',
      entityId: id,
      locationId: null,
    });
  }).catch(userConflict);
}

/** Sets the backoffice password (RF-A07). Setting one's own clears `mustChangePassword`. */
export async function setUserPassword(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: z.output<typeof setPasswordSchema>,
): Promise<void> {
  assertPermission(actor, 'user.manage');
  await loadUser(deps, actor, id);
  const passwordHash = await hashPassword(input.password);
  await runCommand(deps.db, actor, async (tx, recorder) => {
    await tx
      .update(s.users)
      .set(id === actor.userId ? { passwordHash, mustChangePassword: false } : { passwordHash })
      .where(inOrg(s.users, actor, eq(s.users.id, id)));
    recorder.audit({
      action: 'user.password_changed',
      entityType: 'user',
      entityId: id,
      locationId: null,
    });
  });
}

// ── Roles (RF-A04, RF-A05) ──────────────────────────────────────────────────

type RoleRow = typeof s.roles.$inferSelect;

const toRoleDto = (row: RoleRow, permissions: string[]) => ({
  id: row.id,
  key: row.key,
  name: row.name,
  isSystem: row.isSystem,
  permissions,
});
export type RoleDto = ReturnType<typeof toRoleDto>;

async function toRoleDtos(deps: ServiceDeps, actor: Actor, roles: RoleRow[]): Promise<RoleDto[]> {
  if (roles.length === 0) return [];
  const grants = await deps.db
    .select({ roleId: s.rolePermissions.roleId, permission: s.rolePermissions.permission })
    .from(s.rolePermissions)
    .where(
      inOrg(
        s.rolePermissions,
        actor,
        inArray(
          s.rolePermissions.roleId,
          roles.map((role) => role.id),
        ),
        notDeleted(s.rolePermissions),
      ),
    );
  return roles.map((role) => {
    const granted = new Set(grants.filter((g) => g.roleId === role.id).map((g) => g.permission));
    return toRoleDto(
      role,
      PERMISSIONS.filter((permission) => granted.has(permission)),
    );
  });
}

export async function listRoles(deps: ServiceDeps, actor: Actor): Promise<RoleDto[]> {
  assertPermission(actor, 'user.manage');
  const rows = await deps.db
    .select()
    .from(s.roles)
    .where(inOrg(s.roles, actor, notDeleted(s.roles)))
    .orderBy(asc(s.roles.name));
  rows.sort((a, b) => roleOrder(a.key) - roleOrder(b.key));
  return toRoleDtos(deps, actor, rows);
}

/** Replaces the permissions of a role (RF-A05). The admin role always has all of them. */
export async function setRolePermissions(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: z.output<typeof setRolePermissionsSchema>,
): Promise<RoleDto> {
  assertPermission(actor, 'user.manage');
  const [role] = await deps.db
    .select()
    .from(s.roles)
    .where(inOrg(s.roles, actor, eq(s.roles.id, id), notDeleted(s.roles)));
  if (!role) throw notFound('Role');
  if (role.key === 'admin') {
    throw new ApiError('CONFLICT', 'The administrator role always has every permission');
  }
  const desired = PERMISSIONS.filter((permission) => input.permissions.includes(permission));

  await runCommand(deps.db, actor, async (tx, recorder) => {
    const rows = await tx
      .select()
      .from(s.rolePermissions)
      .where(inOrg(s.rolePermissions, actor, eq(s.rolePermissions.roleId, id)));
    const before = PERMISSIONS.filter((p) =>
      rows.some((row) => !row.deletedAt && row.permission === p),
    );
    await syncLinks(
      rows.map((row) => ({ ...row, key: row.permission })),
      desired,
      {
        setDeleted: (ids, deletedAt) =>
          tx
            .update(s.rolePermissions)
            .set({ deletedAt })
            .where(inOrg(s.rolePermissions, actor, inArray(s.rolePermissions.id, ids))),
        insert: (keys) =>
          tx
            .insert(s.rolePermissions)
            .values(keys.map((permission) => ownedByOrg(actor, { roleId: id, permission }))),
      },
    );
    if (before.join() !== desired.join()) {
      recorder.audit({
        action: 'role.permissions_changed',
        entityType: 'role',
        entityId: id,
        locationId: null,
        before: { permissions: before },
        after: { permissions: desired },
      });
    }
  });
  const [dto] = await toRoleDtos(deps, actor, [role]);
  return dto!;
}
