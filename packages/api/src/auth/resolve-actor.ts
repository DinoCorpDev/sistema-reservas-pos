import type { Permission } from '@pos/core';
import { type Database, schema as s, sha256Hex } from '@pos/db';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import type { Actor, Approval } from '../actor';
import { ApiError, isDuplicateKey } from '../errors';
import { looksLikeApiKey, resolveApiKeyActor } from './api-keys';
import { ALL_PERMISSIONS, loadUserPermissions } from './permissions';
import { verifyApproval, verifyPosSession } from './tokens';

/**
 * Backoffice session, as resolved by the web app (Auth.js) and handed to the API. The API does
 * not depend on the auth library.
 */
export type BackofficeSession =
  | { kind: 'user'; userId: string; organizationId: string; locationId: string | null }
  | { kind: 'support'; staffId: string; organizationId: string | null; locationId: string | null };

export type SessionResolver = (request: Request) => Promise<BackofficeSession | null>;

export interface ResolveInput {
  authorization: string | null;
  /** `X-Location-Id`: lets backoffice users and API keys pick the location they act on. */
  locationHeader: string | null;
  /** `X-Terminal-Token`: device token of a paired terminal (RF-A06). */
  terminalToken: string | null;
  /** `X-Approval`: one-time manager approval token (RF-A05). */
  approvalToken: string | null;
  session: BackofficeSession | null;
  requestId: string;
}

async function userActor(
  db: Database,
  base: {
    organizationId: string;
    userId: string;
    locationId: string | null;
    terminalId?: string | null;
  },
  requestId: string,
): Promise<Actor> {
  const permissions = await loadUserPermissions(db, base);
  if (permissions.size === 0) {
    throw new ApiError('FORBIDDEN', 'The user is inactive or does not work at this location');
  }
  return {
    kind: 'user',
    organizationId: base.organizationId,
    locationId: base.locationId,
    userId: base.userId,
    terminalId: base.terminalId ?? null,
    permissions,
    requestId,
  };
}

/** A support grant is valid while not revoked and not expired (RF-A10). */
export async function hasActiveSupportGrant(db: Database, organizationId: string, staffId: string) {
  const [grant] = await db
    .select({ id: s.supportAccessGrants.id })
    .from(s.supportAccessGrants)
    .where(
      and(
        eq(s.supportAccessGrants.organizationId, organizationId),
        isNull(s.supportAccessGrants.revokedAt),
        isNull(s.supportAccessGrants.deletedAt),
        gt(s.supportAccessGrants.expiresAt, new Date()),
        or(isNull(s.supportAccessGrants.staffId), eq(s.supportAccessGrants.staffId, staffId)),
      ),
    )
    .limit(1);
  return !!grant;
}

async function sessionActor(
  db: Database,
  session: BackofficeSession,
  input: ResolveInput,
): Promise<Actor> {
  if (session.kind === 'user') {
    return userActor(
      db,
      {
        organizationId: session.organizationId,
        userId: session.userId,
        locationId: input.locationHeader ?? session.locationId,
      },
      input.requestId,
    );
  }
  if (!session.organizationId) {
    throw new ApiError('FORBIDDEN', 'Support staff must open an organization first');
  }
  if (!(await hasActiveSupportGrant(db, session.organizationId, session.staffId))) {
    throw new ApiError(
      'FORBIDDEN',
      'The owner has not granted support access to this organization',
    );
  }
  const locationId = input.locationHeader ?? session.locationId;
  if (locationId) {
    const [location] = await db
      .select({ id: s.locations.id })
      .from(s.locations)
      .where(
        and(eq(s.locations.id, locationId), eq(s.locations.organizationId, session.organizationId)),
      );
    if (!location) throw new ApiError('NOT_FOUND', 'Location not found');
  }
  return {
    kind: 'support',
    organizationId: session.organizationId,
    locationId,
    userId: null,
    supportStaffId: session.staffId,
    permissions: ALL_PERMISSIONS,
    requestId: input.requestId,
  };
}

/** Terminal identified by its device token; must be active and paired. */
export async function resolveTerminal(db: Database, deviceToken: string) {
  const [terminal] = await db
    .select()
    .from(s.terminals)
    .where(
      and(eq(s.terminals.deviceTokenHash, sha256Hex(deviceToken)), isNull(s.terminals.deletedAt)),
    );
  if (!terminal || !terminal.isActive) {
    throw new ApiError('UNAUTHENTICATED', 'Unknown or deactivated terminal');
  }
  return terminal;
}

/**
 * One-time use of approval tokens (RN-15). Tokens live 60 s and are bound to one action; the
 * used ids are kept in the database, so two instances of the API never accept the same one
 * (DEC-015, DEC-045). The first insert wins; a duplicate key means it was already used.
 */
async function consumeApproval(
  db: Database,
  claims: { jti: string; organizationId: string; locationId: string },
  ttlMs = 120_000,
): Promise<boolean> {
  const now = new Date();
  await db.delete(s.approvalUses).where(lt(s.approvalUses.expiresAt, now));
  try {
    await db.insert(s.approvalUses).values({
      id: claims.jti,
      organizationId: claims.organizationId,
      locationId: claims.locationId,
      expiresAt: new Date(now.getTime() + ttlMs),
    });
    return true;
  } catch (error) {
    if (isDuplicateKey(error)) return false;
    throw error;
  }
}

async function attachApproval(db: Database, actor: Actor, token: string | null): Promise<Actor> {
  if (!token) return actor;
  const claims = await verifyApproval(token);
  if (claims.organizationId !== actor.organizationId || claims.locationId !== actor.locationId) {
    throw new ApiError('FORBIDDEN', 'The approval belongs to another location');
  }
  if (actor.terminalId && claims.terminalId !== actor.terminalId) {
    throw new ApiError('FORBIDDEN', 'The approval was given on another terminal');
  }
  if (!(await consumeApproval(db, claims))) {
    throw new ApiError('FORBIDDEN', 'This approval was already used');
  }
  const approval: Approval = {
    approverUserId: claims.approverUserId,
    permissions: claims.permissions as Permission[],
    action: claims.action,
  };
  return { ...actor, approval };
}

/**
 * Resolves the caller, in this order: `Authorization: Bearer pos_live_…` (API key),
 * `Authorization: Bearer <POS session>` with `X-Terminal-Token`, then the backoffice session.
 * Returns null for anonymous requests; routes decide whether they need an actor.
 */
export async function resolveActor(db: Database, input: ResolveInput): Promise<Actor | null> {
  const bearer = input.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
  let actor: Actor | null = null;

  if (bearer && looksLikeApiKey(bearer)) {
    actor = await resolveApiKeyActor(db, bearer, input.locationHeader);
    actor = { ...actor, requestId: input.requestId };
  } else if (bearer) {
    const claims = await verifyPosSession(bearer);
    if (!input.terminalToken) {
      throw new ApiError('UNAUTHENTICATED', 'POS requests need the X-Terminal-Token header');
    }
    const terminal = await resolveTerminal(db, input.terminalToken);
    if (terminal.id !== claims.terminalId || terminal.organizationId !== claims.organizationId) {
      throw new ApiError('UNAUTHENTICATED', 'The POS session belongs to another terminal');
    }
    actor = await userActor(
      db,
      {
        organizationId: claims.organizationId,
        userId: claims.userId,
        locationId: claims.locationId,
        terminalId: claims.terminalId,
      },
      input.requestId,
    );
  } else if (input.terminalToken) {
    // A paired device on its own (sync, bootstrap): no user, no permissions (DEC-023).
    const terminal = await resolveTerminal(db, input.terminalToken);
    actor = {
      kind: 'terminal',
      organizationId: terminal.organizationId,
      locationId: terminal.locationId,
      userId: null,
      terminalId: terminal.id,
      terminalType: terminal.type,
      permissions: new Set(),
      requestId: input.requestId,
    };
  } else if (input.session) {
    actor = await sessionActor(db, input.session, input);
  }

  return actor ? attachApproval(db, actor, input.approvalToken) : null;
}
