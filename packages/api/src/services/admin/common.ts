import { inOrg, notDeleted, schema as s, type TenantContext } from '@pos/db';
import { eq } from 'drizzle-orm';
import type { Actor } from '../../actor';
import type { ServiceDeps } from '../shared';

/** Time zone used when the caller has no location (DEC-004: Zürich). */
export const DEFAULT_TIME_ZONE = 'Europe/Zurich';

/** Calendar date `YYYY-MM-DD` of an instant in a time zone (MWST validity is per local date). */
export function localDate(timeZone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Time zone of the caller's location, or Zürich when the caller acts at organization level. */
export async function actorTimeZone(deps: ServiceDeps, actor: Actor): Promise<string> {
  if (!actor.locationId) return DEFAULT_TIME_ZONE;
  const [location] = await deps.db
    .select({ timezone: s.locations.timezone })
    .from(s.locations)
    .where(
      inOrg(s.locations, actor, eq(s.locations.id, actor.locationId), notDeleted(s.locations)),
    );
  return location?.timezone ?? DEFAULT_TIME_ZONE;
}

/**
 * Context for `runCommand`: what DINOLABS support does inside an organization is recorded with
 * `support:<staffId>` as request id, so the owner sees it in the audit (RF-A10, RF-F11).
 */
export function commandContext(actor: Actor): TenantContext {
  return actor.kind === 'support' && actor.supportStaffId
    ? { ...actor, requestId: `support:${actor.supportStaffId}` }
    : actor;
}

/** Escapes `%`, `_` and `\` so user input matches literally inside a LIKE pattern. */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);
