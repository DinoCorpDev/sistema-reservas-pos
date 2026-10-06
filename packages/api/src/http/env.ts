import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Database } from '@pos/db';
import type { Context } from 'hono';
import type { Actor } from '../actor';
import type { BackofficeSession } from '../auth/resolve-actor';
import { ApiError } from '../errors';

export interface ApiEnv {
  Variables: {
    db: Database;
    actor: Actor | null;
    /** Raw backoffice session; platform routes use it to identify support staff (RF-A10). */
    session: BackofficeSession | null;
    requestId: string;
  };
}

export type ApiApp = OpenAPIHono<ApiEnv>;
export type ApiContext = Context<ApiEnv>;

/** The caller, or 401 if the request is anonymous. */
export function actorOf(c: ApiContext): Actor {
  const actor = c.get('actor');
  if (!actor) throw new ApiError('UNAUTHENTICATED', 'Sign in or send credentials');
  return actor;
}

/** DINOLABS support staff signed in to the platform console, or 401/403 (RF-A10). */
export function staffOf(c: ApiContext): { staffId: string } {
  const session = c.get('session');
  if (!session) throw new ApiError('UNAUTHENTICATED', 'Sign in to the support console');
  if (session.kind !== 'support') throw new ApiError('FORBIDDEN', 'Support staff only');
  return { staffId: session.staffId };
}
