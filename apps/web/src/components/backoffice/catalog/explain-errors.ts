import 'server-only';
import { ApiError } from '@pos/api';
import { getTranslations } from 'next-intl/server';

/**
 * Translated explanations of the catalog use cases' business-rule errors for the backoffice. The
 * use cases answer in English for the REST API; the forms show German text and mark the field.
 */

/**
 * RN-18: publishing to the QR menu or the web while allergens or origin are missing (422). The
 * message names what is missing and is attached to both publish switches.
 */
export async function explainPublication<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const details = (error instanceof ApiError ? error.details : undefined) as
      { rule?: unknown; issues?: unknown } | undefined;
    if (
      !(error instanceof ApiError) ||
      error.code !== 'RULE_VIOLATION' ||
      details?.rule !== 'RN-18'
    ) {
      throw error;
    }
    const t = await getTranslations('publication');
    const issues = Array.isArray(details.issues) ? details.issues.map(String) : [];
    const message = t('blocked', {
      issues: issues.map((issue) => t(`issues.${issue}`)).join(', '),
    });
    throw new ApiError('RULE_VIOLATION', message, [
      { path: ['publishQr'], message },
      { path: ['publishWeb'], message },
    ]);
  }
}

/**
 * A 409 that means "still in use" (a category with products, a modifier group used by products)
 * is a business rule, not a duplicate: the toast explains it with `message`.
 */
export async function conflictAsRule<T>(work: Promise<T>, message: string): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'CONFLICT') {
      throw new ApiError('RULE_VIOLATION', message);
    }
    throw error;
  }
}
