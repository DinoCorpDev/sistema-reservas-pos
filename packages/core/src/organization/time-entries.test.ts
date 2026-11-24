import { describe, expect, it } from 'vitest';
import {
  correctTimeEntrySchema,
  formatWorked,
  hoursByPerson,
  openTimeEntryOf,
  timeEntryStatus,
  workedMinutes,
} from './time-entries';

const NOW = new Date('2026-11-23T18:00:00.000Z');
const entry = (
  id: string,
  userId: string,
  clockInAt: string | null,
  clockOutAt: string | null = null,
) => ({ id, userId, clockInAt, clockOutAt });

describe('working time (RF-A09, DEC-054)', () => {
  it('counts whole minutes of a closed entry', () => {
    const closed = entry('a', 'u1', '2026-11-23T08:00:00.000Z', '2026-11-23T16:29:59.000Z');
    expect(workedMinutes(closed)).toBe(509);
    expect(workedMinutes(entry('b', 'u1', '2026-11-23T08:00:00.000Z'))).toBeNull();
    expect(workedMinutes(entry('c', 'u1', null, '2026-11-23T16:00:00.000Z'))).toBeNull();
  });

  it('never counts negative time', () => {
    expect(workedMinutes(entry('a', 'u1', '2026-11-23T10:00:00Z', '2026-11-23T09:00:00Z'))).toBe(0);
  });

  it('tells open, closed, a forgotten exit and an exit without entry apart', () => {
    expect(timeEntryStatus(entry('a', 'u1', '2026-11-23T09:00:00Z'), NOW)).toBe('open');
    expect(timeEntryStatus(entry('a', 'u1', '2026-11-23T01:59:00Z'), NOW)).toBe('missing_out');
    expect(
      timeEntryStatus(entry('a', 'u1', '2026-11-23T09:00:00Z', '2026-11-23T17:00:00Z'), NOW),
    ).toBe('closed');
    expect(timeEntryStatus(entry('a', 'u1', null, '2026-11-23T17:00:00Z'), NOW)).toBe('missing_in');
  });

  it('finds the open entry of a person, the latest one, ignoring forgotten exits', () => {
    const entries = [
      entry('old', 'u1', '2026-11-22T09:00:00Z'),
      entry('closed', 'u1', '2026-11-23T07:00:00Z', '2026-11-23T08:00:00Z'),
      entry('now', 'u1', '2026-11-23T09:00:00Z'),
      entry('other', 'u2', '2026-11-23T10:00:00Z'),
    ];
    expect(openTimeEntryOf(entries, 'u1', NOW)?.id).toBe('now');
    expect(openTimeEntryOf(entries.slice(0, 2), 'u1', NOW)).toBeNull();
    expect(openTimeEntryOf(entries, 'u3', NOW)).toBeNull();
  });

  it('adds up hours per person and counts what the manager has to complete', () => {
    const entries = [
      entry('a', 'u1', '2026-11-22T08:00:00Z', '2026-11-22T16:00:00Z'),
      entry('b', 'u1', '2026-11-23T08:00:00Z', '2026-11-23T12:30:00Z'),
      entry('c', 'u1', '2026-11-21T08:00:00Z'),
      entry('d', 'u2', '2026-11-23T15:00:00Z'),
      entry('e', 'u2', null, '2026-11-23T11:00:00Z'),
    ];
    expect(hoursByPerson(entries, NOW)).toEqual([
      { userId: 'u1', entries: 2, minutes: 750, incomplete: 1 },
      { userId: 'u2', entries: 0, minutes: 0, incomplete: 1 },
    ]);
  });

  it('formats worked time as hours and padded minutes', () => {
    expect(formatWorked(425)).toBe('7 h 05');
    expect(formatWorked(0)).toBe('0 h 00');
    expect(formatWorked(-3)).toBe('0 h 00');
  });

  describe('correction', () => {
    const base = { clockInAt: '2026-11-23T08:00:00.000Z', note: 'Vergessen auszustempeln' };

    it('accepts an exit after the entry, or none', () => {
      expect(
        correctTimeEntrySchema.safeParse({ ...base, clockOutAt: '2026-11-23T16:00:00.000Z' })
          .success,
      ).toBe(true);
      expect(correctTimeEntrySchema.safeParse({ ...base, clockOutAt: null }).success).toBe(true);
    });

    it('rejects an exit before the entry or more than a day later', () => {
      for (const clockOutAt of ['2026-11-23T07:59:00.000Z', '2026-11-24T08:00:01.000Z']) {
        const result = correctTimeEntrySchema.safeParse({ ...base, clockOutAt });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(['clockOutAt']);
      }
    });

    it('needs a reason', () => {
      const result = correctTimeEntrySchema.safeParse({ ...base, note: '  ', clockOutAt: null });
      expect(result.success).toBe(false);
    });
  });
});
