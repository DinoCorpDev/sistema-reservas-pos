import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';

export const WS_PATH = '/ws';
export const PROTOCOL_VERSION = 2;

/** Messages from the hub to the terminals (docs/SYNC.md §11.3). */
export type HubMessage =
  | { type: 'hub.hello'; serverTime: string; protocolVersion: number; authority: boolean }
  | { type: 'hub.pong'; serverTime: string }
  | { type: 'sync.applied'; seq: number | null }
  | { type: 'config.changed'; configVersion: string }
  | { type: 'cloud.status'; online: boolean };

export interface RealtimeOptions {
  /** Whether this hub numbers the location's orders. */
  authority: boolean;
  /** Checks a terminal's device token; only authenticated terminals receive broadcasts. */
  authenticate?: (deviceToken: string) => Promise<boolean>;
}

/**
 * Real-time channel of the location (RNF-07): POS, handhelds and KDS connect to the hub over
 * WebSocket on the LAN. The hub only sends hints ("there are new operations", "the
 * configuration changed"); the terminals then pull, so a lost message never loses data.
 */
export function attachRealtime(server: Server, options: RealtimeOptions = { authority: true }) {
  const wss = new WebSocketServer({ noServer: true });
  const authenticated = new Set<WebSocket>();

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const { pathname } = new URL(request.url ?? '/', 'http://hub.local');
    if (pathname !== WS_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });

  wss.on('connection', (ws) => {
    send(ws, {
      type: 'hub.hello',
      serverTime: new Date().toISOString(),
      protocolVersion: PROTOCOL_VERSION,
      authority: options.authority,
    });
    ws.on('close', () => authenticated.delete(ws));
    ws.on('message', (data) => {
      const text = data.toString();
      if (text === 'ping') {
        send(ws, { type: 'hub.pong', serverTime: new Date().toISOString() });
        return;
      }
      let message: { type?: string; token?: string } | null = null;
      try {
        message = JSON.parse(text) as { type?: string; token?: string };
      } catch {
        return;
      }
      if (message?.type === 'hello' && typeof message.token === 'string') {
        const check = options.authenticate ?? (async () => true);
        void check(message.token).then((ok) => {
          if (ok) authenticated.add(ws);
          else ws.close(4401, 'Unknown terminal');
        });
      }
    });
  });

  return {
    connectedClients: () => wss.clients.size,
    /** Sends a hint to every authenticated terminal. */
    broadcast: (message: HubMessage) => {
      for (const ws of authenticated) send(ws, message);
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}

function send(ws: WebSocket, message: HubMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}
