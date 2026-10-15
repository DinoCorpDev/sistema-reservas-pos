import { describe, expect, it } from 'vitest';
import type { PresenceEntry, PresenceSnapshot } from '../kitchen/routing';
import { SESSION_WINDOW_MS, signedInElsewhere } from './sessions';

const SERVER = Date.parse('2026-10-14T18:00:00Z');
const RECEIVED = 1_000_000;
const ME = { userId: 'anna', terminalId: 'handheld-1' };

const snapshot = (entries: PresenceEntry[], receivedAt = RECEIVED): PresenceSnapshot => ({
  entries,
  serverTime: new Date(SERVER).toISOString(),
  receivedAt,
});
const seen = (terminalId: string, userId: string | null, agoMs: number, unlocked = true) => ({
  terminalId,
  terminalName: terminalId.toUpperCase(),
  unlocked,
  userId,
  lastSeenAt: new Date(SERVER - agoMs).toISOString(),
});

describe('signedInElsewhere (DEC-040)', () => {
  it('finds the other device where the person is signed in', () => {
    const presence = snapshot([seen('kasse-1', 'anna', 3_000)]);
    expect(signedInElsewhere(presence, { ...ME, now: RECEIVED + 500 })).toEqual({
      terminalId: 'kasse-1',
      terminalName: 'KASSE-1',
    });
  });

  it('ignores this device, other people and locked devices', () => {
    const presence = snapshot([
      seen('handheld-1', 'anna', 1_000),
      seen('kasse-1', 'lea', 1_000),
      seen('kasse-2', 'anna', 1_000, false),
    ]);
    expect(signedInElsewhere(presence, { ...ME, now: RECEIVED })).toBeNull();
  });

  it('a device not seen for the window has ended its session', () => {
    const old = snapshot([seen('kasse-1', 'anna', SESSION_WINDOW_MS)]);
    expect(signedInElsewhere(old, { ...ME, now: RECEIVED })).toBeNull();
    // Time passes on this device too after the snapshot arrived.
    const fresh = snapshot([seen('kasse-1', 'anna', SESSION_WINDOW_MS - 10_000)]);
    expect(signedInElsewhere(fresh, { ...ME, now: RECEIVED + 20_000 })).toBeNull();
  });

  it('without fresh presence (offline) nothing is known and the PIN opens', () => {
    expect(signedInElsewhere(null, { ...ME, now: RECEIVED })).toBeNull();
    const stale = snapshot([seen('kasse-1', 'anna', 1_000)]);
    expect(signedInElsewhere(stale, { ...ME, now: RECEIVED + SESSION_WINDOW_MS })).toBeNull();
  });
});
