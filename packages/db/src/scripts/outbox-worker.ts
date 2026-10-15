import { createDb } from '../client';
import { loadRootEnv, requireEnv } from '../env';
import { createLogger, loggableError } from '../logging';
import { publishPending } from '../outbox';

/**
 * Outbox worker (PA-10). Phase 1 has no external consumers yet: it marks events as delivered and
 * logs them. Webhooks (RF-F15) and terminal fan-out (RF-F23) plug in here in Phases 2 and 5.
 */
loadRootEnv();
const intervalMs = Number(process.env.OUTBOX_INTERVAL_MS ?? 2000);
const { db, pool } = createDb(requireEnv('DATABASE_URL'), { connectionLimit: 2 });
const logger = createLogger('worker', { task: 'outbox' });

let running = true;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    running = false;
  });
}

logger.info('outbox worker started', { intervalMs });
while (running) {
  const result = await publishPending(db, async (event) => {
    logger.debug('event published', {
      type: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      organizationId: event.organizationId,
    });
  }).catch((error: unknown) => {
    logger.error('outbox round failed', { error: loggableError(error) });
    return { published: 0, failed: 0 };
  });
  if (result.published + result.failed === 0) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
await pool.end();
