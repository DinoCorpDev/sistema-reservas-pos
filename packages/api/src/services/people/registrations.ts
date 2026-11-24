import {
  type RegistrationStatus,
  STAFF_INVITE_MAX_FAILURES,
  STAFF_INVITE_MAX_USES,
  STAFF_INVITE_TTL_MINUTES,
  type submitRegistrationSchema,
} from '@pos/core';
import {
  hashPassword,
  inLocation,
  normalizePairingCode,
  notDeleted,
  ownedByLocation,
  ownedByOrg,
  pairingCode,
  pinLookup,
  runCommand,
  schema as s,
  sha256Hex,
} from '@pos/db';
import { and, asc, eq, lt, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { type Actor, assertPermission, requireLocationId, requireUserId } from '../../actor';
import { ApiError, notFound } from '../../errors';
import type { ServiceDeps } from '../shared';
import { assertGrowth } from '../platform/plans';
import { ensurePinKey, roleIdsByKey, userConflict } from './users';

/**
 * A new waiter joins from their own phone (DEC-055). The manager shows a QR with a code that lasts
 * an hour; the waiter enters name, PIN and language on `/join`; the manager approves in
 * Personal, and only then the PIN opens the till. The PIN is stored as a hash from the start.
 */

type InviteRow = typeof s.staffInvites.$inferSelect;

export interface StaffInviteDto {
  code: string;
  expiresAt: string;
  maxUses: number;
}

export interface StaffRegistrationDto {
  id: string;
  displayName: string;
  uiLanguage: string;
  status: RegistrationStatus;
  createdAt: string;
}

/** A code for new waiters of the current location: an hour, up to ten people. */
export async function issueStaffInvite(deps: ServiceDeps, actor: Actor): Promise<StaffInviteDto> {
  assertPermission(actor, 'user.manage');
  requireLocationId(actor);
  // Nobody joins a team that is already full (DEC-045): better to know before printing a QR.
  await assertGrowth(deps.db, actor.organizationId, { limit: 'users' });
  const code = pairingCode();
  const expiresAt = new Date(Date.now() + STAFF_INVITE_TTL_MINUTES * 60_000);
  await runCommand(deps.db, actor, async (tx, recorder) => {
    const [row] = await tx
      .insert(s.staffInvites)
      .values(
        ownedByLocation(actor, {
          codeHash: sha256Hex(normalizePairingCode(code)),
          roleKey: 'waiter',
          expiresAt,
          maxUses: STAFF_INVITE_MAX_USES,
          createdByUserId: actor.userId ?? null,
        }),
      )
      .$returningId();
    recorder.audit({
      action: 'user.invite_issued',
      entityType: 'staff_invite',
      entityId: row!.id,
      after: { expiresAt: expiresAt.toISOString(), maxUses: STAFF_INVITE_MAX_USES },
    });
  });
  return { code, expiresAt: expiresAt.toISOString(), maxUses: STAFF_INVITE_MAX_USES };
}

const invalidCode = () =>
  new ApiError('NOT_FOUND', 'This code is not valid any more; ask for a new one', {
    reason: 'invalid_code',
  });

const usable = (invite: InviteRow | undefined): invite is InviteRow =>
  !!invite &&
  invite.expiresAt > new Date() &&
  invite.failedAttempts < STAFF_INVITE_MAX_FAILURES &&
  invite.uses < invite.maxUses;

/**
 * The public form of `/join` (anonymous: the code is the credential). A PIN somebody of the
 * organization already has, or waits for, is refused with "choose another" and counts as a
 * failed attempt: five of them kill the code, so PINs cannot be probed through it.
 */
export async function submitStaffRegistration(
  deps: ServiceDeps,
  input: z.output<typeof submitRegistrationSchema>,
): Promise<{ id: string; locationName: string }> {
  const [invite] = await deps.db
    .select()
    .from(s.staffInvites)
    .where(
      and(
        eq(s.staffInvites.codeHash, sha256Hex(normalizePairingCode(input.code))),
        notDeleted(s.staffInvites),
      ),
    );
  if (!usable(invite)) throw invalidCode();
  const tenant = { organizationId: invite.organizationId, locationId: invite.locationId };

  const lookup = pinLookup(await ensurePinKey(deps, tenant), input.pin);
  const [user] = await deps.db
    .select({ id: s.users.id })
    .from(s.users)
    .where(and(eq(s.users.organizationId, tenant.organizationId), eq(s.users.pinLookup, lookup)))
    .limit(1);
  const [waiting] = await deps.db
    .select({ id: s.staffRegistrations.id })
    .from(s.staffRegistrations)
    .where(
      and(
        eq(s.staffRegistrations.organizationId, tenant.organizationId),
        eq(s.staffRegistrations.pinLookup, lookup),
        eq(s.staffRegistrations.status, 'pending'),
        notDeleted(s.staffRegistrations),
      ),
    )
    .limit(1);
  if (user || waiting) {
    await deps.db
      .update(s.staffInvites)
      .set({ failedAttempts: sql`${s.staffInvites.failedAttempts} + 1` })
      .where(eq(s.staffInvites.id, invite.id));
    throw new ApiError('CONFLICT', 'This PIN is taken; choose another', {
      field: 'pin',
      reason: 'pin_taken',
      attemptsLeft: Math.max(0, STAFF_INVITE_MAX_FAILURES - invite.failedAttempts - 1),
    });
  }

  // argon2 is deliberately slow: hash outside the transaction.
  const pinHash = await hashPassword(input.pin);
  const id = await runCommand(deps.db, tenant, async (tx, recorder) => {
    // One use more, only while there are uses left (two phones at the same second).
    const [taken] = await tx
      .update(s.staffInvites)
      .set({ uses: sql`${s.staffInvites.uses} + 1` })
      .where(and(eq(s.staffInvites.id, invite.id), lt(s.staffInvites.uses, invite.maxUses)));
    if (taken.affectedRows !== 1) throw invalidCode();
    const [row] = await tx
      .insert(s.staffRegistrations)
      .values(
        ownedByLocation(tenant, {
          inviteId: invite.id,
          displayName: input.displayName,
          uiLanguage: input.uiLanguage,
          pinHash,
          pinLookup: lookup,
        }),
      )
      .$returningId();
    recorder.audit({
      action: 'user.registration_submitted',
      entityType: 'staff_registration',
      entityId: row!.id,
      after: { displayName: input.displayName, uiLanguage: input.uiLanguage },
    });
    return row!.id;
  });
  const [location] = await deps.db
    .select({ name: s.locations.name })
    .from(s.locations)
    .where(eq(s.locations.id, tenant.locationId));
  return { id, locationName: location?.name ?? '' };
}

/** People who joined and wait for the manager at the current location, oldest first. */
export async function listStaffRegistrations(
  deps: ServiceDeps,
  actor: Actor,
): Promise<StaffRegistrationDto[]> {
  assertPermission(actor, 'user.manage');
  requireLocationId(actor);
  const rows = await deps.db
    .select()
    .from(s.staffRegistrations)
    .where(
      inLocation(
        s.staffRegistrations,
        actor,
        eq(s.staffRegistrations.status, 'pending'),
        notDeleted(s.staffRegistrations),
      ),
    )
    .orderBy(asc(s.staffRegistrations.createdAt));
  return rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    uiLanguage: row.uiLanguage,
    status: row.status as RegistrationStatus,
    createdAt: row.createdAt.toISOString(),
  }));
}

async function pendingRegistration(deps: ServiceDeps, actor: Actor, id: string) {
  const [row] = await deps.db
    .select({
      registration: s.staffRegistrations,
      roleKey: s.staffInvites.roleKey,
    })
    .from(s.staffRegistrations)
    .innerJoin(s.staffInvites, eq(s.staffInvites.id, s.staffRegistrations.inviteId))
    .where(
      inLocation(
        s.staffRegistrations,
        actor,
        eq(s.staffRegistrations.id, id),
        notDeleted(s.staffRegistrations),
      ),
    );
  if (!row) throw notFound('Registration');
  if (row.registration.status !== 'pending') {
    throw new ApiError('CONFLICT', 'This registration was already decided', {
      reason: 'already_decided',
    });
  }
  return row;
}

/**
 * The manager lets the person in: a user with the waiter role at the location and the PIN they
 * chose. A PIN somebody took meanwhile is refused (409 `field: pin`): reject and invite again.
 */
export async function approveStaffRegistration(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
): Promise<{ userId: string }> {
  assertPermission(actor, 'user.manage');
  const decidedBy = requireUserId(actor);
  await assertGrowth(deps.db, actor.organizationId, { limit: 'users' });
  const { registration, roleKey } = await pendingRegistration(deps, actor, id);
  const roleIds = await roleIdsByKey(deps, actor, [roleKey as 'waiter']);
  const userId = await runCommand(deps.db, actor, async (tx, recorder) => {
    const [row] = await tx
      .insert(s.users)
      .values(
        ownedByOrg(actor, {
          displayName: registration.displayName,
          email: null,
          uiLanguage: registration.uiLanguage,
          passwordHash: null,
          pinHash: registration.pinHash,
          pinLookup: registration.pinLookup,
        }),
      )
      .$returningId();
    const created = row!.id;
    await tx
      .insert(s.userLocations)
      .values(ownedByOrg(actor, { userId: created, locationId: registration.locationId }));
    await tx
      .insert(s.userRoles)
      .values(
        roleIds.map((roleId) => ownedByOrg(actor, { userId: created, roleId, locationId: null })),
      );
    const decided = await tx
      .update(s.staffRegistrations)
      .set({
        status: 'approved',
        decidedByUserId: decidedBy,
        decidedAt: new Date(),
        userId: created,
      })
      .where(and(eq(s.staffRegistrations.id, id), eq(s.staffRegistrations.status, 'pending')));
    if (decided[0].affectedRows !== 1) {
      throw new ApiError('CONFLICT', 'This registration was already decided', {
        reason: 'already_decided',
      });
    }
    recorder.audit({
      action: 'user.created',
      entityType: 'user',
      entityId: created,
      locationId: null,
      after: {
        displayName: registration.displayName,
        uiLanguage: registration.uiLanguage,
        roles: [roleKey],
        locationIds: [registration.locationId],
        hasPin: true,
        hasPassword: false,
        source: 'registration',
      },
    });
    recorder.audit({
      action: 'user.registration_approved',
      entityType: 'staff_registration',
      entityId: id,
      before: { status: 'pending' },
      after: { status: 'approved', userId: created },
    });
    return created;
  }).catch(userConflict);
  return { userId };
}

/** The manager does not let the person in; nothing is deleted (PA-06). */
export async function rejectStaffRegistration(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
): Promise<void> {
  assertPermission(actor, 'user.manage');
  const decidedBy = requireUserId(actor);
  await pendingRegistration(deps, actor, id);
  await runCommand(deps.db, actor, async (tx, recorder) => {
    await tx
      .update(s.staffRegistrations)
      .set({ status: 'rejected', decidedByUserId: decidedBy, decidedAt: new Date() })
      .where(and(eq(s.staffRegistrations.id, id), eq(s.staffRegistrations.status, 'pending')));
    recorder.audit({
      action: 'user.registration_rejected',
      entityType: 'staff_registration',
      entityId: id,
      before: { status: 'pending' },
      after: { status: 'rejected' },
    });
  });
}
