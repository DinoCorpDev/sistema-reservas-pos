import { Hono } from 'hono';

export interface HubDependencies {
  /** Comprueba la base local del hub; null si el hub corre sin base (modo diagnóstico). */
  pingDatabase: (() => Promise<void>) | null;
  /** Cantidad de terminales conectados por WebSocket. */
  connectedClients: () => number;
}

/**
 * API HTTP del hub en la LAN de la sede. La Fase 2 agrega el endpoint de sincronización y la
 * Fase 3 el ruteo a KDS e impresoras.
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
