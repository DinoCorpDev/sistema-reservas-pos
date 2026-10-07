import { formatHlc, HLC_ZERO, type HlcState, receiveHlc, tickHlc } from '@pos/core';
import { getMeta, setMeta } from './db';

/**
 * Device clock (docs/SYNC.md §3): the wall clock corrected by the offset measured against the
 * server, and the hybrid logical clock that orders every operation of this device after
 * everything it has seen.
 */

let offsetMs = 0;
let samples: number[] = [];
let hlc: HlcState = HLC_ZERO;

export async function loadClock(): Promise<void> {
  offsetMs = (await getMeta('clockOffset')) ?? 0;
  hlc = (await getMeta('hlc')) ?? HLC_ZERO;
}

/** Current time corrected with the server offset. */
export function correctedNow(): number {
  return Date.now() + offsetMs;
}

/** Records one offset sample (server time − local time at the middle of the request). */
export async function recordServerTime(serverTime: string, sentAt: number, receivedAt: number) {
  const sample = Date.parse(serverTime) - (sentAt + receivedAt) / 2;
  if (!Number.isFinite(sample)) return;
  samples = [...samples.slice(-6), sample];
  const sorted = [...samples].sort((a, b) => a - b);
  offsetMs = Math.round(sorted[Math.floor(sorted.length / 2)]!);
  await setMeta('clockOffset', offsetMs);
}

/** Clock of a new local operation; persisted so a reload never goes back in time. */
export async function nextHlc(): Promise<{ hlc: string; deviceAt: string }> {
  hlc = tickHlc(hlc, correctedNow());
  await setMeta('hlc', hlc);
  return { hlc: formatHlc(hlc), deviceAt: new Date(hlc.physical).toISOString() };
}

/** Moves the clock past operations received from other devices. */
export async function observeHlc(values: readonly string[]): Promise<void> {
  if (values.length === 0) return;
  for (const value of values) hlc = receiveHlc(hlc, value);
  await setMeta('hlc', hlc);
}
