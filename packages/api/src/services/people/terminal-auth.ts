import {
  type approvalRequestSchema,
  type LocationSettings,
  parseLocationSettings,
  PERMISSIONS,
  type Permission,
  type unlockSchema,
} from '@pos/core';
import {
  type CommandRecorder,
  inOrg,
  notDeleted,
  pinLookup,
  runCommand,
  schema as s,
  type TenantContext,
  type Transaction,
  verifyPassword,
} from '@pos/db';
import { desc, eq, gte, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import type { z } from 'zod';
import type { Actor } from '../../actor';
import { loadUserPermissions } from '../../auth/permissions';
import { resolveTerminal } from '../../auth/resolve-actor';
import {
  APPROVAL_TTL_SECONDS,
  POS_SESSION_TTL_SECONDS,
  signApproval,
  signPosSession,
} from '../../auth/tokens';
import { ApiError, notFound } from '../../errors';
import type { ServiceDeps } from '../shared';
import type { TerminalRow } from './devices';

/** A paired device calling without a user (unlock, offline credentials). */
export interface DeviceContext {
  /** `X-Terminal-Token` header. */
  deviceToken: string | null;
  requestId: string | null;
}

type UserRow = typeof s.users.$inferSelect;

async function deviceTerminal(deps: ServiceDeps, device: DeviceContext): Promise<TerminalRow> {
  if (!device.deviceToken) {
    throw new ApiError(
      'UNAUTHENTICATED',
      'This call needs the X-Terminal-Token header of a paired terminal',
    );
  }
  return resolveTerminal(deps.db, device.deviceToken);
}

async function pinKeyOf(deps: ServiceDeps, organizationId: string): Promise<string | null> {
  const [org] = await deps.db
    .select({ pinKey: s.organizations.pinKey })
    .from(s.organizations)
    .where(eq(s.organizations.id, organizationId));
  return org?.pinKey ?? null;
}

// ── PIN lockout per terminal (RNF-10) ───────────────────────────────────────

/** Audit actions that prove a correct PIN on the terminal and reset its failure count. */
const PIN_SUCCESS_ACTIONS = ['terminal.unlocked', 'approval.granted'];

/**
 * Lock state from the audit log, so it is shared by every API instance: the failed PINs on this
 * terminal since its last successful PIN, within the last `pinLockMinutes`. Reaching
 * `maxPinAttempts` locks the terminal until the oldest of those failures leaves the window.
 */
async function pinLockState(
  tx: Transaction,
  terminal: TerminalRow,
  security: LocationSettings['security'],
) {
  const windowMs = security.pinLockMinutes * 60_000;
  const rows = await tx
    .select({ action: s.auditEvents.action, occurredAt: s.auditEvents.occurredAt })
    .from(s.auditEvents)
    .where(
      inOrg(
        s.auditEvents,
        terminal,
        eq(s.auditEvents.terminalId, terminal.id),
        gte(s.auditEvents.occurredAt, new Date(Date.now() - windowMs)),
        inArray(s.auditEvents.action, ['terminal.pin_failed', ...PIN_SUCCESS_ACTIONS]),
      ),
    )
    .orderBy(desc(s.auditEvents.occurredAt))
    .limit(security.maxPinAttempts);
  const firstSuccess = rows.findIndex((row) => row.action !== 'terminal.pin_failed');
  const failures = firstSuccess === -1 ? rows.length : firstSuccess;
  if (failures < security.maxPinAttempts) return { locked: false as const, failures };
  const unlocksAt = rows[security.maxPinAttempts - 1]!.occurredAt.getTime() + windowMs;
  return {
    locked: true as const,
    retryAfterSeconds: Math.max(1, Math.ceil((unlocksAt - Date.now()) / 1000)),
  };
}

interface PinMatch {
  user: UserRow;
  /** The user's permissions at the terminal's location. */
  permissions: Set<Permission>;
}

/**
 * Identifies a user by PIN alone at a terminal (DEC-015): `pin_lookup` finds the candidate, then
 * ONE argon2 verification confirms it, well within the 3 s of RF-A06. The user must be active and
 * work at the terminal's location. Attempts on the same terminal are serialized with a row lock,
 * so the lockout count is exact across API instances; every failure is audited
 * (`terminal.pin_failed`), and a locked terminal answers 423 without checking the PIN.
 */
async function verifyPinAtTerminal<T>(
  deps: ServiceDeps,
  terminal: TerminalRow,
  pin: string,
  context: (candidate: UserRow | null) => TenantContext,
  onSuccess: (tx: Transaction, recorder: CommandRecorder, match: PinMatch) => Promise<T>,
): Promise<T> {
  const [location] = await deps.db
    .select({ settings: s.locations.settings })
    .from(s.locations)
    .where(inOrg(s.locations, terminal, eq(s.locations.id, terminal.locationId)));
  const { security } = parseLocationSettings(location?.settings);

  const pinKey = await pinKeyOf(deps, terminal.organizationId);
  const [found] = pinKey
    ? await deps.db
        .select()
        .from(s.users)
        .where(
          inOrg(
            s.users,
            terminal,
            eq(s.users.pinLookup, pinLookup(pinKey, pin)),
            notDeleted(s.users),
          ),
        )
    : [];
  // Inactive users and users of other locations get no permissions here, so they cannot unlock.
  const permissions = found
    ? await loadUserPermissions(deps.db, {
        organizationId: terminal.organizationId,
        userId: found.id,
        locationId: terminal.locationId,
      })
    : new Set<Permission>();
  const candidate = found?.pinHash && permissions.size > 0 ? found : null;

  const outcome = await runCommand(deps.db, context(candidate), async (tx, recorder) => {
    await tx
      .select({ id: s.terminals.id })
      .from(s.terminals)
      .where(eq(s.terminals.id, terminal.id))
      .for('update');
    const lock = await pinLockState(tx, terminal, security);
    if (lock.locked) return { kind: 'locked' as const, retryAfterSeconds: lock.retryAfterSeconds };
    if (!candidate || !(await verifyPassword(candidate.pinHash!, pin))) {
      recorder.audit({
        action: 'terminal.pin_failed',
        entityType: 'terminal',
        entityId: terminal.id,
      });
      return { kind: 'failed' as const, attemptsLeft: security.maxPinAttempts - lock.failures - 1 };
    }
    return {
      kind: 'ok' as const,
      value: await onSuccess(tx, recorder, { user: candidate, permissions }),
    };
  });

  if (outcome.kind === 'locked') {
    throw new ApiError('LOCKED', 'Too many wrong PINs on this terminal; try again later', {
      retryAfterSeconds: outcome.retryAfterSeconds,
    });
  }
  if (outcome.kind === 'failed') {
    throw new ApiError('UNAUTHENTICATED', 'Wrong PIN', { attemptsLeft: outcome.attemptsLeft });
  }
  return outcome.value;
}

const sortedPermissions = (permissions: ReadonlySet<Permission>) =>
  PERMISSIONS.filter((permission) => permissions.has(permission));

// ── Unlock (RF-A06) ─────────────────────────────────────────────────────────

export interface UnlockResult {
  token: string;
  expiresAt: string;
  user: { id: string; displayName: string; uiLanguage: string; permissions: Permission[] };
}

/** PIN unlock of a paired terminal: a POS session for the user at the terminal's location. */
export async function unlockTerminal(
  deps: ServiceDeps,
  device: DeviceContext,
  input: z.output<typeof unlockSchema>,
): Promise<UnlockResult> {
  const terminal = await deviceTerminal(deps, device);
  const tenant = {
    organizationId: terminal.organizationId,
    locationId: terminal.locationId,
    terminalId: terminal.id,
    requestId: device.requestId,
  };
  return verifyPinAtTerminal(
    deps,
    terminal,
    input.pin,
    (candidate) => ({ ...tenant, userId: candidate?.id ?? null }),
    async (tx, recorder, { user, permissions }) => {
      // A waiter's own phone opens only with its owner's PIN (DEC-036).
      if (terminal.type === 'phone' && user.id !== terminal.userId) {
        throw new ApiError('FORBIDDEN', 'This phone belongs to another waiter', {
          reason: 'not_owner',
        });
      }
      const now = new Date();
      await tx
        .update(s.users)
        .set({ lastLoginAt: now })
        .where(inOrg(s.users, terminal, eq(s.users.id, user.id)));
      await tx
        .update(s.terminals)
        .set({ lastSeenAt: now })
        .where(inOrg(s.terminals, terminal, eq(s.terminals.id, terminal.id)));
      recorder.audit({
        action: 'terminal.unlocked',
        entityType: 'terminal',
        entityId: terminal.id,
      });
      const token = await signPosSession({
        userId: user.id,
        organizationId: terminal.organizationId,
        locationId: terminal.locationId,
        terminalId: terminal.id,
      });
      return {
        token,
        expiresAt: new Date(now.getTime() + POS_SESSION_TTL_SECONDS * 1000).toISOString(),
        user: {
          id: user.id,
          displayName: user.displayName,
          uiLanguage: user.uiLanguage,
          permissions: sortedPermissions(permissions),
        },
      };
    },
  );
}

// ── Manager approval (RF-A05, RN-15) ────────────────────────────────────────

export interface ApprovalResult {
  approvalToken: string;
  expiresAt: string;
  approver: { id: string; displayName: string };
}

/**
 * A manager authorizes ONE action on the same device with their PIN (same lockout count as the
 * unlock). The approver needs every requested permission at this location; the token is then
 * sent as `X-Approval` with the action itself.
 */
export async function approveAction(
  deps: ServiceDeps,
  actor: Actor,
  input: z.output<typeof approvalRequestSchema>,
): Promise<ApprovalResult> {
  if (actor.kind !== 'user' || !actor.terminalId || !actor.userId) {
    throw new ApiError('FORBIDDEN', 'Approvals are given on a paired terminal with a POS session');
  }
  const [terminal] = await deps.db
    .select()
    .from(s.terminals)
    .where(
      inOrg(s.terminals, actor, eq(s.terminals.id, actor.terminalId), notDeleted(s.terminals)),
    );
  if (!terminal) throw notFound('Terminal');
  const permissions = [...new Set(input.permissions)];

  return verifyPinAtTerminal(
    deps,
    terminal,
    input.pin,
    (candidate) => ({ ...actor, authorizedByUserId: candidate?.id ?? null }),
    async (_tx, recorder, match) => {
      const missing = permissions.filter((permission) => !match.permissions.has(permission));
      if (missing.length > 0) {
        throw new ApiError('FORBIDDEN', 'This user cannot approve the action', { missing });
      }
      recorder.audit({
        action: 'approval.granted',
        entityType: 'approval',
        after: { action: input.action, permissions },
      });
      const approvalToken = await signApproval({
        approverUserId: match.user.id,
        organizationId: terminal.organizationId,
        locationId: terminal.locationId,
        terminalId: terminal.id,
        permissions,
        action: input.action,
      });
      return {
        approvalToken,
        expiresAt: new Date(Date.now() + APPROVAL_TTL_SECONDS * 1000).toISOString(),
        approver: { id: match.user.id, displayName: match.user.displayName },
      };
    },
  );
}

// ── Offline credentials (RF-A06, DEC-015) ───────────────────────────────────

export interface OfflineCredentials {
  pinKey: string | null;
  users: {
    id: string;
    displayName: string;
    uiLanguage: string;
    pinHash: string;
    /**
     * First 4 bits of the PIN lookup (0-15): enough to pick the 1-2 candidates to verify with
     * argon2, never the full lookup, which with the key would reveal every PIN (DEC-023).
     */
    pinBucket: number;
    permissions: Permission[];
  }[];
}

/**
 * Permissions of the active users of a location (same rule as loadUserPermissions, for many
 * users at once). A user who is inactive or does not work at the location is absent.
 */
export async function locationUserPermissions(
  db: ServiceDeps['db'] | Transaction,
  scope: { organizationId: string; locationId: string },
  userIds?: readonly string[],
): Promise<Map<string, Set<Permission>>> {
  const byUser = new Map<string, Set<Permission>>();
  if (userIds && userIds.length === 0) return byUser;
  const members = await db
    .select({ id: s.users.id })
    .from(s.users)
    .innerJoin(s.userLocations, eq(s.userLocations.userId, s.users.id))
    .where(
      inOrg(
        s.users,
        scope,
        eq(s.users.isActive, true),
        notDeleted(s.users),
        userIds ? inArray(s.users.id, [...userIds]) : undefined,
        eq(s.userLocations.organizationId, scope.organizationId),
        eq(s.userLocations.locationId, scope.locationId),
        notDeleted(s.userLocations),
      ),
    );
  if (members.length === 0) return byUser;
  const grants = await db
    .select({ userId: s.userRoles.userId, permission: s.rolePermissions.permission })
    .from(s.userRoles)
    .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
    .innerJoin(s.rolePermissions, eq(s.rolePermissions.roleId, s.roles.id))
    .where(
      inOrg(
        s.userRoles,
        scope,
        inArray(
          s.userRoles.userId,
          members.map((member) => member.id),
        ),
        notDeleted(s.userRoles),
        notDeleted(s.roles),
        notDeleted(s.rolePermissions),
        or(isNull(s.userRoles.locationId), eq(s.userRoles.locationId, scope.locationId)),
      ),
    );
  const known = new Set<string>(PERMISSIONS);
  for (const grant of grants) {
    if (!known.has(grant.permission)) continue;
    const set = byUser.get(grant.userId) ?? new Set<Permission>();
    set.add(grant.permission as Permission);
    byUser.set(grant.userId, set);
  }
  return byUser;
}

/**
 * The deliberate cache that lets a paired terminal unlock without network: the organization's
 * PIN key and, for every active user of the terminal's location with a PIN, the argon2 hash, a
 * 4-bit bucket of the PIN lookup and the permissions at that location. Only for a valid device
 * token (DEC-015, DEC-023). A waiter's own phone gets only its owner and the people who approve
 * with their PIN (RN-15): the other PINs never leave on someone's phone (DEC-036).
 */
export async function getOfflineCredentials(
  deps: ServiceDeps,
  device: DeviceContext,
): Promise<OfflineCredentials> {
  const terminal = await deviceTerminal(deps, device);
  const pinKey = await pinKeyOf(deps, terminal.organizationId);
  const users = await deps.db
    .select({
      id: s.users.id,
      displayName: s.users.displayName,
      uiLanguage: s.users.uiLanguage,
      pinHash: s.users.pinHash,
      pinLookup: s.users.pinLookup,
    })
    .from(s.users)
    .innerJoin(s.userLocations, eq(s.userLocations.userId, s.users.id))
    .where(
      inOrg(
        s.users,
        terminal,
        eq(s.users.isActive, true),
        notDeleted(s.users),
        isNotNull(s.users.pinHash),
        isNotNull(s.users.pinLookup),
        eq(s.userLocations.organizationId, terminal.organizationId),
        eq(s.userLocations.locationId, terminal.locationId),
        notDeleted(s.userLocations),
      ),
    );
  if (users.length === 0) return { pinKey, users: [] };
  const byUser = await locationUserPermissions(
    deps.db,
    terminal,
    users.map((user) => user.id),
  );

  const onThisDevice = (userId: string) =>
    terminal.type !== 'phone' ||
    userId === terminal.userId ||
    byUser.get(userId)!.has('approval.grant');

  return {
    pinKey,
    users: users
      .filter((user) => byUser.has(user.id) && onThisDevice(user.id))
      .map((user) => ({
        id: user.id,
        displayName: user.displayName,
        uiLanguage: user.uiLanguage,
        pinHash: user.pinHash!,
        pinBucket: Number.parseInt(user.pinLookup!.charAt(0), 16),
        permissions: sortedPermissions(byUser.get(user.id)!),
      })),
  };
}
