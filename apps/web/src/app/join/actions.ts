'use server';

import { people, toApiError } from '@pos/api';
import { submitRegistrationSchema } from '@pos/core';
import { createLogger, loggableError } from '@pos/db';
import { deps } from '@/server/actor';

export type JoinResult =
  | { ok: true; name: string; location: string }
  | {
      ok: false;
      reason: 'invalid' | 'invalid_code' | 'pin_taken' | 'error';
      attemptsLeft?: number;
    };

const logger = createLogger('web');

/**
 * The waiter's phone joins the team (DEC-055): public, the code is the credential. Answers only
 * what the form needs to say; the manager approves in the backoffice.
 */
export async function joinTeam(input: unknown): Promise<JoinResult> {
  const parsed = submitRegistrationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  try {
    const joined = await people.submitStaffRegistration(deps(), parsed.data);
    return { ok: true, name: parsed.data.displayName, location: joined.locationName };
  } catch (error) {
    const apiError = toApiError(error);
    const details = (apiError.details ?? {}) as { reason?: string; attemptsLeft?: number };
    if (details.reason === 'invalid_code') return { ok: false, reason: 'invalid_code' };
    if (details.reason === 'pin_taken') {
      return { ok: false, reason: 'pin_taken', attemptsLeft: details.attemptsLeft };
    }
    logger.error('join failed', { error: loggableError(error) });
    return { ok: false, reason: 'error' };
  }
}
