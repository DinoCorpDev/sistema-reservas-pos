import type { LocalMoment } from '../catalog/rules';

/**
 * Local wall-clock time of a location (IANA time zone), with `Intl` only: no dependencies.
 * Availability windows (RN-17) and the "86" return time (RF-B09) are local times, while the
 * database stores UTC instants.
 */

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(instant: Date, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  };
}

/** UTC offset of the time zone at this instant, in milliseconds (+02:00 = 7_200_000). */
function offsetMs(instant: number, timeZone: string): number {
  const w = wallClock(new Date(instant), timeZone);
  const wallAsUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return wallAsUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * Instants whose local wall clock equals `wall` (a local time expressed as if it were UTC),
 * earliest first: usually one, two in the autumn overlap. In the spring gap the time does not
 * exist and is moved forward by the length of the gap (02:30 → 03:30).
 */
function instantsAt(wall: number, timeZone: string): number[] {
  const before = offsetMs(wall - DAY_MS, timeZone);
  const after = offsetMs(wall + DAY_MS, timeZone);
  const valid = [...new Set([before, after])]
    .map((offset) => ({ offset, instant: wall - offset }))
    .filter(({ offset, instant }) => offsetMs(instant, timeZone) === offset)
    .map(({ instant }) => instant)
    .sort((a, b) => a - b);
  return valid.length > 0 ? valid : [wall - before];
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** Local date, time and ISO weekday of an instant in the location's time zone. */
export function localMoment(now: Date, timeZone: string): LocalMoment {
  const w = wallClock(now, timeZone);
  const weekday = new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
  return {
    now,
    date: `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`,
    time: `${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`,
    isoWeekday: weekday === 0 ? 7 : weekday,
  };
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * The next instant, strictly after `now`, whose local wall clock in `timeZone` is `hhmm`
 * (e.g. "04:00" = start of the next business day for an "86", RF-B09). DST-safe.
 */
export function nextLocalTime(now: Date, timeZone: string, hhmm: string): Date {
  const match = HHMM.exec(hhmm);
  if (!match) throw new RangeError(`Expected a local time HH:MM, got "${hhmm}"`);
  const [hour, minute] = [Number(match[1]), Number(match[2])];
  const today = wallClock(now, timeZone);
  for (let dayOffset = 0; dayOffset <= 2; dayOffset += 1) {
    const wall = Date.UTC(today.year, today.month - 1, today.day + dayOffset, hour, minute);
    const next = instantsAt(wall, timeZone).find((instant) => instant > now.getTime());
    if (next !== undefined) return new Date(next);
  }
  throw new RangeError(`No local time ${hhmm} found after ${now.toISOString()} in ${timeZone}`);
}
