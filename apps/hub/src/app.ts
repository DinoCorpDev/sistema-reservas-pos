import { Hono } from 'hono';
import { cors } from 'hono/cors';

export interface HubDependencies {
  /** Checks the hub's local database; null if the hub runs without one (diagnostic mode). */
  pingDatabase: (() => Promise<void>) | null;
  /** Number of terminals connected over WebSocket. */
  connectedClients: () => number;
  /** The sync API (`createApiApp` with `modules: 'sync'` on the hub database). */
  api?: { fetch: (request: Request) => Response | Promise<Response> };
  /** Called after terminals pushed operations (to broadcast and forward them). */
  onPushed?: () => void;
  /** Origins allowed to call the hub from the browser: the POS origin (default: any). */
  allowedOrigins?: string[];
  /** Health of the printers as the print queue last saw them (DEC-031). */
  printers?: () => Record<string, { ok: boolean; error: string | null }>;
}

/**
 * HTTP API of the hub on the location's LAN (docs/SYNC.md §11): health (with the printers) and
 * the same sync routes as the cloud under /api/v1 (push, pull, order numbers). The POS and the
 * KDS are served by the cloud, so the hub answers cross-origin requests and Chrome's Private
 * Network Access preflight. Printing runs in the background (`printing/worker.ts`).
 */
export function createApp(deps: HubDependencies) {
  const app = new Hono();

  app.get('/health', async (c) => {
    let database: 'ok' | 'down' | 'disabled' = 'disabled';
    if (deps.pingDatabase) {
      try {
        await deps.pingDatabase();
        database = 'ok';
      } catch {
        database = 'down';
      }
    }
    const healthy = database !== 'down';
    return c.json(
      {
        status: healthy ? 'ok' : 'degraded',
        service: 'hub',
        level: 'hub',
        checks: { database },
        connectedClients: deps.connectedClients(),
        printers: deps.printers?.() ?? {},
        time: new Date().toISOString(),
      },
      healthy ? 200 : 503,
    );
  });

  const api = deps.api;
  if (api) {
    app.use('/api/v1/*', async (c, next) => {
      await next();
      // A public page (the POS) calling a device on the LAN (Chrome Private Network Access).
      if (c.req.header('access-control-request-private-network') === 'true') {
        c.res.headers.set('Access-Control-Allow-Private-Network', 'true');
      }
    });
    app.use(
      '/api/v1/*',
      cors({
        origin: deps.allowedOrigins && deps.allowedOrigins.length > 0 ? deps.allowedOrigins : '*',
        allowHeaders: ['content-type', 'x-terminal-token'],
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        maxAge: 600,
      }),
    );
    app.all('/api/v1/*', async (c) => {
      const response = await api.fetch(c.req.raw);
      if (c.req.method === 'POST' && c.req.path === '/api/v1/sync/push' && response.ok) {
        deps.onPushed?.();
      }
      return response;
    });
  }

  return app;
}
