/**
 * Hybrid logical clock (docs/SYNC.md §3). Every operation carries an HLC so all nodes fold
 * operations in the same canonical order `(hlc, id)` and causality between devices holds: an
 * operation made after seeing another one always sorts after it.
 *
 * Format: `"<milliseconds, 13 digits>.<counter, 4 digits>"`, fixed width, so plain string
 * comparison is the clock order.
 */

export type Hlc = string;

export interface HlcState {
  physical: number;
  counter: number;
}

const HLC_PATTERN = /^(\d{13})\.(\d{4})$/;
const MAX_COUNTER = 9999;

export const HLC_ZERO: HlcState = { physical: 0, counter: 0 };

export function isHlc(value: string): boolean {
  return HLC_PATTERN.test(value);
}

export function formatHlc(state: HlcState): Hlc {
  return `${String(state.physical).padStart(13, '0')}.${String(state.counter).padStart(4, '0')}`;
}

export function parseHlc(hlc: Hlc): HlcState {
  const match = HLC_PATTERN.exec(hlc);
  if (!match) throw new RangeError(`Invalid HLC "${hlc}"`);
  return { physical: Number(match[1]), counter: Number(match[2]) };
}

function advance(physical: number, last: HlcState): HlcState {
  if (physical > last.physical) return { physical, counter: 0 };
  if (last.counter < MAX_COUNTER) return { physical: last.physical, counter: last.counter + 1 };
  // Counter exhausted within one millisecond: borrow the next millisecond.
  return { physical: last.physical + 1, counter: 0 };
}

/** Clock for a new local operation, from the last state and the corrected wall clock. */
export function tickHlc(last: HlcState, nowMs: number): HlcState {
  return advance(Math.max(Math.trunc(nowMs), last.physical), last);
}

/**
 * Records an HLC received from another node (pull, WebSocket): the local clock becomes the later
 * of both, so the next `tickHlc` sorts after everything this device has seen.
 */
export function receiveHlc(last: HlcState, remote: Hlc): HlcState {
  const seen = parseHlc(remote);
  const later =
    seen.physical > last.physical ||
    (seen.physical === last.physical && seen.counter > last.counter);
  return later ? seen : last;
}

/** Canonical order of operations: HLC first, operation id as tie-breaker. */
export function compareOperations(
  a: { hlc: Hlc; id: string },
  b: { hlc: Hlc; id: string },
): number {
  if (a.hlc !== b.hlc) return a.hlc < b.hlc ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Maximum lead of a device clock over the receiving server before it is clamped (§3). */
export const MAX_CLOCK_LEAD_MS = 5 * 60_000;

/**
 * Clamps an HLC that runs too far ahead of the receiving server's clock, so a fast device clock
 * cannot win every last-writer-wins comparison. Returns the original when it is acceptable.
 */
export function clampHlc(hlc: Hlc, serverNowMs: number): { hlc: Hlc; clamped: boolean } {
  const state = parseHlc(hlc);
  if (state.physical <= serverNowMs + MAX_CLOCK_LEAD_MS) return { hlc, clamped: false };
  return {
    hlc: formatHlc({ physical: Math.trunc(serverNowMs), counter: state.counter }),
    clamped: true,
  };
}
