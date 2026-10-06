import 'server-only';
import { ApiError } from '@pos/api';

/**
 * Gives a use case's 409 a translated explanation for the backoffice forms. A conflict that names
 * its field (`details.field`, e.g. a PIN already in use) becomes a field error the form shows next
 * to that field; any other conflict (still in use, last administrator…) is a business rule the
 * toast explains with `rule`. Everything else passes through unchanged.
 */
export async function explainConflict<T>(
  work: Promise<T>,
  messages: { fields?: Record<string, string>; rule?: string },
): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'CONFLICT') throw error;
    const field = (error.details as { field?: unknown } | undefined)?.field;
    if (typeof field === 'string') {
      const message = messages.fields?.[field] ?? error.message;
      throw new ApiError('CONFLICT', message, [{ path: [field], message }]);
    }
    if (messages.rule) throw new ApiError('RULE_VIOLATION', messages.rule);
    throw error;
  }
}
