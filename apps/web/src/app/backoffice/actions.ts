'use server';

import { account } from '@pos/api';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { signOut, updateSession } from '@/auth';
import { isUiLocale } from '@/i18n/locales';
import { runAction } from '@/server/action';
import { currentActor, deps } from '@/server/actor';

/** Switches the location the user works on; re-validated against the database in the JWT callback. */
export async function switchLocation(locationId: string) {
  await updateSession({ locationId } as never);
  revalidatePath('/backoffice', 'layout');
}

/** The user's own UI language (RF-A08), stored on the user and in the session. */
export async function setUiLanguage(language: string) {
  if (!isUiLocale(language)) return;
  const actor = await currentActor();
  if (actor.kind === 'user') await account.setOwnLanguage(deps(), actor, language);
  await updateSession({ uiLanguage: language } as never);
  (await cookies()).set('NEXT_LOCALE', language, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  revalidatePath('/', 'layout');
}

export async function logout() {
  await signOut({ redirectTo: '/login' });
}

/** Support staff leave the organization and return to the console (RF-A10). */
export async function leaveOrganization() {
  await updateSession({ organizationId: null, locationId: null } as never);
  return runAction(async () => null);
}
