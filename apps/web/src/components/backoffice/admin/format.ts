import { localMoment } from '@pos/core';

/**
 * Swiss formats for the administration screens (dates `dd.MM.yyyy`, times in Zürich, rates with a
 * decimal comma). Pure functions with an explicit time zone, so server and client render the same.
 */

export const TIME_ZONE = 'Europe/Zurich';

const dateFormat = new Intl.DateTimeFormat('de-CH', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const timeFormat = new Intl.DateTimeFormat('de-CH', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const timeSecondsFormat = new Intl.DateTimeFormat('de-CH', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date `YYYY-MM-DD`. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Calendar date without time zone: `2026-10-06` → `06.10.2026`. */
export function formatIsoDate(value: string | null | undefined): string {
  if (!value) return '';
  const match = ISO_DATE.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

/** Instant (ISO string) → `06.10.2026` in Zürich. */
export function formatDate(instant: string): string {
  return dateFormat.format(new Date(instant));
}

/** Instant (ISO string) → `06.10.2026 14:05` (or `14:05:09`) in Zürich. */
export function formatDateTime(instant: string, options: { seconds?: boolean } = {}): string {
  const date = new Date(instant);
  return `${dateFormat.format(date)} ${(options.seconds ? timeSecondsFormat : timeFormat).format(date)}`;
}

/** Basis points → percentage with a decimal comma: 810 → `8,1 %`, 260 → `2,6 %`. */
export function formatRateBp(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const fraction = String(bp % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return `${whole}${fraction ? `,${fraction}` : ''} %`;
}

/**
 * Percentage typed by a person → basis points, without floating point: `8,1` / `8.1` / `8.10 %`
 * → 810. Null when it is not a number between 0 and 100 with at most two decimals.
 */
export function parsePercentToBp(text: string): number | null {
  const match = /^\s*(\d{1,3})(?:[.,](\d{1,2}))?\s*%?\s*$/.exec(text);
  if (!match) return null;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bp <= 10_000 ? bp : null;
}

function zurichParts(at: Date) {
  const parts = partsFormat.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Today's calendar date in Zürich, `YYYY-MM-DD`. */
export function todayInZurich(now: Date = new Date()): string {
  return localMoment(now, TIME_ZONE).date;
}

/** Offset of Zürich local time from UTC at an instant, in milliseconds. */
function zurichOffsetMs(at: number): number {
  const p = zurichParts(new Date(at));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - at;
}

/** Instant at which the calendar day `date` starts in Zürich, as an ISO string. */
export function zurichStartOfDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(year, month - 1, day);
  let instant = wall - zurichOffsetMs(wall);
  const corrected = wall - zurichOffsetMs(instant);
  if (corrected !== instant) instant = corrected;
  return new Date(instant).toISOString();
}

/** `2026-10-06` + 1 → `2026-10-07`. */
export function addDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** Swiss E.164 numbers in the usual groups: `+41791234567` → `+41 79 123 45 67`. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const swiss = /^\+41(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return swiss ? `+41 ${swiss[1]} ${swiss[2]} ${swiss[3]} ${swiss[4]}` : phone;
}

/** `Anna Muster`, or the fallback for a guest without a name (or an anonymized one). */
export const customerName = (
  customer: { firstName: string | null; lastName: string | null },
  fallback: string,
) => [customer.firstName, customer.lastName].filter(Boolean).join(' ') || fallback;

/** First block of a UUID, for compact display of ids without a name. */
export const shortId = (id: string) => id.slice(0, 8);

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
