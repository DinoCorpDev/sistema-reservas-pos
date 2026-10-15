import type { PresenceEntry, PresenceReport } from '@pos/core';
import { type Database, schema as s, type Transaction } from '@pos/db';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { type Actor, requireTerminal } from '../../actor';
import { ApiError } from '../../errors';
import type { ServiceDeps } from '../shared';
import type { SyncScope } from './store';

/**
 * Who is signed in on each device. Every device says on each pull whether someone unlocked it;
 * every node keeps the latest per terminal. The POS decides from it where to send (a kitchen
 * display nobody attends, DEC-033) and whether a PIN may open (one device per person, DEC-040).
 * The hub and the cloud exchange it, so a device on one sees a device on the other.
 */

/** Presence older than this is not worth exchanging or showing. */
const RECENT_MS = 10 * 60_000;

/** Stores presence entries, keeping the newest per terminal. */
export async function recordPresence(
  db: Database | Transaction,
  scope: SyncScope,
  entries: readonly {
    terminalId: string;
    unlocked: boolean;
    userId: string | null;
    stationId?: string | null;
    lastSeenAt: Date;
  }[],
): Promise<void> {
  for (const entry of entries) {
    const values = {
      unlocked: entry.unlocked,
      userId: entry.userId,
      stationId: entry.unlocked ? (entry.stationId ?? null) : null,
      lastSeenAt: entry.lastSeenAt,
    };
    await db
      .insert(s.terminalPresence)
      .values({
        id: entry.terminalId,
        organizationId: scope.organizationId,
        locationId: scope.locationId,
        ...values,
      })
      .onDuplicateKeyUpdate({
        // A late report never overwrites a newer one.
        set: {
          unlocked: sql`if(values(last_seen_at) >= last_seen_at, values(unlocked), unlocked)`,
          userId: sql`if(values(last_seen_at) >= last_seen_at, values(user_id), user_id)`,
          stationId: sql`if(values(last_seen_at) >= last_seen_at, values(station_id), station_id)`,
          lastSeenAt: sql`greatest(last_seen_at, values(last_seen_at))`,
        },
      });
  }
}

/** The devices of the location seen recently, with who is signed in, for the POS and the hub. */
export async function listPresence(
  db: Database,
  scope: SyncScope,
  now = new Date(),
): Promise<
  (PresenceEntry & { userId: string | null; stationId: string | null; terminalName: string })[]
> {
  const rows = await db
    .select({
      terminalId: s.terminalPresence.id,
      unlocked: s.terminalPresence.unlocked,
      userId: s.terminalPresence.userId,
      stationId: s.terminalPresence.stationId,
      lastSeenAt: s.terminalPresence.lastSeenAt,
      terminalName: s.terminals.name,
    })
    .from(s.terminalPresence)
    .innerJoin(
      s.terminals,
      and(eq(s.terminals.id, s.terminalPresence.id), isNull(s.terminals.deletedAt)),
    )
    .where(
      and(
        eq(s.terminalPresence.organizationId, scope.organizationId),
        eq(s.terminalPresence.locationId, scope.locationId),
        gt(s.terminalPresence.lastSeenAt, new Date(now.getTime() - RECENT_MS)),
      ),
    );
  return rows.map((row) => ({ ...row, lastSeenAt: row.lastSeenAt.toISOString() }));
}

/**
 * `POST /sync/presence` (cloud): the hub hands over who is at the displays on the LAN. Only for
 * terminals of its own location.
 */
export async function reportPresence(
  deps: ServiceDeps,
  actor: Actor,
  input: PresenceReport,
): Promise<{ stored: number }> {
  const { locationId } = requireTerminal(actor);
  if (actor.terminalType !== 'hub') {
    throw new ApiError('FORBIDDEN', 'Only the location hub reports presence');
  }
  const scope = { organizationId: actor.organizationId, locationId };
  const ids = input.entries.map((e) => e.terminalId);
  const own =
    ids.length === 0
      ? []
      : await deps.db
          .select({ id: s.terminals.id })
          .from(s.terminals)
          .where(
            and(
              eq(s.terminals.organizationId, actor.organizationId),
              eq(s.terminals.locationId, locationId),
              inArray(s.terminals.id, ids),
            ),
          );
  const ours = new Set(own.map((t) => t.id));
  const entries = input.entries
    .filter((e) => ours.has(e.terminalId))
    .map((e) => ({ ...e, lastSeenAt: new Date(e.lastSeenAt) }));
  await recordPresence(deps.db, scope, entries);
  return { stored: entries.length };
}
