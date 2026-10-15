import type { PresenceSnapshot } from '../kitchen/routing';

/**
 * One person, one device at a time (DEC-040): a PIN does not open a second device while its
 * person is signed in on another one. Every device reports on each pull whether someone is
 * signed in (2 s while in use, 30 s in a hidden tab), so a session not seen for this long is
 * over: a device switched off without locking frees its person after at most this time.
 */
export const SESSION_WINDOW_MS = 90_000;

/**
 * The other device where this person is signed in right now, or null. Without fresh presence
 * (the device has not reached the hub or the cloud for a while) nothing is known, and the PIN
 * opens: the restaurant never stops because of the network.
 */
export function signedInElsewhere(
  presence: PresenceSnapshot | null,
  input: { userId: string; terminalId: string; now: number },
): { terminalId: string; terminalName: string | null } | null {
  if (!presence) return null;
  const sinceReceived = input.now - presence.receivedAt;
  if (sinceReceived >= SESSION_WINDOW_MS) return null;
  const serverNow = Date.parse(presence.serverTime) + Math.max(0, sinceReceived);
  for (const entry of presence.entries) {
    if (!entry.unlocked || entry.userId !== input.userId) continue;
    if (entry.terminalId === input.terminalId) continue;
    if (serverNow - Date.parse(entry.lastSeenAt) >= SESSION_WINDOW_MS) continue;
    return { terminalId: entry.terminalId, terminalName: entry.terminalName ?? null };
  }
  return null;
}
