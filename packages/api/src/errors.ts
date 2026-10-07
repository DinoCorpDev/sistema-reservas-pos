import { OrderRuleError, PaymentRuleError, TaxError } from '@pos/core';
import { TenantError } from '@pos/db';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'APPROVAL_REQUIRED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'LOCKED'
  | 'RULE_VIOLATION'
  | 'INTERNAL';

const STATUS: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  APPROVAL_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  LOCKED: 423,
  RULE_VIOLATION: 422,
  INTERNAL: 500,
};

/** Every API failure has the same shape: `{ error: { code, message, details? } }`. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.status = STATUS[code];
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export const notFound = (what: string) => new ApiError('NOT_FOUND', `${what} not found`);

/** MySQL duplicate-key error, possibly wrapped by Drizzle. */
export function isDuplicateKey(error: unknown): boolean {
  const candidates = [error, (error as { cause?: unknown })?.cause];
  return candidates.some((e) => (e as { code?: string } | undefined)?.code === 'ER_DUP_ENTRY');
}

/** Maps domain and infrastructure errors to API errors; unknown errors become INTERNAL. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError) {
    return new ApiError('VALIDATION_FAILED', 'The request is not valid', error.issues);
  }
  if (
    error instanceof TaxError ||
    error instanceof OrderRuleError ||
    error instanceof PaymentRuleError
  ) {
    return new ApiError('RULE_VIOLATION', error.message, { rule: error.code });
  }
  if (error instanceof TenantError) return new ApiError('BAD_REQUEST', error.message);
  // Hono's own errors, e.g. a malformed or empty JSON body.
  if (error instanceof HTTPException) {
    if (error.status === 401)
      return new ApiError('UNAUTHENTICATED', error.message || 'Not authenticated');
    if (error.status === 403) return new ApiError('FORBIDDEN', error.message || 'Forbidden');
    if (error.status === 404) return new ApiError('NOT_FOUND', error.message || 'Not found');
    if (error.status < 500)
      return new ApiError('BAD_REQUEST', error.message || 'Malformed request');
  }
  if (isDuplicateKey(error))
    return new ApiError('CONFLICT', 'A record with these values already exists');
  return new ApiError('INTERNAL', 'Unexpected error');
}
