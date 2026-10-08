import { sync } from '@pos/api';
import {
  columnsFor,
  foldOperations,
  KITCHEN_LABELS,
  newId,
  type Operation,
  operationOrderIds,
  type PrintDocument,
  renderTestPage,
} from '@pos/core';
import { type Database, schema as s } from '@pos/db';
import { and, asc, eq, gt, lte } from 'drizzle-orm';
import { type CloudFetch, cloudJson } from '../cloud';
import type { HubScope } from '../forwarder';
import type { HubMessage } from '../realtime';
import type { StateFile } from '../state';
import type { PrintConfig } from './config';
import { encodeEscPos } from './escpos';
import { kitchenLanguageOf, planPrintJobs, PRINTING_OPERATIONS, type PrintJobDraft } from './plan';
import type { PrinterTransport } from './transport';

/**
 * The print queue of the hub (DEC-031). Two steps, both idempotent:
 * 1. plan: read the new operations of the local log (by `seq`), fold their order group with the
 *    same Core code as every node, and store the jobs with a unique key; an operation older than
 *    `settings.printing.maxDelayMinutes` (a cash drawer: one minute) is stored as `expired`;
 * 2. dispatch: send the due jobs, one printer at a time in order, retrying 2, 5, 10, 30 s… for ten
 *    minutes before giving up. Printer changes are broadcast to the terminals and reported to the
 *    cloud (DEC-032).
 */

const BACKOFF_MS = [2_000, 5_000, 10_000, 30_000];
const GIVE_UP_MS = 10 * 60_000;
const DRAWER_MAX_AGE_MS = 60_000;
const BATCH = 200;

export interface PrintWorkerOptions {
  db: Database;
  scope: HubScope;
  state: StateFile;
  config: () => PrintConfig | null;
  transport: PrinterTransport;
  cloud?: CloudFetch;
  broadcast?: (message: HubMessage) => void;
  now?: () => Date;
  /** How long to wait for missing items before printing what is there (default 30 s). */
  waitLimitMs?: number;
}

interface PrinterHealth {
  ok: boolean;
  error: string | null;
}

export class PrintWorker {
  private readonly now: () => Date;
  private readonly waiting = new Map<string, number>();
  private readonly health = new Map<string, PrinterHealth>();
  private readonly pendingReports = new Map<
    string,
    { printerId: string; ok: boolean; error: string | null; at: string; test: boolean }
  >();
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: PrintWorkerOptions) {
    this.now = options.now ?? (() => new Date());
  }

  /** Plans the jobs of the operations stored since the last run; returns how many were created. */
  async plan(): Promise<number> {
    const config = this.options.config();
    if (!config) return 0;
    const { db, scope, state } = this.options;
    let created = await this.planTests(config);
    const rows = await db
      .select({ seq: s.syncOperations.seq, payload: s.syncOperations.payload })
      .from(s.syncOperations)
      .where(
        and(
          eq(s.syncOperations.locationId, scope.locationId),
          gt(s.syncOperations.seq, state.value.printCursor),
        ),
      )
      .orderBy(asc(s.syncOperations.seq))
      .limit(BATCH);
    let cursor = state.value.printCursor;
    for (const row of rows) {
      const op = row.payload as Operation;
      if (PRINTING_OPERATIONS.has(op.type)) {
        const orderIds = operationOrderIds(op);
        const group =
          orderIds.length > 0
            ? await db.transaction((tx) => sync.loadGroup(tx, scope, orderIds))
            : { rows: [] };
        const fold = foldOperations(
          group.rows.map((r) => r.payload as Operation),
          { settings: config.location.settings },
        );
        const plan = planPrintJobs(op, fold, config);
        if (plan.status === 'wait') {
          const since = this.waiting.get(op.id) ?? this.now().getTime();
          this.waiting.set(op.id, since);
          // Keep the order of the kitchen: wait for the missing items before going on.
          if (this.now().getTime() - since < (this.options.waitLimitMs ?? 30_000)) break;
        } else {
          created += await this.store(op, plan.jobs, config);
        }
        this.waiting.delete(op.id);
      }
      cursor = Number(row.seq);
    }
    if (cursor !== state.value.printCursor) state.update({ printCursor: cursor });
    return created;
  }

  private async store(op: Operation, jobs: PrintJobDraft[], config: PrintConfig) {
    const now = this.now();
    const age = now.getTime() - Date.parse(op.deviceAt);
    let created = 0;
    for (const job of jobs) {
      const maxAge =
        job.kind === 'drawer'
          ? DRAWER_MAX_AGE_MS
          : config.location.settings.printing.maxDelayMinutes * 60_000;
      created += await this.insertJob(job, {
        sourceOperationId: op.id,
        requestedAt: new Date(op.deviceAt),
        status: age > maxAge ? 'expired' : 'pending',
      });
    }
    return created;
  }

  private async insertJob(
    job: PrintJobDraft,
    fields: { sourceOperationId: string | null; requestedAt: Date; status: 'pending' | 'expired' },
  ): Promise<number> {
    const { db, scope } = this.options;
    const now = this.now();
    const [result] = await db
      .insert(s.printJobs)
      .values({
        id: newId(),
        organizationId: scope.organizationId,
        locationId: scope.locationId,
        jobKey: job.jobKey,
        kind: job.kind,
        sourceOperationId: fields.sourceOperationId,
        printerId: job.printerId,
        kitchenStationId: job.stationId,
        document: job.document,
        status: fields.status,
        requestedAt: fields.requestedAt,
        nextAttemptAt: now,
        createdAt: now,
      })
      // The same job key again (operation received twice, restart): nothing happens.
      .onDuplicateKeyUpdate({ set: { jobKey: job.jobKey } });
    return (result as { affectedRows?: number }).affectedRows === 1 ? 1 : 0;
  }

  /** Test pages requested from the backoffice (RF-F17): one job per request. */
  private async planTests(config: PrintConfig): Promise<number> {
    const handled = this.options.state.value.testsHandled;
    let created = 0;
    for (const printer of config.printers) {
      if (!printer.testRequestedAt || handled[printer.id] === printer.testRequestedAt) continue;
      const language = kitchenLanguageOf(config, null);
      const document: PrintDocument = renderTestPage({
        width: columnsFor(printer.paperWidthMm),
        labels: KITCHEN_LABELS[language],
        printerName: printer.name,
        timeZone: config.location.timezone,
        at: this.now().toISOString(),
      });
      created += await this.insertJob(
        {
          jobKey: `test:${printer.id}:${printer.testRequestedAt}`,
          kind: 'test',
          printerId: printer.id,
          stationId: null,
          document,
        },
        {
          sourceOperationId: null,
          requestedAt: new Date(printer.testRequestedAt),
          status: 'pending',
        },
      );
      this.options.state.update({
        testsHandled: {
          ...this.options.state.value.testsHandled,
          [printer.id]: printer.testRequestedAt,
        },
      });
    }
    return created;
  }

  /** Sends the due jobs; returns how many printed. */
  async dispatch(): Promise<number> {
    const config = this.options.config();
    if (!config) return 0;
    const { db, scope, transport } = this.options;
    const now = this.now();
    const due = await db
      .select()
      .from(s.printJobs)
      .where(
        and(
          eq(s.printJobs.locationId, scope.locationId),
          eq(s.printJobs.status, 'pending'),
          lte(s.printJobs.nextAttemptAt, now),
        ),
      )
      .orderBy(asc(s.printJobs.requestedAt), asc(s.printJobs.createdAt), asc(s.printJobs.jobKey))
      .limit(BATCH);
    // A printer that just failed is not tried again in this round: its jobs keep their order.
    const down = new Set<string>();
    let printed = 0;
    for (const job of due) {
      if (down.has(job.printerId)) continue;
      const printer = config.printers.find((p) => p.id === job.printerId && p.isActive);
      const where = and(eq(s.printJobs.locationId, scope.locationId), eq(s.printJobs.id, job.id));
      if (!printer) {
        await db
          .update(s.printJobs)
          .set({ status: 'failed', lastError: 'Printer removed or inactive' })
          .where(where);
        continue;
      }
      try {
        await transport.send(printer, encodeEscPos(job.document as PrintDocument));
        await db
          .update(s.printJobs)
          .set({ status: 'printed', printedAt: this.now(), attempts: job.attempts + 1 })
          .where(where);
        printed += 1;
        this.setHealth(printer.id, { ok: true, error: null }, job.kind === 'test');
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 255);
        const attempts = job.attempts + 1;
        const givesUp =
          job.kind === 'test' || now.getTime() - job.createdAt.getTime() >= GIVE_UP_MS;
        await db
          .update(s.printJobs)
          .set({
            status: givesUp ? 'failed' : 'pending',
            attempts,
            lastError: message,
            nextAttemptAt: new Date(
              now.getTime() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!,
            ),
          })
          .where(where);
        down.add(printer.id);
        this.setHealth(printer.id, { ok: false, error: message }, job.kind === 'test');
      }
    }
    return printed;
  }

  private setHealth(printerId: string, health: PrinterHealth, test: boolean) {
    const previous = this.health.get(printerId);
    const changed = !previous || previous.ok !== health.ok || previous.error !== health.error;
    this.health.set(printerId, health);
    if (changed) {
      this.options.broadcast?.({ type: 'printer.status', printerId, ...health });
    }
    if (changed || test) {
      this.pendingReports.set(printerId, {
        printerId,
        ...health,
        at: this.now().toISOString(),
        test: test || (this.pendingReports.get(printerId)?.test ?? false),
      });
    }
  }

  /** Printer health as last seen (for `/health`). */
  printers(): Record<string, PrinterHealth> {
    return Object.fromEntries(this.health);
  }

  /** Reports printer changes to the cloud; kept for the next round when it is unreachable. */
  async report(): Promise<void> {
    if (!this.options.cloud || this.pendingReports.size === 0) return;
    const reports = [...this.pendingReports.values()];
    try {
      await cloudJson(this.options.cloud, '/sync/printer-status', {
        method: 'POST',
        body: { printers: reports },
      });
      for (const report of reports) {
        if (this.pendingReports.get(report.printerId) === report) {
          this.pendingReports.delete(report.printerId);
        }
      }
    } catch {
      // Offline: the cloud learns it later.
    }
  }

  /** One full round, never two at once. */
  runOnce(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.plan();
        await this.dispatch();
        await this.report();
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Runs every `intervalMs` (retries) and whenever `kick()` is called (new operations). */
  start(intervalMs = 1_000): void {
    this.timer = setInterval(() => void this.runOnce().catch(() => undefined), intervalMs);
  }

  kick(): void {
    void this.runOnce().catch(() => undefined);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
