import { createServer, type Server, type Socket } from 'node:net';
import { type DecodedJob, decodeEscPos } from './escpos';

/**
 * A network printer that prints to memory (DEC-031): the hub tests, the load test of the Phase 3
 * gate and local development use it instead of a real ESC/POS printer on port 9100.
 */
export interface FakePrinter {
  port: number;
  jobs: DecodedJob[];
  /** Offline it stops listening, like a printer that is switched off: connections are refused. */
  setOffline(offline: boolean): Promise<void>;
  close(): Promise<void>;
}

export async function startFakePrinter(
  options: { port?: number; host?: string; onJob?: (job: DecodedJob) => void } = {},
): Promise<FakePrinter> {
  const host = options.host ?? '127.0.0.1';
  const jobs: DecodedJob[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => {
      const job = decodeEscPos(Buffer.concat(chunks));
      jobs.push(job);
      options.onJob?.(job);
      socket.end();
    });
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
  });
  const listen = (port: number) =>
    new Promise<number>((resolve) => {
      server.listen(port, host, () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : port);
      });
    });
  const stop = () =>
    new Promise<void>((done) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => done());
    });

  const port = await listen(options.port ?? 0);
  let listening = true;
  return {
    port,
    jobs,
    async setOffline(offline) {
      if (offline && listening) {
        listening = false;
        await stop();
      } else if (!offline && !listening) {
        listening = true;
        await listen(port);
      }
    },
    async close() {
      if (listening) {
        listening = false;
        await stop();
      }
    },
  };
}
