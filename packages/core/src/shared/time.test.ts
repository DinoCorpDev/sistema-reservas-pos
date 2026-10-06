import { describe, expect, it } from 'vitest';
import { localMoment, nextLocalTime } from './time';

const ZH = 'Europe/Zurich';
const at = (iso: string) => new Date(iso);

describe('localMoment', () => {
  it('converts an instant to the local date, time and ISO weekday', () => {
    expect(localMoment(at('2026-10-06T10:15:00Z'), ZH)).toEqual({
      now: at('2026-10-06T10:15:00Z'),
      date: '2026-10-06',
      time: '12:15:00',
      isoWeekday: 2,
    });
    expect(localMoment(at('2026-10-06T10:15:00Z'), 'UTC')).toMatchObject({ time: '10:15:00' });
  });

  it('crosses midnight into the next local day and weekday', () => {
    expect(localMoment(at('2026-10-11T21:59:59Z'), ZH)).toMatchObject({
      date: '2026-10-11',
      time: '23:59:59',
      isoWeekday: 7,
    });
    expect(localMoment(at('2026-10-11T22:00:00Z'), ZH)).toMatchObject({
      date: '2026-10-12',
      time: '00:00:00',
      isoWeekday: 1,
    });
    expect(localMoment(at('2026-12-31T23:30:00Z'), ZH)).toMatchObject({
      date: '2027-01-01',
      time: '00:30:00',
      isoWeekday: 5,
    });
  });

  it('follows the spring DST change (2026-03-29, 02:00 → 03:00)', () => {
    expect(localMoment(at('2026-03-29T00:59:59Z'), ZH).time).toBe('01:59:59');
    expect(localMoment(at('2026-03-29T01:00:00Z'), ZH).time).toBe('03:00:00');
  });

  it('follows the autumn DST change (2026-10-25, 03:00 → 02:00)', () => {
    expect(localMoment(at('2026-10-25T00:30:00Z'), ZH).time).toBe('02:30:00');
    expect(localMoment(at('2026-10-25T01:30:00Z'), ZH).time).toBe('02:30:00');
    expect(localMoment(at('2026-10-25T01:30:00Z'), ZH).isoWeekday).toBe(7);
  });
});

describe('nextLocalTime', () => {
  it('returns today when the time is still ahead, otherwise tomorrow', () => {
    expect(nextLocalTime(at('2026-10-06T01:00:00Z'), ZH, '04:00')).toEqual(
      at('2026-10-06T02:00:00Z'),
    );
    expect(nextLocalTime(at('2026-10-06T10:15:00Z'), ZH, '04:00')).toEqual(
      at('2026-10-07T02:00:00Z'),
    );
  });

  it('is strictly after now', () => {
    expect(nextLocalTime(at('2026-10-06T02:00:00Z'), ZH, '04:00')).toEqual(
      at('2026-10-07T02:00:00Z'),
    );
  });

  it('crosses midnight', () => {
    expect(nextLocalTime(at('2026-10-06T21:30:00Z'), ZH, '00:00')).toEqual(
      at('2026-10-06T22:00:00Z'),
    );
    expect(nextLocalTime(at('2026-12-31T22:30:00Z'), ZH, '04:00')).toEqual(
      at('2027-01-01T03:00:00Z'),
    );
  });

  it('uses the new offset after the spring DST change', () => {
    // 22:00 CET on Saturday → 04:00 CEST on Sunday.
    expect(nextLocalTime(at('2026-03-28T21:00:00Z'), ZH, '04:00')).toEqual(
      at('2026-03-29T02:00:00Z'),
    );
    // 02:30 does not exist that night: moved forward to 03:30 CEST.
    expect(nextLocalTime(at('2026-03-28T21:00:00Z'), ZH, '02:30')).toEqual(
      at('2026-03-29T01:30:00Z'),
    );
  });

  it('uses the new offset after the autumn DST change and handles the repeated hour', () => {
    // 22:00 CEST on Saturday → 04:00 CET on Sunday.
    expect(nextLocalTime(at('2026-10-24T20:00:00Z'), ZH, '04:00')).toEqual(
      at('2026-10-25T03:00:00Z'),
    );
    // 02:30 happens twice: first in CEST, then in CET.
    expect(nextLocalTime(at('2026-10-24T20:00:00Z'), ZH, '02:30')).toEqual(
      at('2026-10-25T00:30:00Z'),
    );
    expect(nextLocalTime(at('2026-10-25T00:45:00Z'), ZH, '02:30')).toEqual(
      at('2026-10-25T01:30:00Z'),
    );
    expect(nextLocalTime(at('2026-10-25T01:30:00Z'), ZH, '02:30')).toEqual(
      at('2026-10-26T01:30:00Z'),
    );
  });

  it('rejects malformed times', () => {
    expect(() => nextLocalTime(at('2026-10-06T10:15:00Z'), ZH, '4:00')).toThrow(RangeError);
    expect(() => nextLocalTime(at('2026-10-06T10:15:00Z'), ZH, '24:00')).toThrow(RangeError);
  });
});
