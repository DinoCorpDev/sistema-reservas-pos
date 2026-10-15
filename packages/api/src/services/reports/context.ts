import { parseLocationSettings } from '@pos/core';
import { schema as s } from '@pos/db';
import { and, eq } from 'drizzle-orm';
import { type Actor, assertPermission, requireLocationId } from '../../actor';
import { ApiError } from '../../errors';
import type { ServiceDeps } from '../shared';

export type Db = ServiceDeps['db'];
export type Tenant = { organizationId: string; locationId: string };

/** The location a report is about, its time zone and business day start (DEC-022). */
export async function reportContext(deps: ServiceDeps, actor: Actor) {
  assertPermission(actor, 'report.view');
  const tenant: Tenant = {
    organizationId: actor.organizationId,
    locationId: requireLocationId(actor),
  };
  const [location] = await deps.db
    .select({ timezone: s.locations.timezone, settings: s.locations.settings })
    .from(s.locations)
    .where(
      and(
        eq(s.locations.id, tenant.locationId),
        eq(s.locations.organizationId, tenant.organizationId),
      ),
    );
  if (!location) throw new ApiError('NOT_FOUND', 'Location not found');
  return {
    db: deps.db,
    tenant,
    timezone: location.timezone,
    settings: parseLocationSettings(location.settings),
  };
}

export type ReportContext = Awaited<ReturnType<typeof reportContext>>;

/** Names of the people of the organization, by id (reports show names, exports too). */
export async function userNames(db: Db, tenant: Tenant): Promise<Record<string, string>> {
  const users = await db
    .select({ id: s.users.id, name: s.users.displayName })
    .from(s.users)
    .where(eq(s.users.organizationId, tenant.organizationId));
  return Object.fromEntries(users.map((user) => [user.id, user.name]));
}

/** Splits a long id list so an `IN (…)` stays small. */
export function chunks<T>(items: readonly T[], size = 1000): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}
