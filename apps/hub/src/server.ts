import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { createApp, type HubDependencies } from './app';
import { attachRealtime, type HubMessage, type RealtimeOptions } from './realtime';

export interface StartedHub {
  port: number;
  broadcast: (message: HubMessage) => void;
  close: () => Promise<void>;
}

/** Starts HTTP + WebSocket on the same port. `port: 0` picks a free one (tests). */
export function startHub(options: {
  port: number;
  hostname?: string;
  pingDatabase: HubDependencies['pingDatabase'];
  api?: HubDependencies['api'];
  onPushed?: HubDependencies['onPushed'];
  allowedOrigins?: string[];
  realtime?: RealtimeOptions;
  printers?: HubDependencies['printers'];
}): Promise<StartedHub> {
  return new Promise((resolve) => {
    // The callbacks only read `realtime` once the server is listening, when it is initialized.
    const app = createApp({
      pingDatabase: options.pingDatabase,
      connectedClients: () => realtime.connectedClients(),
      api: options.api,
      onPushed: () => {
        realtime.broadcast({ type: 'sync.applied', seq: null });
        options.onPushed?.();
      },
      allowedOrigins: options.allowedOrigins,
      printers: options.printers,
    });
    const server = serve(
      { fetch: app.fetch, port: options.port, hostname: options.hostname ?? '0.0.0.0' },
      (info: AddressInfo) => {
        resolve({
          port: info.port,
          broadcast: (message) => realtime.broadcast(message),
          close: async () => {
            await realtime.close();
            await new Promise<void>((done) => server.close(() => done()));
          },
        });
      },
    ) as Server;
    const realtime = attachRealtime(server, options.realtime);
  });
}
