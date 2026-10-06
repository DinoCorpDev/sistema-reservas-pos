import { createRoute, z } from '@hono/zod-openapi';
import { sql } from 'drizzle-orm';
import type { ApiApp } from '../env';
import { jsonResponse } from '../schemas';

const HealthSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    service: z.literal('web'),
    checks: z.object({ database: z.enum(['ok', 'down']) }),
    latencyMs: z.number().int(),
    time: z.string(),
  })
  .openapi('Health');

/** Cloud health (RNF-16): 200 when API and database are up, 503 when the database is down. */
export function registerSystemRoutes(app: ApiApp) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/health',
      tags: ['System'],
      summary: 'Service health',
      responses: {
        200: jsonResponse(HealthSchema, 'Healthy'),
        503: jsonResponse(HealthSchema, 'Database down'),
      },
    }),
    async (c) => {
      const startedAt = Date.now();
      let database: 'ok' | 'down' = 'ok';
      try {
        await c.get('db').execute(sql`SELECT 1`);
      } catch {
        database = 'down';
      }
      const body = {
        status: database === 'ok' ? ('ok' as const) : ('degraded' as const),
        service: 'web' as const,
        checks: { database },
        latencyMs: Date.now() - startedAt,
        time: new Date().toISOString(),
      };
      c.header('Cache-Control', 'no-store');
      return database === 'ok' ? c.json(body, 200) : c.json(body, 503);
    },
  );
}
