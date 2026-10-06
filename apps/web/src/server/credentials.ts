import 'server-only';
import { schema as s, verifyPassword } from '@pos/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { verify as verifyTotp } from 'otplib';
import { getDb } from './db';

/**
 * Backoffice sign-in checks (RF-A07): email + argon2 password, plus a TOTP code when the user
 * has two-factor authentication enabled. Errors never reveal whether the email exists.
 */
export type CredentialCheck<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'invalid' | 'totp_required' | 'totp_invalid' | 'inactive' };

export interface UserIdentity {
  userId: string;
  organizationId: string;
  locationId: string | null;
  displayName: string;
  uiLanguage: string;
  mustChangePassword: boolean;
}

async function totpMatches(secret: string, token: string): Promise<boolean> {
  try {
    const result = await verifyTotp({ secret, token: token.replace(/\s/g, ''), epochTolerance: 30 });
    return result.valid;
  } catch {
    return false;
  }
}

export async function checkUserCredentials(input: {
  email: string;
  password: string;
  totp?: string | null;
}): Promise<CredentialCheck<UserIdentity>> {
  const db = getDb();
  const [user] = await db
    .select()
    .from(s.users)
    .where(and(eq(s.users.email, input.email.trim().toLowerCase()), isNull(s.users.deletedAt)));
  if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, input.password))) {
    return { ok: false, reason: 'invalid' };
  }
  if (!user.isActive) return { ok: false, reason: 'inactive' };
  if (user.twoFactorEnabled && user.totpSecret) {
    if (!input.totp) return { ok: false, reason: 'totp_required' };
    if (!(await totpMatches(user.totpSecret, input.totp))) return { ok: false, reason: 'totp_invalid' };
  }
  const [firstLocation] = await db
    .select({ locationId: s.userLocations.locationId })
    .from(s.userLocations)
    .innerJoin(s.locations, eq(s.locations.id, s.userLocations.locationId))
    .where(and(eq(s.userLocations.userId, user.id), isNull(s.userLocations.deletedAt), isNull(s.locations.deletedAt)))
    .orderBy(asc(s.locations.name))
    .limit(1);
  await db.update(s.users).set({ lastLoginAt: new Date() }).where(eq(s.users.id, user.id));
  return {
    ok: true,
    value: {
      userId: user.id,
      organizationId: user.organizationId,
      locationId: firstLocation?.locationId ?? null,
      displayName: user.displayName,
      uiLanguage: user.uiLanguage,
      mustChangePassword: user.mustChangePassword,
    },
  };
}

export interface StaffIdentity {
  staffId: string;
  displayName: string;
}

/** DINOLABS support staff (platform level, RF-A10). */
export async function checkStaffCredentials(input: {
  email: string;
  password: string;
  totp?: string | null;
}): Promise<CredentialCheck<StaffIdentity>> {
  const db = getDb();
  const [staff] = await db
    .select()
    .from(s.platformStaff)
    .where(and(eq(s.platformStaff.email, input.email.trim().toLowerCase()), isNull(s.platformStaff.deletedAt)));
  if (!staff || !(await verifyPassword(staff.passwordHash, input.password))) {
    return { ok: false, reason: 'invalid' };
  }
  if (!staff.isActive) return { ok: false, reason: 'inactive' };
  if (staff.totpSecret) {
    if (!input.totp) return { ok: false, reason: 'totp_required' };
    if (!(await totpMatches(staff.totpSecret, input.totp))) return { ok: false, reason: 'totp_invalid' };
  }
  await db.update(s.platformStaff).set({ lastLoginAt: new Date() }).where(eq(s.platformStaff.id, staff.id));
  return { ok: true, value: { staffId: staff.id, displayName: staff.displayName } };
}

/** The user still works at this location (used when switching locations). */
export async function userWorksAt(userId: string, organizationId: string, locationId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: s.userLocations.id })
    .from(s.userLocations)
    .where(
      and(
        eq(s.userLocations.userId, userId),
        eq(s.userLocations.organizationId, organizationId),
        eq(s.userLocations.locationId, locationId),
        isNull(s.userLocations.deletedAt),
      ),
    );
  return !!row;
}
