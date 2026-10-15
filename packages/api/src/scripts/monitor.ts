import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { type HealthIssueKind, healthIssues, type HealthSnapshot } from '@pos/core';
import { createDb, createLogger, loggableError } from '@pos/db';
import nodemailer from 'nodemailer';
import {
  type AlertRow,
  loadHealthSnapshot,
  markNotified,
  reconcileAlerts,
} from '../services/admin/platform-health';

/**
 * The monitor (RNF-16, RNF-01): every minute it checks the cloud's health, reads the snapshot of
 * every location and job, opens or resolves one alert per problem and e-mails support once when a
 * problem starts and once when it is solved — within five minutes of the threshold. Runs in the
 * worker container: `pnpm --filter @pos/api monitor`.
 */

const rootEnv = resolve(import.meta.dirname, '../../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const logger = createLogger('monitor');
const intervalMs = Number(process.env.MONITOR_INTERVAL_MS ?? 60_000);
const healthUrl = process.env.HEALTH_URL ?? null;
const expectBackups = process.env.MONITOR_EXPECT_BACKUPS !== 'false';
const recipient = process.env.SUPPORT_ALERT_EMAIL ?? null;
const statusUrl = process.env.DOMAIN ? `https://${process.env.DOMAIN}/support` : null;
const { db, pool } = createDb(process.env.DATABASE_URL!, { connectionLimit: 2 });

const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? '' }
        : undefined,
    })
  : null;

/** The e-mails go to DINOLABS support, in Spanish. */
const KIND_LABEL: Record<HealthIssueKind, string> = {
  cloud_down: 'La nube no responde',
  hub_offline: 'Hub sin señal',
  printer_error: 'Impresora con error',
  sync_conflicts: 'Conflictos de sincronización sin resolver',
  outbox_lagging: 'Outbox atrasado',
  backup_stale: 'Respaldo atrasado',
  backup_failed: 'Respaldo fallido',
  restore_test_failed: 'Prueba de restauración',
  archive_failed: 'Archivo legal fallido',
};

const line = (alert: AlertRow) =>
  `• ${KIND_LABEL[alert.kind as HealthIssueKind] ?? alert.kind}: ${alert.subject}\n  ${alert.detail ?? ''} (desde ${alert.since.toISOString()})`;

async function send(subject: string, text: string) {
  logger.warn('alert', { subject });
  if (!mailer || !recipient) {
    logger.warn('no SMTP or SUPPORT_ALERT_EMAIL: the alert is only logged', { subject });
    return false;
  }
  await mailer.sendMail({
    from: process.env.SMTP_FROM ?? recipient,
    to: recipient,
    subject,
    text: `${text}\n\n${statusUrl ? `Estado: ${statusUrl}\n` : ''}— Monitor POS`,
  });
  return true;
}

async function cloudHealth(): Promise<HealthSnapshot['cloud']> {
  if (!healthUrl) return { healthy: true, detail: null };
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(5_000) });
    return response.ok
      ? { healthy: true, detail: null }
      : { healthy: false, detail: `health answered ${response.status}` };
  } catch (error) {
    return { healthy: false, detail: `health unreachable: ${String(error)}` };
  }
}

let databaseDownSince: number | null = null;

async function round() {
  const snapshot = await loadHealthSnapshot(db, { cloud: await cloudHealth(), expectBackups });
  if (databaseDownSince !== null) {
    await send('[POS] ✅ La base de datos responde de nuevo', 'El monitor volvió a leer la base.');
    databaseDownSince = null;
  }
  const { opened, resolved } = await reconcileAlerts(db, healthIssues(snapshot));
  if (opened.length > 0) {
    const critical = opened.some((alert) => alert.severity === 'critical');
    const subject = `[POS] ${critical ? '🔴' : '🟠'} ${opened.length === 1 ? `${KIND_LABEL[opened[0]!.kind as HealthIssueKind]}: ${opened[0]!.subject}` : `${opened.length} problemas nuevos`}`;
    if (await send(subject, opened.map(line).join('\n\n')))
      await markNotified(db, opened, 'notifiedAt');
  }
  if (resolved.length > 0) {
    const subject = `[POS] ✅ ${resolved.length === 1 ? `Resuelto: ${resolved[0]!.subject}` : `${resolved.length} problemas resueltos`}`;
    if (await send(subject, resolved.map(line).join('\n\n'))) {
      await markNotified(db, resolved, 'resolvedNotifiedAt');
    }
  }
}

logger.info('monitor started', { intervalMs, healthUrl, expectBackups, email: Boolean(mailer) });
let running = true;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    running = false;
  });
}
while (running) {
  try {
    await round();
  } catch (error) {
    logger.error('monitor round failed', { error: loggableError(error) });
    // Without the database there is no alert table: one e-mail, then one every 30 minutes.
    const now = Date.now();
    if (databaseDownSince === null || now - databaseDownSince > 30 * 60_000) {
      databaseDownSince = now;
      await send(
        '[POS] 🔴 El monitor no puede leer la base de datos',
        `Error: ${String(error).slice(0, 500)}`,
      ).catch((mailError: unknown) =>
        logger.error('alert e-mail failed', { error: loggableError(mailError) }),
      );
    }
  }
  for (let waited = 0; waited < intervalMs && running; waited += 1_000) {
    await new Promise((r) => setTimeout(r, 1_000));
  }
}
await pool.end();
