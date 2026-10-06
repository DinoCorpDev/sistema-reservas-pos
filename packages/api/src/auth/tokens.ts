import type { Permission } from '@pos/core';
import { jwtVerify, SignJWT } from 'jose';
import { ApiError } from '../errors';

/**
 * Short-lived signed tokens (HS256 with AUTH_SECRET):
 * - POS session: issued when a user unlocks a paired terminal with their PIN (RF-A06).
 * - Approval: a manager authorizes ONE sensitive action on the same device (RF-A05, RN-15).
 */

const ISSUER = 'sistema-reservas-pos';

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET is missing or too short (min. 32 characters), see .env.example');
  }
  return new TextEncoder().encode(secret);
}

export interface PosSessionClaims {
  userId: string;
  organizationId: string;
  locationId: string;
  terminalId: string;
}

export const POS_SESSION_TTL_SECONDS = 12 * 60 * 60;

export async function signPosSession(claims: PosSessionClaims): Promise<string> {
  return new SignJWT({ org: claims.organizationId, loc: claims.locationId, trm: claims.terminalId })
    .setProtectedHeader({ alg: 'HS256', typ: 'pos+jwt' })
    .setIssuer(ISSUER)
    .setAudience('pos')
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${POS_SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifyPosSession(token: string): Promise<PosSessionClaims> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: ISSUER, audience: 'pos' });
    const { sub, org, loc, trm } = payload as { sub?: string; org?: string; loc?: string; trm?: string };
    if (!sub || !org || !loc || !trm) throw new Error('incomplete token');
    return { userId: sub, organizationId: org, locationId: loc, terminalId: trm };
  } catch {
    throw new ApiError('UNAUTHENTICATED', 'The POS session is invalid or expired');
  }
}

export interface ApprovalClaims {
  approverUserId: string;
  organizationId: string;
  locationId: string;
  terminalId: string;
  permissions: Permission[];
  /** Free text that ties the approval to one action (e.g. `void_item:<itemId>`). */
  action: string;
}

export const APPROVAL_TTL_SECONDS = 60;

export async function signApproval(claims: ApprovalClaims): Promise<string> {
  return new SignJWT({
    org: claims.organizationId,
    loc: claims.locationId,
    trm: claims.terminalId,
    perms: claims.permissions,
    act: claims.action,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'approval+jwt' })
    .setIssuer(ISSUER)
    .setAudience('approval')
    .setSubject(claims.approverUserId)
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(`${APPROVAL_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifyApproval(token: string): Promise<ApprovalClaims & { jti: string }> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: ISSUER, audience: 'approval' });
    const p = payload as {
      sub?: string;
      org?: string;
      loc?: string;
      trm?: string;
      perms?: Permission[];
      act?: string;
      jti?: string;
    };
    if (!p.sub || !p.org || !p.loc || !p.trm || !p.perms || !p.act || !p.jti) {
      throw new Error('incomplete token');
    }
    return {
      approverUserId: p.sub,
      organizationId: p.org,
      locationId: p.loc,
      terminalId: p.trm,
      permissions: p.perms,
      action: p.act,
      jti: p.jti,
    };
  } catch {
    throw new ApiError('UNAUTHENTICATED', 'The manager approval is invalid or expired');
  }
}
