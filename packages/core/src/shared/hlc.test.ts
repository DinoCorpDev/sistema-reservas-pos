import { describe, expect, it } from 'vitest';
import {
  clampHlc,
  compareOperations,
  formatHlc,
  HLC_ZERO,
  isHlc,
  MAX_CLOCK_LEAD_MS,
  parseHlc,
  receiveHlc,
  tickHlc,
} from './hlc';

const T = 1_791_234_567_890;

describe('hybrid logical clock (docs/SYNC.md §3)', () => {
  it('formats with a fixed width so string order is clock order', () => {
    expect(formatHlc({ physical: T, counter: 3 })).toBe('1791234567890.0003');
    expect(parseHlc('1791234567890.0003')).toEqual({ physical: T, counter: 3 });
    expect(isHlc('1791234567890.0003')).toBe(true);
    expect(isHlc('179123456789.3')).toBe(false);
    expect(formatHlc({ physical: 9, counter: 0 }) < formatHlc({ physical: 10, counter: 0 })).toBe(
      true,
    );
  });

  it('ticks forward with the wall clock and counts within the same millisecond', () => {
    const first = tickHlc(HLC_ZERO, T);
    expect(first).toEqual({ physical: T, counter: 0 });
    const second = tickHlc(first, T);
    expect(second).toEqual({ physical: T, counter: 1 });
    expect(tickHlc(second, T + 5)).toEqual({ physical: T + 5, counter: 0 });
  });

  it('never goes backwards when the wall clock does', () => {
    const state = tickHlc(HLC_ZERO, T);
    expect(tickHlc(state, T - 60_000)).toEqual({ physical: T, counter: 1 });
  });

  it('borrows the next millisecond when the counter is exhausted', () => {
    expect(tickHlc({ physical: T, counter: 9999 }, T)).toEqual({ physical: T + 1, counter: 0 });
  });

  it('keeps causality: after seeing a remote operation, the next local one sorts after it', () => {
    // Device B's clock is 2 minutes behind device A.
    const remote = formatHlc({ physical: T, counter: 4 });
    const local = receiveHlc(tickHlc(HLC_ZERO, T - 120_000), remote);
    const next = formatHlc(tickHlc(local, T - 119_000));
    expect(next > remote).toBe(true);
  });

  it('ignores a remote clock that is behind', () => {
    const local = { physical: T, counter: 2 };
    expect(receiveHlc(local, formatHlc({ physical: T - 1, counter: 9 }))).toBe(local);
  });

  it('orders operations by HLC and then by id', () => {
    const ops = [
      { hlc: '1791234567890.0001', id: 'b' },
      { hlc: '1791234567890.0001', id: 'a' },
      { hlc: '1791234567889.0005', id: 'z' },
    ];
    expect([...ops].sort(compareOperations).map((op) => op.id)).toEqual(['z', 'a', 'b']);
  });

  it('clamps a clock running more than 5 minutes ahead of the server', () => {
    const fine = formatHlc({ physical: T + MAX_CLOCK_LEAD_MS, counter: 1 });
    expect(clampHlc(fine, T)).toEqual({ hlc: fine, clamped: false });
    const ahead = formatHlc({ physical: T + MAX_CLOCK_LEAD_MS + 1, counter: 7 });
    expect(clampHlc(ahead, T)).toEqual({
      hlc: formatHlc({ physical: T, counter: 7 }),
      clamped: true,
    });
  });
});
