import { and, eq, isNull, type SQL } from 'drizzle-orm';
import type { MySqlColumn } from 'drizzle-orm/mysql-core';

/**
 * Who is acting and for which tenant (PA-09, RNF-12). Every repository function and every command
 * receives it; there is no data access without an organization.
 */
export interface TenantContext {
  organizationId: string;
  /** Required for location-scoped data (configuration and operations). */
  locationId?: string | null;
  userId?: string | null;
  terminalId?: string | null;
  /** Manager who approved a sensitive action with their PIN (RF-A05). */
  authorizedByUserId?: string | null;
  /** Support staff member acting inside the organization (RF-A10). */
  supportStaffId?: string | null;
  requestId?: string | null;
  /** Device clock of the change, when it comes from a terminal (events and audit). */
  occurredAt?: Date;
}

export class TenantError extends Error {
  override readonly name = 'TenantError';
}

export function requireLocation(ctx: TenantContext): string {
  if (!ctx.locationId) {
    throw new TenantError('This operation needs a location in the tenant context');
  }
  return ctx.locationId;
}

type OrgTable = { organizationId: MySqlColumn };
type LocTable = OrgTable & { locationId: MySqlColumn };
type SoftDeleteTable = { deletedAt: MySqlColumn };

/** WHERE organization_id = ctx.organizationId [AND …conditions]. */
export function inOrg(table: OrgTable, ctx: TenantContext, ...conditions: (SQL | undefined)[]) {
  return and(eq(table.organizationId, ctx.organizationId), ...conditions)!;
}

/** WHERE organization_id = … AND location_id = ctx.locationId [AND …conditions]. */
export function inLocation(
  table: LocTable,
  ctx: TenantContext,
  ...conditions: (SQL | undefined)[]
) {
  return and(
    eq(table.organizationId, ctx.organizationId),
    eq(table.locationId, requireLocation(ctx)),
    ...conditions,
  )!;
}

/** Excludes soft-deleted rows (PA-06: nothing is deleted, rows are only marked). */
export function notDeleted(table: SoftDeleteTable) {
  return isNull(table.deletedAt);
}

/**
 * Stamps the tenant onto rows to insert, overriding whatever the caller sent: a request can never
 * write into another organization or location.
 */
export function ownedByOrg<T extends object>(ctx: TenantContext, values: T) {
  return { ...values, organizationId: ctx.organizationId };
}

export function ownedByLocation<T extends object>(ctx: TenantContext, values: T) {
  return { ...values, organizationId: ctx.organizationId, locationId: requireLocation(ctx) };
}
