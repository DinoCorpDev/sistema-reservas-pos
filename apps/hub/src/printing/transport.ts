import { createConnection } from 'node:net';

/**
 * How the hub reaches a printer (DEC-031). Phase 3 speaks ESC/POS over a raw TCP socket (port
 * 9100), which Epson TM and Star printers in ESC/POS mode accept. Epson ePOS (HTTP/XML) and Star
 * CloudPRNT come in Phase 6 behind this same interface, once tested with real printers.
 */
export interface PrinterTarget {
  protocol: string;
  host: string;
  port: number;
}

export interface PrinterTransport {
  send(printer: PrinterTarget, bytes: Uint8Array): Promise<void>;
}

export class PrinterError extends Error {
  override readonly name = 'PrinterError';
}

/** Sends the bytes and waits for the printer to close the connection cleanly. */
export function tcpTransport(timeoutMs = 5_000): PrinterTransport {
  return {
    send(printer, bytes) {
      if (printer.protocol !== 'escpos') {
        return Promise.reject(
          new PrinterError(`Protocol ${printer.protocol} is not supported yet (Phase 6)`),
        );
      }
      return new Promise<void>((resolve, reject) => {
        const socket = createConnection({ host: printer.host, port: printer.port });
        let failed = false;
        const fail = (error: Error) => {
          if (failed) return;
          failed = true;
          socket.destroy();
          reject(new PrinterError(error.message));
        };
        socket.setTimeout(timeoutMs, () =>
          fail(new Error(`Timeout after ${timeoutMs} ms (${printer.host}:${printer.port})`)),
        );
        socket.on('error', fail);
        socket.on('connect', () => {
          socket.end(bytes);
        });
        socket.on('close', (hadError) => {
          if (!hadError && !failed) resolve();
        });
      });
    },
  };
}
