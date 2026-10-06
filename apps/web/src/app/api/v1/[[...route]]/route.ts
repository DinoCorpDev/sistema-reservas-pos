import { createApiApp } from '@pos/api';
import { handle } from 'hono/vercel';
import { backofficeSession } from '@/auth';
import { getDb } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The Core REST API v1 (packages/api), served by Next.js under /api/v1 (PA-01, RF-F14). */
let app: ReturnType<typeof createApiApp> | undefined;

function api() {
  app ??= createApiApp({ db: getDb(), resolveSession: () => backofficeSession() });
  return app;
}

const handler = (request: Request) => handle(api())(request);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
