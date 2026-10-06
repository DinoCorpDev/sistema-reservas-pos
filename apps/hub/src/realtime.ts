import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';

export const WS_PATH = '/ws';

/** Mensajes del hub a los terminales. Fase 0: saludo y latido; las fases siguientes agregan eventos. */
export type HubMessage =
  | { type: 'hub.hello'; serverTime: string; protocolVersion: 1 }
  | { type: 'hub.pong'; serverTime: string };

/**
 * Canal en tiempo real de la sede (RNF-07): POS, handhelds y KDS se conectan por WebSocket al hub
 * en la LAN, sin pasar por la nube (RF-C27, RNF-05).
 */
export function attachRealtime(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const { pathname } = new URL(request.url ?? '/', 'http://hub.local');
    if (pathname !== WS_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });

  wss.on('connection', (ws) => {
    send(ws, { type: 'hub.hello', serverTime: new Date().toISOString(), protocolVersion: 1 });
    ws.on('message', (data) => {
      if (data.toString() === 'ping') {
        send(ws, { type: 'hub.pong', serverTime: new Date().toISOString() });
      }
    });
  });

  return {
    connectedClients: () => wss.clients.size,
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
