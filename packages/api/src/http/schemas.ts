import { z } from '@hono/zod-openapi';

/** Shared OpenAPI schemas and helpers for the route modules. */

export const UuidParam = z.object({
  id: z.uuid().openapi({
    param: { name: 'id', in: 'path' },
    example: '0192f1e2-7a3b-7c4d-8e5f-0123456789ab',
  }),
});

export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: 'NOT_FOUND' }),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .openapi('Error');

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: ErrorSchema } },
});

/** Standard error responses every authenticated route can return. */
export const ERROR_RESPONSES = {
  400: errorResponse('Bad request'),
  401: errorResponse('Not authenticated'),
  403: errorResponse('Forbidden or manager approval required (APPROVAL_REQUIRED)'),
  404: errorResponse('Not found (also for records of other organizations)'),
  409: errorResponse('Conflict with an existing record'),
  422: errorResponse('Validation failed or business rule violated'),
  423: errorResponse('Locked, e.g. too many wrong PINs on this terminal (RNF-10)'),
} as const;

export const jsonBody = <T extends z.ZodType>(schema: T, description?: string) => ({
  required: true,
  ...(description ? { description } : {}),
  content: { 'application/json': { schema } },
});

export const jsonResponse = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

export const NoContent = { description: 'Done' } as const;

/** Security requirement: any of the three ways to call the API. */
export const AUTHENTICATED: Record<string, string[]>[] = [
  { session: [] },
  { posSession: [], terminalToken: [] },
  { apiKey: [] },
];
