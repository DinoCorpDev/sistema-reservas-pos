import { startFakePrinter } from './printing/fake-printer';

/**
 * A pretend ESC/POS printer for development (`pnpm --filter @pos/hub fake-printer`): it listens
 * like a network printer and writes every ticket to the console. Point a printer of the
 * backoffice to 127.0.0.1 and this port (FAKE_PRINTER_PORT, default 9100).
 */
const port = Number(process.env.FAKE_PRINTER_PORT ?? 9100);
const printer = await startFakePrinter({
  port,
  onJob: (job) => {
    const width = Math.max(32, ...job.lines.map((line) => line.length));
    console.log(`┌${'─'.repeat(width + 2)}┐`);
    for (const line of job.lines) console.log(`│ ${line.padEnd(width)} │`);
    const extras = [job.cuts > 0 ? '✂ cut' : null, job.drawerKicks > 0 ? '⏏ drawer' : null];
    console.log(`└${'─'.repeat(width + 2)}┘ ${extras.filter(Boolean).join(' ')}`);
  },
});
console.log(`Fake printer listening on 127.0.0.1:${printer.port}`);
