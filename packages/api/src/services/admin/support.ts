import {
  type CreateSupportGrantInput,
  DEFAULT_LOCATION_SETTINGS,
  formatSwissVatUid,
  newId,
  type OnboardOrganizationInput,
} from '@pos/core';
import {
  applyOrganizationTemplate,
  type Database,
  hashPassword,
  inOrg,
  newPinKey,
  notDeleted,
  randomToken,
  runCommand,
  schema as s,
} from '@pos/db';
import { and, asc, count, desc, eq, gt, isNull, like, max, or } from 'drizzle-orm';
import { type Actor, assertPermission, requireUserId } from '../../actor';
import { ApiError, notFound } from '../../errors';
import { iso, type ServiceDeps } from '../shared';
import { commandContext } from './common';

/**
 * DINOLABS support (RF-A10, Flujo 7): support staff create organizations from the platform
 * console, and enter one only while its owner grants them time-limited access. Everything they
 * do is audited.
 */

// ── DTOs ────────────────────────────────────────────────────────────────────

export interface PlatformOrganizationDto {
  id: string;
  name: string;
  slug: string;
  legalName: string | null;
  defaultLanguage: string;
  status: string;
  isTraining: boolean;
  createdAt: string;
  locationsCount: number;
  /** Latest expiry of the grants that let this staff member in; null = no access now. */
  supportGrantExpiresAt: string | null;
}

export interface OnboardingResultDto {
  organizationId: string;
  locationId: string;
  ownerUserId: string;
  ownerEmail: string;
  /** Shown ONCE; the owner must change it at the first sign-in. */
  temporaryPassword: string;
}

export interface SupportGrantDto {
  id: string;
  staffId: string | null;
  staffDisplayName: string | null;
  reason: string | null;
  grantedByUserId: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  active: boolean;
}

// ── Platform console (support staff, no organization) ──────────────────────

async function isActiveStaff(db: Database, staffId: string): Promise<boolean> {
  const [staff] = await db
    .select({ isActive: s.platformStaff.isActive })
    .from(s.platformStaff)
    .where(and(eq(s.platformStaff.id, staffId), isNull(s.platformStaff.deletedAt)));
  return !!staff?.isActive;
}

/** The session's support staff member must exist and be active. */
async function assertActiveStaff(db: Database, staffId: string) {
  if (!(await isActiveStaff(db, staffId))) {
    throw new ApiError('FORBIDDEN', 'Unknown or inactive support staff member');
  }
}

export async function listPlatformOrganizations(
  deps: ServiceDeps,
  staff: { staffId: string },
): Promise<PlatformOrganizationDto[]> {
  await assertActiveStaff(deps.db, staff.staffId);
  const [organizations, locationCounts, grants] = await Promise.all([
    deps.db
      .select()
      .from(s.organizations)
      .where(isNull(s.organizations.deletedAt))
      .orderBy(asc(s.organizations.name)),
    deps.db
      .select({ organizationId: s.locations.organizationId, value: count() })
      .from(s.locations)
      .where(isNull(s.locations.deletedAt))
      .groupBy(s.locations.organizationId),
    deps.db
      .select({
        organizationId: s.supportAccessGrants.organizationId,
        expiresAt: max(s.supportAccessGrants.expiresAt),
      })
      .from(s.supportAccessGrants)
      .where(
        and(
          isNull(s.supportAccessGrants.revokedAt),
          isNull(s.supportAccessGrants.deletedAt),
          gt(s.supportAccessGrants.expiresAt, new Date()),
          or(
            isNull(s.supportAccessGrants.staffId),
            eq(s.supportAccessGrants.staffId, staff.staffId),
          ),
        ),
      )
      .groupBy(s.supportAccessGrants.organizationId),
  ]);
  const locationsOf = new Map(locationCounts.map((row) => [row.organizationId, Number(row.value)]));
  const grantOf = new Map(grants.map((row) => [row.organizationId, row.expiresAt]));
  return organizations.map((org) => ({
    id: org.id,
    name: org.name,
    slug: org.slug,
    legalName: org.legalName,
    defaultLanguage: org.defaultLanguage,
    status: org.status,
    isTraining: org.isTraining,
    createdAt: org.createdAt.toISOString(),
    locationsCount: locationsOf.get(org.id) ?? 0,
    supportGrantExpiresAt: iso(grantOf.get(org.id)),
  }));
}

/** URL-friendly organization slug: `Café Zürich AG` → `cafe-zurich-ag`. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'organization';
}

async function uniqueSlug(db: Database, name: string): Promise<string> {
  const base = slugify(name);
  // The unique index covers soft-deleted organizations too, so they are not filtered out.
  const rows = await db
    .select({ slug: s.organizations.slug })
    .from(s.organizations)
    .where(or(eq(s.organizations.slug, base), like(s.organizations.slug, `${base}-%`)));
  const taken = new Set(rows.map((row) => row.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

/**
 * Onboarding wizard (Flujo 7.1, RF-A01, RF-A02, RF-B13): organization with its PIN key, the first
 * location with the default settings (DEC-004), the template roles and Swiss MWST setup, and the
 * owner as administrator with a temporary password that must be changed at the first sign-in.
 */
export async function onboardOrganization(
  deps: ServiceDeps,
  staff: { staffId: string },
  input: OnboardOrganizationInput,
): Promise<OnboardingResultDto> {
  await assertActiveStaff(deps.db, staff.staffId);
  const ownerEmail = input.owner.email.trim().toLowerCase();
  const [existingUser] = await deps.db
    .select({ id: s.users.id })
    .from(s.users)
    .where(eq(s.users.email, ownerEmail))
    .limit(1);
  if (existingUser) throw new ApiError('CONFLICT', 'A user with this email already exists');

  const organizationId = newId();
  const locationId = newId();
  const ownerUserId = newId();
  const slug = await uniqueSlug(deps.db, input.organization.name);
  const temporaryPassword = randomToken(12);
  const passwordHash = await hashPassword(temporaryPassword);
  const ctx = {
    organizationId,
    locationId: null,
    userId: null,
    supportStaffId: staff.staffId,
    requestId: `support:${staff.staffId}`,
  };

  await runCommand(deps.db, ctx, async (tx, recorder) => {
    await tx.insert(s.organizations).values({
      id: organizationId,
      name: input.organization.name,
      slug,
      legalName: input.organization.legalName,
      defaultLanguage: input.organization.defaultLanguage,
      pinKey: newPinKey(),
    });
    await tx.insert(s.locations).values({
      id: locationId,
      organizationId,
      name: input.location.name,
      legalName: input.location.legalName,
      street: input.location.street,
      postalCode: input.location.postalCode,
      city: input.location.city,
      canton: input.location.canton?.toUpperCase() ?? null,
      vatUid: input.location.vatUid ? formatSwissVatUid(input.location.vatUid) : null,
      defaultLanguage: input.organization.defaultLanguage,
      kitchenLanguage: input.location.kitchenLanguage,
      languages: [...input.location.languages],
      settings: DEFAULT_LOCATION_SETTINGS,
    });
    const { roleIds } = await applyOrganizationTemplate(
      tx,
      organizationId,
      input.organization.defaultLanguage,
    );
    await tx.insert(s.users).values({
      id: ownerUserId,
      organizationId,
      displayName: input.owner.displayName,
      email: ownerEmail,
      passwordHash,
      uiLanguage: input.owner.uiLanguage,
      mustChangePassword: true,
    });
    await tx.insert(s.userLocations).values({ organizationId, userId: ownerUserId, locationId });
    // The owner administers every location of the organization (role without location).
    await tx
      .insert(s.userRoles)
      .values({ organizationId, userId: ownerUserId, roleId: roleIds.admin });
    recorder.audit({
      action: 'organization.created',
      entityType: 'organization',
      entityId: organizationId,
      after: { name: input.organization.name, slug, locationId, ownerUserId },
    });
  });

  return { organizationId, locationId, ownerUserId, ownerEmail, temporaryPassword };
}

// ── Organization side: the owner's grants (RF-A10) ─────────────────────────

const grantColumns = {
  grant: s.supportAccessGrants,
  staffDisplayName: s.platformStaff.displayName,
};

function toGrantDto(
  row: { grant: typeof s.supportAccessGrants.$inferSelect; staffDisplayName: string | null },
  now: Date,
): SupportGrantDto {
  const { grant } = row;
  return {
    id: grant.id,
    staffId: grant.staffId,
    staffDisplayName: row.staffDisplayName,
    reason: grant.reason,
    grantedByUserId: grant.grantedByUserId,
    expiresAt: grant.expiresAt.toISOString(),
    revokedAt: iso(grant.revokedAt),
    createdAt: grant.createdAt.toISOString(),
    active: !grant.revokedAt && grant.expiresAt > now,
  };
}

async function loadGrant(db: Database, actor: Actor, id: string) {
  const [row] = await db
    .select(grantColumns)
    .from(s.supportAccessGrants)
    .leftJoin(s.platformStaff, eq(s.platformStaff.id, s.supportAccessGrants.staffId))
    .where(
      inOrg(
        s.supportAccessGrants,
        actor,
        eq(s.supportAccessGrants.id, id),
        notDeleted(s.supportAccessGrants),
      ),
    );
  if (!row) throw notFound('Support grant');
  return row;
}

export async function listSupportGrants(
  deps: ServiceDeps,
  actor: Actor,
): Promise<SupportGrantDto[]> {
  assertPermission(actor, 'support.grant_access');
  const rows = await deps.db
    .select(grantColumns)
    .from(s.supportAccessGrants)
    .leftJoin(s.platformStaff, eq(s.platformStaff.id, s.supportAccessGrants.staffId))
    .where(inOrg(s.supportAccessGrants, actor, notDeleted(s.supportAccessGrants)))
    .orderBy(desc(s.supportAccessGrants.createdAt), desc(s.supportAccessGrants.id));
  const now = new Date();
  return rows.map((row) => toGrantDto(row, now));
}

/** Only a person of the organization can let support in (never support itself). */
export async function grantSupportAccess(
  deps: ServiceDeps,
  actor: Actor,
  input: CreateSupportGrantInput,
): Promise<SupportGrantDto> {
  assertPermission(actor, 'support.grant_access');
  if (actor.kind !== 'user')
    throw new ApiError('FORBIDDEN', 'Only the owner or an administrator can grant access');
  const userId = requireUserId(actor);
  if (input.staffId && !(await isActiveStaff(deps.db, input.staffId))) {
    throw notFound('Support staff member');
  }

  const id = newId();
  const expiresAt = new Date(Date.now() + input.hours * 3_600_000);
  await runCommand(deps.db, commandContext(actor), async (tx, recorder) => {
    await tx.insert(s.supportAccessGrants).values({
      id,
      organizationId: actor.organizationId,
      grantedByUserId: userId,
      staffId: input.staffId,
      reason: input.reason,
      expiresAt,
    });
    recorder.audit({
      action: 'support.access_granted',
      entityType: 'support_grant',
      entityId: id,
      reason: input.reason,
      after: { staffId: input.staffId, hours: input.hours, expiresAt: expiresAt.toISOString() },
      locationId: null,
    });
  });
  return toGrantDto(await loadGrant(deps.db, actor, id), new Date());
}

/** Ends the access immediately; revoking an already revoked grant changes nothing. */
export async function revokeSupportGrant(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
): Promise<void> {
  assertPermission(actor, 'support.grant_access');
  if (actor.kind !== 'user')
    throw new ApiError('FORBIDDEN', 'Only the owner or an administrator can revoke access');
  const { grant } = await loadGrant(deps.db, actor, id);
  if (grant.revokedAt) return;
  const revokedAt = new Date();
  await runCommand(deps.db, commandContext(actor), async (tx, recorder) => {
    await tx
      .update(s.supportAccessGrants)
      .set({ revokedAt })
      .where(inOrg(s.supportAccessGrants, actor, eq(s.supportAccessGrants.id, id)));
    recorder.audit({
      action: 'support.access_revoked',
      entityType: 'support_grant',
      entityId: id,
      before: { revokedAt: null, expiresAt: grant.expiresAt.toISOString() },
      after: { revokedAt: revokedAt.toISOString() },
      locationId: null,
    });
  });
}
