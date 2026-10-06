'use server';

import { admin, ApiError } from '@pos/api';
import {
  anonymizeCustomerSchema,
  consentInputSchema,
  createCustomerSchema,
  updateCustomerSchema,
} from '@pos/core';
import { revalidatePath } from 'next/cache';
import { runAction } from '@/server/action';
import { currentActor, deps } from '@/server/actor';

/**
 * A phone or email already used in the organization (409 with `details.existingCustomerId`) is not
 * an error for the screen: it links to the existing guest instead (RF-E14).
 */
function existingCustomerOf(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== 'CONFLICT') return null;
  const id = (error.details as { existingCustomerId?: unknown } | undefined)?.existingCustomerId;
  return typeof id === 'string' ? id : null;
}

const refresh = (id?: string) => {
  revalidatePath('/backoffice/customers');
  if (id) revalidatePath(`/backoffice/customers/${id}`);
};

export async function createCustomer(input: unknown) {
  return runAction(async () => {
    const actor = await currentActor();
    try {
      const customer = await admin.createCustomer(deps(), actor, createCustomerSchema.parse(input));
      refresh();
      return { customerId: customer.id, existingCustomerId: null };
    } catch (error) {
      const existingCustomerId = existingCustomerOf(error);
      if (!existingCustomerId) throw error;
      return { customerId: null, existingCustomerId };
    }
  });
}

export async function updateCustomer(id: string, input: unknown) {
  return runAction(async () => {
    const actor = await currentActor();
    try {
      await admin.updateCustomer(deps(), actor, id, updateCustomerSchema.parse(input));
      refresh(id);
      return { existingCustomerId: null };
    } catch (error) {
      const existingCustomerId = existingCustomerOf(error);
      if (!existingCustomerId) throw error;
      return { existingCustomerId };
    }
  });
}

export async function recordConsent(id: string, input: unknown) {
  return runAction(async () => {
    const consent = await admin.recordConsent(
      deps(),
      await currentActor(),
      id,
      consentInputSchema.parse(input),
    );
    refresh(id);
    return consent;
  });
}

/** Everything stored about the guest (RF-E16); the browser saves it as a JSON file. */
export async function exportCustomer(id: string) {
  return runAction(async () => admin.exportCustomer(deps(), await currentActor(), id));
}

export async function anonymizeCustomer(id: string, input: unknown) {
  return runAction(async () => {
    await admin.anonymizeCustomer(
      deps(),
      await currentActor(),
      id,
      anonymizeCustomerSchema.parse(input),
    );
    refresh(id);
    return null;
  });
}
