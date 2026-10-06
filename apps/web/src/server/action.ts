import 'server-only';
import { toApiError } from '@pos/api';
import { unstable_rethrow } from 'next/navigation';

/**
 * Result of a Server Action: the client shows `error.code` translated and marks `fieldErrors`.
 * Use cases throw ApiError; the same mapping as the REST API applies.
 */
export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; fieldErrors: Record<string, string> } };

function fieldErrorsOf(details: unknown): Record<string, string> {
  const errors: Record<string, string> = {};
  const issues = Array.isArray(details) ? details : details ? [details] : [];
  for (const issue of issues) {
    const { path, message } = issue as { path?: (string | number)[]; message?: string };
    if (path?.length) errors[path.join('.')] = message ?? 'invalid';
  }
  return errors;
}

export async function runAction<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    unstable_rethrow(error);
    const apiError = toApiError(error);
    if (apiError.code === 'INTERNAL') console.error('[action]', error);
    return {
      ok: false,
      error: { code: apiError.code, message: apiError.message, fieldErrors: fieldErrorsOf(apiError.details) },
    };
  }
}
