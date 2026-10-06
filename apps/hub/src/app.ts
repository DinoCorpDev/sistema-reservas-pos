import { Hono } from 'hono';

export interface HubDependencies {
  /** Checks the hub's local database; null if the hub runs without one (diagnostic mode). */
  pingDatabase: (() => Promise<void>) | null;
  /** Number of terminals connected over WebSocket. */
  connectedClients: () => number;
}

/**
 * HTTP API of the hub on the location's LAN. Phase 2 adds the sync endpoint and
 * Phase 3 the routing to KDS and printers.
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
        time: new Date().toISOString(),
      },
      healthy ? 200 : 503,
    );
  });

  return app;
}
