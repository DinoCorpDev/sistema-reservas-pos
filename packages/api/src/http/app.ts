import { randomUUID } from 'node:crypto';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { Database } from '@pos/db';
import { Scalar } from '@scalar/hono-api-reference';
import { resolveActor, type SessionResolver } from '../auth/resolve-actor';
import { ApiError, toApiError } from '../errors';
import type { ApiEnv } from './env';
import { registerRoutes } from './routes';

export const API_BASE_PATH = '/api/v1';

/**
 * Error for the server log without bound query parameters: a failed Drizzle query carries its
 * params, which may hold password/PIN hashes, PIN lookups or personal data (RNF-10, revDSG).
 */
function loggable(error: unknown) {
  if (error && typeof error === 'object' && 'query' in error && 'params' in error) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    return { query: (error as { query: string }).query, code: cause?.code, cause: cause?.message };
  }
  return error;
}

export interface ApiDependencies {
  db: Database;
  /** Backoffice session from the web app (Auth.js); absent in tests and on the hub. */
  resolveSession?: SessionResolver;
}

/**
 * Public REST API v1 (RF-F14, PA-01): one Hono app mounted by Next.js under /api/v1 and, later,
 * by the location hub. Every route validates its input with Zod and is documented in OpenAPI.
 */
export function createApiApp(deps: ApiDependencies) {
  const app = new OpenAPIHono<ApiEnv>({
    defaultHook: (result) => {
      if (!result.success) {
        throw new ApiError('VALIDATION_FAILED', 'The request is not valid', result.error.issues);
      }
    },
  }).basePath(API_BASE_PATH);

  app.onError((error, c) => {
    const apiError = toApiError(error);
    if (apiError.code === 'INTERNAL') {
      console.error(`[api] ${c.req.method} ${c.req.path} (${c.get('requestId')})`, loggable(error));
    }
    return c.json(apiError.toJSON(), apiError.status as 500);
  });
  app.notFound((c) => c.json(new ApiError('NOT_FOUND', 'Route not found').toJSON(), 404));

  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? randomUUID();
    c.set('requestId', requestId);
    c.set('db', deps.db);
    c.header('x-request-id', requestId);
    const session = deps.resolveSession ? await deps.resolveSession(c.req.raw) : null;
    c.set('session', session);
    // Support staff without an open organization reach only the platform routes (staffOf).
    const actorSession = session?.kind === 'support' && !session.organizationId ? null : session;
    c.set(
      'actor',
      await resolveActor(deps.db, {
        authorization: c.req.header('authorization') ?? null,
        locationHeader: c.req.header('x-location-id') ?? null,
        terminalToken: c.req.header('x-terminal-token') ?? null,
        approvalToken: c.req.header('x-approval') ?? null,
        session: actorSession,
        requestId,
      }),
    );
    await next();
  });

  registerRoutes(app);

  app.openAPIRegistry.registerComponent('securitySchemes', 'session', {
    type: 'apiKey',
    in: 'cookie',
    name: 'authjs.session-token',
    description: 'Backoffice session (Auth.js). Pick the location with the X-Location-Id header.',
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'posSession', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'POS session issued by POST /terminals/unlock (PIN). Requires X-Terminal-Token.',
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'terminalToken', {
    type: 'apiKey',
    in: 'header',
    name: 'X-Terminal-Token',
    description: 'Device token of a paired terminal (POST /terminals/pair).',
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'apiKey', {
    type: 'http',
    scheme: 'bearer',
    description: 'Organization API key `pos_live_…` (RF-F14). Pick the location with X-Location-Id.',
  });

  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Sistema Reservas POS API',
      version: '1.0.0',
      description:
        'Core POS REST API v1. Amounts are integers in rappen (CHF 1.00 = 100); prices include MWST. ' +
        'Errors always have the shape `{ "error": { "code", "message", "details" } }`.',
    },
    servers: [{ url: '/' }],
  });
  app.get('/docs', Scalar({ url: `${API_BASE_PATH}/openapi.json`, pageTitle: 'Sistema Reservas POS API' }));

  return app;
}

export type ApiAppInstance = ReturnType<typeof createApiApp>;
