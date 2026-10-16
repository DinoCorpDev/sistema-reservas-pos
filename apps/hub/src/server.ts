import type { Server } from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { createApp, type HubDependencies } from './app';
import { attachRealtime, type HubMessage, type RealtimeOptions } from './realtime';

export interface StartedHub {
  port: number;
  broadcast: (message: HubMessage) => void;
  /**
   * Serves the same API and channel over HTTPS on `port` (DEC-028); called again with a renewed
   * certificate, it swaps it without dropping a connection. Resolves with the port.
   */
  serveTls: (tls: {
    port: number;
    hostname?: string;
    key: string;
    cert: string;
  }) => Promise<number>;
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
    let secure: { server: HttpsServer; port: number } | null = null;
    const serveTls: StartedHub['serveTls'] = (tls) => {
      if (secure) {
        secure.server.setSecureContext({ key: tls.key, cert: tls.cert });
        return Promise.resolve(secure.port);
      }
      return new Promise((listening) => {
        const server = serve(
          {
            fetch: app.fetch,
            port: tls.port,
            hostname: tls.hostname ?? options.hostname ?? '0.0.0.0',
            createServer: createHttpsServer,
            serverOptions: { key: tls.key, cert: tls.cert },
          },
          (info: AddressInfo) => {
            secure = { server, port: info.port };
            listening(info.port);
          },
        ) as unknown as HttpsServer;
        realtime.attach(server);
      });
    };
    const server = serve(
      { fetch: app.fetch, port: options.port, hostname: options.hostname ?? '0.0.0.0' },
      (info: AddressInfo) => {
        resolve({
          port: info.port,
          broadcast: (message) => realtime.broadcast(message),
          serveTls,
          close: async () => {
            await realtime.close();
            await new Promise<void>((done) => server.close(() => done()));
            const tlsServer = secure?.server;
            if (tlsServer) await new Promise<void>((done) => tlsServer.close(() => done()));
          },
        });
      },
    ) as Server;
    const realtime = attachRealtime(server, options.realtime);
  });
}
