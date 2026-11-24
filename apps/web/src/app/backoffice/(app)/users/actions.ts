'use server';

import { people } from '@pos/api';
import {
  createUserSchema,
  setPasswordSchema,
  setPinSchema,
  setRolePermissionsSchema,
  updateUserSchema,
} from '@pos/core';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { explainConflict } from '@/components/backoffice/people/explain-conflict';
import { runAction } from '@/server/action';
import { currentActor, deps } from '@/server/actor';

// The setup checklist on the overview asks for a manager with a PIN (RF-A11).
const done = <T>(value: T) => {
  revalidatePath('/backoffice/users');
  revalidatePath('/backoffice');
  return value;
};

/** Translations of the users screen and its field conflicts (409 with `details.field`). */
async function userMessages() {
  const t = await getTranslations('users');
  return { t, fields: { pin: t('pinTaken'), email: t('emailTaken') } };
}

export async function createUser(input: unknown) {
  return runAction(async () => {
    const { fields } = await userMessages();
    const work = people.createUser(deps(), await currentActor(), createUserSchema.parse(input));
    return done(await explainConflict(work, { fields }));
  });
}

/** Roles and locations are replaced as a whole; the organization keeps an active admin. */
export async function updateUser(id: string, input: unknown) {
  return runAction(async () => {
    const { t, fields } = await userMessages();
    const work = people.updateUser(deps(), await currentActor(), id, updateUserSchema.parse(input));
    return done(await explainConflict(work, { fields, rule: t('lastAdmin') }));
  });
}

/** Deactivation keeps everything (RF-A12); nobody deactivates themselves or the last admin. */
export async function setUserActive(id: string, isActive: boolean) {
  return runAction(async () => {
    const { t } = await userMessages();
    const actor = await currentActor();
    const rule = !isActive && id === actor.userId ? t('cannotDeactivateSelf') : t('lastAdmin');
    const work = people.updateUser(deps(), actor, id, updateUserSchema.parse({ isActive }));
    return done(await explainConflict(work, { rule }));
  });
}

export async function setUserPin(id: string, input: unknown) {
  return runAction(async () => {
    const { fields } = await userMessages();
    const work = people.setUserPin(deps(), await currentActor(), id, setPinSchema.parse(input));
    return done(await explainConflict(work, { fields }));
  });
}

export async function setUserPassword(id: string, input: unknown) {
  return runAction(async () =>
    done(
      await people.setUserPassword(
        deps(),
        await currentActor(),
        id,
        setPasswordSchema.parse(input),
      ),
    ),
  );
}

/** Replaces a role's permissions (RF-A05); the admin role always keeps all of them. */
export async function setRolePermissions(id: string, input: unknown) {
  return runAction(async () => {
    const t = await getTranslations('roles');
    const work = people.setRolePermissions(
      deps(),
      await currentActor(),
      id,
      setRolePermissionsSchema.parse(input),
    );
    return done(await explainConflict(work, { rule: t('adminLocked') }));
  });
}

// ── New waiters from their own phone (DEC-055) ──────────────────────────────

/** A code for the QR that new waiters scan; shown once. */
export async function issueStaffInvite() {
  return runAction(async () => people.issueStaffInvite(deps(), await currentActor()));
}

/** Lets the person in: a waiter with the PIN they chose. */
export async function approveRegistration(id: string) {
  return runAction(async () => {
    const { fields } = await userMessages();
    const work = people.approveStaffRegistration(deps(), await currentActor(), id);
    return done(await explainConflict(work, { fields }));
  });
}

export async function rejectRegistration(id: string) {
  return runAction(async () =>
    done(await people.rejectStaffRegistration(deps(), await currentActor(), id)),
  );
}
