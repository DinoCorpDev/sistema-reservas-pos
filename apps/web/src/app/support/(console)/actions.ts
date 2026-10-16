'use server';

import { admin, ApiError, platform } from '@pos/api';
import {
  addonInputSchema,
  onboardOrganizationSchema,
  planInputSchema,
  planPriceInputSchema,
  subscriptionInputSchema,
} from '@pos/core';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth, signOut, updateSession } from '@/auth';
import { runAction } from '@/server/action';
import { deps } from '@/server/actor';

/** The DINOLABS staff member of the session; the platform use cases take their id (RF-A10). */
async function currentStaff(): Promise<{ staffId: string }> {
  const session = await auth();
  if (session?.user?.kind !== 'support' || !session.user.id) {
    throw new ApiError('UNAUTHENTICATED', 'Sign in as DINOLABS support');
  }
  return { staffId: session.user.id };
}

/** Onboarding wizard (Flujo 7, DEC-017): the result carries the owner's temporary password once. */
export async function onboardOrganization(input: unknown) {
  return runAction(async () => {
    const staff = await currentStaff();
    const result = await admin.onboardOrganization(
      deps(),
      staff,
      onboardOrganizationSchema.parse(input),
    );
    revalidatePath('/support');
    return result;
  });
}

/**
 * Enters an organization at its first location. Only with the owner's active grant: checked here
 * for a clear message, and again by the session callback, which never trusts the client.
 */
export async function openOrganization(organizationId: string) {
  return runAction(async () => {
    const staff = await currentStaff();
    const organization = (await admin.listPlatformOrganizations(deps(), staff)).find(
      (org) => org.id === organizationId,
    );
    if (!organization) throw new ApiError('NOT_FOUND', 'Organization not found');
    if (!organization.supportGrantExpiresAt) {
      throw new ApiError('FORBIDDEN', 'The owner has not granted support access');
    }
    if (!organization.primaryLocationId) {
      throw new ApiError('RULE_VIOLATION', 'The organization has no location yet');
    }
    const session = await updateSession({
      organizationId: organization.id,
      locationId: organization.primaryLocationId,
    } as never);
    if (session?.user?.organizationId !== organization.id) {
      throw new ApiError('FORBIDDEN', 'The owner has not granted support access');
    }
    redirect('/backoffice');
  });
}

export async function logoutStaff() {
  await signOut({ redirectTo: '/support/login' });
}

// ── Plans and subscriptions (DEC-045) ───────────────────────────────────────────

export async function savePlan(input: unknown) {
  return runAction(async () => {
    await platform.savePlan(deps(), await currentStaff(), planInputSchema.parse(input));
    revalidatePath('/support/plans');
    return null;
  });
}

export async function saveAddon(input: unknown) {
  return runAction(async () => {
    await platform.saveAddon(deps(), await currentStaff(), addonInputSchema.parse(input));
    revalidatePath('/support/plans');
    return null;
  });
}

/** Sets a monthly price; `amountMinor: null` removes it. */
export async function savePlanPrice(input: unknown) {
  return runAction(async () => {
    const raw = (input ?? {}) as { amountMinor?: unknown };
    const parsed =
      raw.amountMinor === null
        ? { ...planPriceInputSchema.omit({ amountMinor: true }).parse(input), amountMinor: null }
        : planPriceInputSchema.parse(input);
    await platform.savePlanPrice(deps(), await currentStaff(), parsed);
    revalidatePath('/support/plans');
    return null;
  });
}

export async function loadOrganizationPlan(organizationId: string) {
  return runAction(async () =>
    platform.getOrganizationPlan(deps(), await currentStaff(), organizationId),
  );
}

/** A practice copy of the organization (RF-F22), e.g. before training its staff. */
export async function createTraining(organizationId: string) {
  return runAction(async () => {
    const result = await platform.createTrainingAsSupport(
      deps(),
      await currentStaff(),
      organizationId,
    );
    revalidatePath('/support');
    return result;
  });
}

export async function updateSubscription(organizationId: string, input: unknown) {
  return runAction(async () => {
    const result = await platform.updateSubscription(
      deps(),
      await currentStaff(),
      organizationId,
      subscriptionInputSchema.parse(input),
    );
    revalidatePath('/support');
    return result;
  });
}
