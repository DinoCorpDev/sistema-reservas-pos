import 'server-only';
import { toApiError } from '@pos/api';
import { createLogger, loggableError } from '@pos/db';
import { unstable_rethrow } from 'next/navigation';

/**
 * Result of a Server Action: the client shows `error.code` translated and marks `fieldErrors`.
 * Use cases throw ApiError; the same mapping as the REST API applies.
 */
export type ActionResult<T = null> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        fieldErrors: Record<string, string>;
        /** A known reason the client translates, with its values (e.g. a plan limit, DEC-045). */
        reason?: { key: string; values: Record<string, string | number> };
      };
    };

/** Reasons with their own message (`errors.reasons.<key>`), and the values they may show. */
const REASONS = new Set(['plan_limit', 'plan_feature', 'subscription_suspended']);

function reasonOf(details: unknown) {
  const record = details && typeof details === 'object' ? (details as Record<string, unknown>) : {};
  if (typeof record.reason !== 'string' || !REASONS.has(record.reason)) return undefined;
  const values: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key !== 'reason' && (typeof value === 'string' || typeof value === 'number')) {
      values[key] = value;
    }
  }
  return { key: record.reason, values };
}

const logger = createLogger('web');

function fieldErrorsOf(details: unknown): Record<string, string> {
  const errors: Record<string, string> = {};
  const issues = Array.isArray(details) ? details : details ? [details] : [];
  for (const issue of issues) {
    const { path, field, message } = issue as {
      path?: (string | number)[];
      field?: string;
      message?: string;
    };
    if (path?.length) errors[path.join('.')] = message ?? 'invalid';
    // Conflicts name the offending field directly (e.g. 409 `{ field: 'pin' }`).
    else if (field) errors[field] = message ?? 'conflict';
  }
  return errors;
}

export async function runAction<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    unstable_rethrow(error);
    const apiError = toApiError(error);
    if (apiError.code === 'INTERNAL')
      logger.error('action failed', { error: loggableError(error) });
    return {
      ok: false,
      error: {
        code: apiError.code,
        message: apiError.message,
        fieldErrors: fieldErrorsOf(apiError.details),
        reason: reasonOf(apiError.details),
      },
    };
  }
}
