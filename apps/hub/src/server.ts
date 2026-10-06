import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { createApp, type HubDependencies } from './app';
import { attachRealtime } from './realtime';

export interface StartedHub {
  port: number;
  close: () => Promise<void>;
}

/** Arranca HTTP + WebSocket en el mismo puerto. `port: 0` elige uno libre (tests). */
export function startHub(options: {
  port: number;
  hostname?: string;
  pingDatabase: HubDependencies['pingDatabase'];
}): Promise<StartedHub> {
  return new Promise((resolve) => {
    // Los callbacks solo leen `realtime` después de que el servidor escucha, ya inicializado.
    const app = createApp({
      pingDatabase: options.pingDatabase,
      connectedClients: () => realtime.connectedClients(),
    });
    const server = serve(
      { fetch: app.fetch, port: options.port, hostname: options.hostname ?? '0.0.0.0' },
      (info: AddressInfo) => {
        resolve({
          port: info.port,
          close: async () => {
            await realtime.close();
            await new Promise<void>((done) => server.close(() => done()));
          },
        });
      },
    ) as Server;
    const realtime = attachRealtime(server);
  });
}
