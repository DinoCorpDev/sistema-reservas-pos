import { PERMISSIONS, type Permission, type pairTerminalSchema } from '@pos/core';
import {
  inLocation,
  inOrg,
  normalizePairingCode,
  notDeleted,
  ownedByLocation,
  pairingCode,
  pinLookup,
  randomToken,
  runCommand,
  schema as s,
  sha256Hex,
  type Transaction,
  verifyPassword,
} from '@pos/db';
import { and, eq, isNull, like, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { type Actor, assertPermission, requireLocationId, requireTerminal } from '../../actor';
import { loadUserPermissions } from '../../auth/permissions';
import { ApiError, isDuplicateKey } from '../../errors';
import type { ServiceDeps } from '../shared';
import { toPairedDto, unknownCode } from './devices';

/**
 * Waiters' own phones (DEC-036). The cashier POS or the backoffice shows a short-lived code (as a
 * QR); the waiter opens it on their phone and enters their PIN. The phone becomes theirs: one
 * `phone` terminal per waiter and location, created at the first pairing and reused afterwards,
 * with its own offline order-number prefix (T1, T2…, RN-16). Pairing another phone replaces the
 * previous one. Signing out of the phone unpairs it at once.
 */

export const PHONE_CODE_TTL_MINUTES = 5;
/** Wrong PINs that kill a phone code: the code is shared, the PIN is what proves the waiter. */
export const PHONE_CODE_MAX_FAILURES = 5;
const PHONE_PREFIX = 'T';
const MAX_PHONE_NUMBER = 999;

type PhoneCodeRow = typeof s.phonePairingCodes.$inferSelect;
type Tenant = { organizationId: string; locationId: string };

/**
 * A code for waiters' phones, valid 5 minutes for any number of phones. Only the cashier POS
 * (a fixed device on site) or someone who manages the location in the backoffice issues one.
 */
export async function issuePhonePairingCode(
  deps: ServiceDeps,
  actor: Actor,
): Promise<{ code: string; expiresAt: string }> {
  if (actor.kind === 'terminal') {
    if (actor.terminalType !== 'pos') {
      throw new ApiError('FORBIDDEN', 'Only the cashier POS shows codes for waiter phones');
    }
  } else {
    assertPermission(actor, 'location.manage');
  }
  requireLocationId(actor);
  const code = pairingCode();
  const expiresAt = new Date(Date.now() + PHONE_CODE_TTL_MINUTES * 60_000);
  await runCommand(deps.db, actor, async (tx, recorder) => {
    const [row] = await tx
      .insert(s.phonePairingCodes)
      .values(
        ownedByLocation(actor, {
          codeHash: sha256Hex(normalizePairingCode(code)),
          expiresAt,
          issuedByTerminalId: actor.kind === 'terminal' ? (actor.terminalId ?? null) : null,
          issuedByUserId: actor.kind === 'terminal' ? null : (actor.userId ?? null),
        }),
      )
      .$returningId();
    recorder.audit({
      action: 'terminal.phone_code_issued',
      entityType: 'phone_pairing_code',
      entityId: row!.id,
      after: { expiresAt: expiresAt.toISOString() },
    });
  });
  return { code, expiresAt: expiresAt.toISOString() };
}

/** The valid phone code with this hash, or null (anonymous lookup: the code is the credential). */
export async function findPhoneCode(
  deps: ServiceDeps,
  codeHash: string,
): Promise<PhoneCodeRow | null> {
  const [row] = await deps.db
    .select()
    .from(s.phonePairingCodes)
    .where(and(eq(s.phonePairingCodes.codeHash, codeHash), notDeleted(s.phonePairingCodes)));
  if (!row || row.expiresAt <= new Date() || row.failedAttempts >= PHONE_CODE_MAX_FAILURES) {
    return null;
  }
  return row;
}

type WaiterMatch =
  | { kind: 'ok'; user: typeof s.users.$inferSelect; permissions: Set<Permission> }
  | { kind: 'wrong' }
  | { kind: 'not_waiter' };

/** The active waiter of the location with this PIN (DEC-015: the lookup finds, argon2 confirms). */
async function waiterByPin(deps: ServiceDeps, tenant: Tenant, pin: string): Promise<WaiterMatch> {
  const [org] = await deps.db
    .select({ pinKey: s.organizations.pinKey })
    .from(s.organizations)
    .where(eq(s.organizations.id, tenant.organizationId));
  const [user] = org?.pinKey
    ? await deps.db
        .select()
        .from(s.users)
        .where(
          inOrg(
            s.users,
            tenant,
            eq(s.users.pinLookup, pinLookup(org.pinKey, pin)),
            notDeleted(s.users),
          ),
        )
    : [];
  if (!user?.pinHash || !(await verifyPassword(user.pinHash, pin))) return { kind: 'wrong' };
  // Inactive or working elsewhere: no permissions here, the same as a wrong PIN.
  const permissions = await loadUserPermissions(deps.db, { ...tenant, userId: user.id });
  if (permissions.size === 0) return { kind: 'wrong' };
  const [waiter] = await deps.db
    .select({ id: s.userRoles.id })
    .from(s.userRoles)
    .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
    .where(
      inOrg(
        s.userRoles,
        tenant,
        eq(s.userRoles.userId, user.id),
        eq(s.roles.key, 'waiter'),
        notDeleted(s.userRoles),
        notDeleted(s.roles),
        or(isNull(s.userRoles.locationId), eq(s.userRoles.locationId, tenant.locationId)),
      ),
    )
    .limit(1);
  return waiter ? { kind: 'ok', user, permissions } : { kind: 'not_waiter' };
}

/** Next free phone prefix of the location: T1, T2… Prefixes are never reused (RN-16). */
async function nextPhonePrefix(tx: Transaction, tenant: Tenant): Promise<string> {
  const rows = await tx
    .select({ prefix: s.terminals.orderNumberPrefix })
    .from(s.terminals)
    .where(
      inLocation(s.terminals, tenant, like(s.terminals.orderNumberPrefix, `${PHONE_PREFIX}%`)),
    );
  const highest = rows.reduce((max, row) => {
    const match = /^T(\d{1,3})$/.exec(row.prefix);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  if (highest >= MAX_PHONE_NUMBER) {
    throw new ApiError('CONFLICT', 'No free order-number prefix left for waiter phones');
  }
  return `${PHONE_PREFIX}${highest + 1}`;
}

/**
 * Pairs a waiter's phone: the phone code plus the waiter's PIN. Wrong PINs and PINs of someone
 * who is not a waiter count against the code. Returns the device token once and the waiter, so
 * the phone opens without asking for the PIN again.
 */
export async function pairPhone(
  deps: ServiceDeps,
  code: PhoneCodeRow,
  input: z.output<typeof pairTerminalSchema>,
  requestId: string | null,
) {
  if (!input.pin) {
    throw new ApiError('BAD_REQUEST', 'This code pairs a waiter phone: send the waiter PIN too', {
      reason: 'pin_required',
    });
  }
  const tenant: Tenant = { organizationId: code.organizationId, locationId: code.locationId };
  const [location] = await deps.db
    .select()
    .from(s.locations)
    .where(
      inOrg(s.locations, tenant, eq(s.locations.id, tenant.locationId), notDeleted(s.locations)),
    );
  if (!location) throw unknownCode();

  const match = await waiterByPin(deps, tenant, input.pin);
  if (match.kind !== 'ok') {
    await runCommand(deps.db, { ...tenant, requestId }, async (tx, recorder) => {
      await tx
        .update(s.phonePairingCodes)
        .set({ failedAttempts: sql`${s.phonePairingCodes.failedAttempts} + 1` })
        .where(inLocation(s.phonePairingCodes, tenant, eq(s.phonePairingCodes.id, code.id)));
      recorder.audit({
        action: 'terminal.phone_pairing_failed',
        entityType: 'phone_pairing_code',
        entityId: code.id,
        after: { reason: match.kind },
      });
    });
    if (match.kind === 'not_waiter') {
      throw new ApiError('FORBIDDEN', 'Only waiters pair their own phone', {
        reason: 'not_waiter',
      });
    }
    throw new ApiError('UNAUTHENTICATED', 'Wrong PIN', {
      reason: 'wrong_pin',
      attemptsLeft: Math.max(0, PHONE_CODE_MAX_FAILURES - code.failedAttempts - 1),
    });
  }

  const { user, permissions } = match;
  const deviceToken = randomToken(32);
  const now = new Date();
  const fields = {
    name: user.displayName,
    deviceTokenHash: sha256Hex(deviceToken),
    pairedAt: now,
    lastSeenAt: now,
  };
  let terminalId: string | null = null;
  // Two waiters pairing at the same moment may compute the same new prefix: try again.
  for (let attempt = 0; terminalId === null; attempt += 1) {
    try {
      terminalId = await runCommand(
        deps.db,
        { ...tenant, userId: user.id, requestId },
        async (tx, recorder) => {
          const [current] = await tx
            .select()
            .from(s.terminals)
            .where(inLocation(s.terminals, tenant, eq(s.terminals.userId, user.id)))
            .for('update');
          if (current && !current.isActive) {
            throw new ApiError('FORBIDDEN', 'This waiter phone was deactivated in the backoffice', {
              reason: 'phone_deactivated',
            });
          }
          let id: string;
          if (current) {
            id = current.id;
            await tx
              .update(s.terminals)
              .set({ ...fields, appVersion: input.appVersion ?? current.appVersion })
              .where(inLocation(s.terminals, tenant, eq(s.terminals.id, id)));
          } else {
            const orderNumberPrefix = await nextPhonePrefix(tx, tenant);
            const [row] = await tx
              .insert(s.terminals)
              .values({
                ...tenant,
                ...fields,
                type: 'phone',
                orderNumberPrefix,
                userId: user.id,
                appVersion: input.appVersion ?? null,
              })
              .$returningId();
            id = row!.id;
            recorder.audit({
              action: 'terminal.created',
              entityType: 'terminal',
              entityId: id,
              after: { type: 'phone', orderNumberPrefix, userId: user.id },
            });
          }
          recorder.audit({
            action: 'terminal.phone_paired',
            entityType: 'terminal',
            entityId: id,
            after: { appVersion: input.appVersion ?? null },
          });
          return id;
        },
      );
    } catch (error) {
      if (isDuplicateKey(error) && attempt < 3) continue;
      throw error;
    }
  }

  const [paired] = await deps.db
    .select()
    .from(s.terminals)
    .where(inLocation(s.terminals, tenant, eq(s.terminals.id, terminalId)));
  return {
    ...toPairedDto(deviceToken, paired!, location),
    user: {
      id: user.id,
      displayName: user.displayName,
      uiLanguage: user.uiLanguage,
      permissions: PERMISSIONS.filter((permission) => permissions.has(permission)),
    },
  };
}

/**
 * "Sign out" on a waiter's phone: the phone unpairs itself and its token stops working at once.
 * The terminal stays active for the next shift. The phone only calls this once everything it did
 * reached the cloud (DEC-036).
 */
export async function logoutPhone(deps: ServiceDeps, actor: Actor): Promise<void> {
  const { terminalId } = requireTerminal(actor);
  if (actor.terminalType !== 'phone') {
    throw new ApiError(
      'FORBIDDEN',
      'Only a waiter phone signs out by itself; other devices are unpaired in the backoffice',
    );
  }
  await runCommand(deps.db, actor, async (tx, recorder) => {
    await tx
      .update(s.terminals)
      .set({ deviceTokenHash: null })
      .where(inLocation(s.terminals, actor, eq(s.terminals.id, terminalId)));
    recorder.audit({
      action: 'terminal.phone_logged_out',
      entityType: 'terminal',
      entityId: terminalId,
    });
  });
}
