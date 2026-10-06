import { asc, eq, isNull, lt, sql, and } from 'drizzle-orm';
import type { Database } from './client';
import { outboxEvents } from './schema';

export type OutboxEvent = typeof outboxEvents.$inferSelect;

export interface PublishResult {
  published: number;
  failed: number;
}

/**
 * Delivers pending outbox events in recording order (PA-10). Rows are locked with
 * `FOR UPDATE SKIP LOCKED`, so several workers never deliver the same event at once. A failing
 * event keeps its place, counts an attempt and stores the error; after `maxAttempts` it stops
 * being retried and shows up in monitoring (Phase 6). Consumers must be idempotent by event id.
 */
export async function publishPending(
  db: Database,
  handler: (event: OutboxEvent) => Promise<void>,
  options: { batchSize?: number; maxAttempts?: number } = {},
): Promise<PublishResult> {
  const { batchSize = 100, maxAttempts = 10 } = options;
  return db.transaction(async (tx) => {
    const pending = await tx
      .select()
      .from(outboxEvents)
      .where(and(isNull(outboxEvents.publishedAt), lt(outboxEvents.attempts, maxAttempts)))
      .orderBy(asc(outboxEvents.recordedAt), asc(outboxEvents.id))
      .limit(batchSize)
      .for('update', { skipLocked: true });

    let published = 0;
    let failed = 0;
    for (const event of pending) {
      try {
        await handler(event);
        await tx
          .update(outboxEvents)
          .set({ publishedAt: new Date(), attempts: sql`${outboxEvents.attempts} + 1`, lastError: null })
          .where(eq(outboxEvents.id, event.id));
        published += 1;
      } catch (error) {
        await tx
          .update(outboxEvents)
          .set({
            attempts: sql`${outboxEvents.attempts} + 1`,
            lastError: error instanceof Error ? error.message.slice(0, 2000) : String(error),
          })
          .where(eq(outboxEvents.id, event.id));
        failed += 1;
      }
    }
    return { published, failed };
  });
}
