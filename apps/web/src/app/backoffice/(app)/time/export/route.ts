import { people, toApiError } from '@pos/api';
import { reportPeriodSchema, toCsv } from '@pos/core';
import { getTranslations } from 'next-intl/server';
import { currentActor, deps } from '@/server/actor';

/**
 * The timesheet of a period as CSV for the payroll (DEC-054): one row per entry, times in the
 * location's time zone, hours with two decimals. The service checks `time.manage`.
 */

/** "2026-11-23 09:02" in the location's time zone. */
function localTime(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const parsed = reportPeriodSchema.safeParse({ from: search.get('from'), to: search.get('to') });
  if (!parsed.success) return new Response('Invalid period', { status: 400 });
  const period = parsed.data;
  try {
    const sheet = await people.listTimeEntries(deps(), await currentActor(), period);
    const c = await getTranslations('time.columns');
    const t = await getTranslations('time.status');
    const body = toCsv(
      [
        c('person'),
        c('day'),
        c('in'),
        c('out'),
        c('hours'),
        c('minutes'),
        c('status'),
        c('corrected'),
        c('note'),
      ],
      sheet.entries.map((entry) => [
        entry.userName,
        entry.businessDate,
        localTime(entry.clockInAt, sheet.timezone),
        localTime(entry.clockOutAt, sheet.timezone),
        entry.minutes === null ? '' : (entry.minutes / 60).toFixed(2),
        entry.minutes === null ? '' : String(entry.minutes),
        t(entry.status),
        entry.corrected ? c('yes') : '',
        entry.note ?? '',
      ]),
    );
    return new Response(body, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="time-${period.from}-${period.to}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    const apiError = toApiError(error);
    return new Response(apiError.message, { status: apiError.status });
  }
}
