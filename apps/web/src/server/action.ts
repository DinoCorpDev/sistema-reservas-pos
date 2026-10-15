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
  | { ok: false; error: { code: string; message: string; fieldErrors: Record<string, string> } };

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
      },
    };
  }
}
