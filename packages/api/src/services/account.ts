import { UI_LANGUAGES, type UiLanguage } from '@pos/core';
import { hashPassword, inOrg, runCommand, schema as s, verifyPassword } from '@pos/db';
import { eq } from 'drizzle-orm';
import { generateSecret, generateURI, verify } from 'otplib';
import { type Actor, requireUserId } from '../actor';
import { ApiError, notFound } from '../errors';
import type { ServiceDeps } from './shared';

/**
 * The signed-in user's own account: UI language (RF-A08), password and two-factor sign-in
 * (RF-A07). No special permission: everyone manages their own account.
 */

async function loadSelf(deps: ServiceDeps, actor: Actor) {
  const userId = requireUserId(actor);
  const [user] = await deps.db.select().from(s.users).where(inOrg(s.users, actor, eq(s.users.id, userId)));
  if (!user) throw notFound('User');
  return user;
}

export async function getOwnAccount(deps: ServiceDeps, actor: Actor) {
  const user = await loadSelf(deps, actor);
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    uiLanguage: user.uiLanguage,
    twoFactorEnabled: user.twoFactorEnabled,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function setOwnLanguage(deps: ServiceDeps, actor: Actor, language: string): Promise<UiLanguage> {
  if (!(UI_LANGUAGES as readonly string[]).includes(language)) {
    throw new ApiError('VALIDATION_FAILED', 'Unsupported language', { path: ['uiLanguage'] });
  }
  const user = await loadSelf(deps, actor);
  await deps.db.update(s.users).set({ uiLanguage: language }).where(eq(s.users.id, user.id));
  return language as UiLanguage;
}

export async function changeOwnPassword(
  deps: ServiceDeps,
  actor: Actor,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  const user = await loadSelf(deps, actor);
  if (input.newPassword.length < 10 || input.newPassword.length > 200) {
    throw new ApiError('VALIDATION_FAILED', 'The password needs at least 10 characters', {
      path: ['newPassword'],
    });
  }
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw new ApiError('FORBIDDEN', 'The current password is wrong', { path: ['currentPassword'] });
  }
  const passwordHash = await hashPassword(input.newPassword);
  await runCommand(deps.db, actor, async (tx, recorder) => {
    await tx.update(s.users).set({ passwordHash, mustChangePassword: false }).where(eq(s.users.id, user.id));
    recorder.audit({ action: 'user.password_changed', entityType: 'user', entityId: user.id, locationId: null });
  });
}

/** Step 1 of 2FA: a new secret to add to the authenticator app (not active until confirmed). */
export async function startTwoFactor(deps: ServiceDeps, actor: Actor) {
  const user = await loadSelf(deps, actor);
  const secret = generateSecret();
  await deps.db
    .update(s.users)
    .set({ totpSecret: secret, twoFactorEnabled: false })
    .where(eq(s.users.id, user.id));
  return {
    secret,
    uri: generateURI({ issuer: 'Sistema Reservas POS', label: user.email ?? user.displayName, secret }),
  };
}

/** Step 2 of 2FA: a valid code from the app turns two-factor sign-in on. */
export async function confirmTwoFactor(deps: ServiceDeps, actor: Actor, token: string): Promise<void> {
  const user = await loadSelf(deps, actor);
  if (!user.totpSecret) throw new ApiError('BAD_REQUEST', 'Start the two-factor setup first');
  const result = await verify({ secret: user.totpSecret, token: token.replace(/\s/g, ''), epochTolerance: 30 });
  if (!result.valid) throw new ApiError('VALIDATION_FAILED', 'Invalid code', { path: ['token'] });
  await runCommand(deps.db, actor, async (tx, recorder) => {
    await tx.update(s.users).set({ twoFactorEnabled: true }).where(eq(s.users.id, user.id));
    recorder.audit({ action: 'user.two_factor_enabled', entityType: 'user', entityId: user.id, locationId: null });
  });
}

export async function disableTwoFactor(
  deps: ServiceDeps,
  actor: Actor,
  input: { currentPassword: string },
): Promise<void> {
  const user = await loadSelf(deps, actor);
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw new ApiError('FORBIDDEN', 'The current password is wrong', { path: ['currentPassword'] });
  }
  await runCommand(deps.db, actor, async (tx, recorder) => {
    await tx.update(s.users).set({ twoFactorEnabled: false, totpSecret: null }).where(eq(s.users.id, user.id));
    recorder.audit({ action: 'user.two_factor_disabled', entityType: 'user', entityId: user.id, locationId: null });
  });
}
