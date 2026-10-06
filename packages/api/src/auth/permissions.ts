import { PERMISSIONS, type Permission } from '@pos/core';
import { type Database, schema as s } from '@pos/db';
import { and, eq, isNull, or } from 'drizzle-orm';

const KNOWN = new Set<string>(PERMISSIONS);

/**
 * Permissions of a user at a location: union of the permissions of every role assigned for that
 * location or for all locations (RF-A04, RF-A05). Inactive users and users who do not work at
 * the location get none.
 */
export async function loadUserPermissions(
  db: Database,
  input: { organizationId: string; userId: string; locationId: string | null },
): Promise<Set<Permission>> {
  const [user] = await db
    .select({ isActive: s.users.isActive, deletedAt: s.users.deletedAt })
    .from(s.users)
    .where(and(eq(s.users.id, input.userId), eq(s.users.organizationId, input.organizationId)));
  if (!user || !user.isActive || user.deletedAt) return new Set();

  if (input.locationId) {
    const [membership] = await db
      .select({ id: s.userLocations.id })
      .from(s.userLocations)
      .where(
        and(
          eq(s.userLocations.organizationId, input.organizationId),
          eq(s.userLocations.userId, input.userId),
          eq(s.userLocations.locationId, input.locationId),
          isNull(s.userLocations.deletedAt),
        ),
      );
    if (!membership) return new Set();
  }

  const rows = await db
    .select({ permission: s.rolePermissions.permission })
    .from(s.userRoles)
    .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
    .innerJoin(s.rolePermissions, eq(s.rolePermissions.roleId, s.roles.id))
    .where(
      and(
        eq(s.userRoles.organizationId, input.organizationId),
        eq(s.userRoles.userId, input.userId),
        isNull(s.userRoles.deletedAt),
        isNull(s.roles.deletedAt),
        isNull(s.rolePermissions.deletedAt),
        input.locationId
          ? or(isNull(s.userRoles.locationId), eq(s.userRoles.locationId, input.locationId))
          : isNull(s.userRoles.locationId),
      ),
    );
  return new Set(rows.map((r) => r.permission).filter((p): p is Permission => KNOWN.has(p)));
}

/** Support staff with an owner's grant act with every permission, and everything is audited. */
export const ALL_PERMISSIONS: ReadonlySet<Permission> = new Set(PERMISSIONS);
