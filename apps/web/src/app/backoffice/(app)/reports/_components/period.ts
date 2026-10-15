import { addDays, type ReportPeriod, reportPeriodSchema } from '@pos/core';

/** Quick periods of the report filter, relative to today's business day (DEC-022). */
export const PRESETS = [
  'today',
  'yesterday',
  'thisWeek',
  'lastWeek',
  'thisMonth',
  'lastMonth',
  'thisQuarter',
  'thisYear',
] as const;
export type Preset = (typeof PRESETS)[number];

const isoWeekday = (date: string) => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
};

const monthStart = (date: string) => `${date.slice(0, 7)}-01`;

export function presetPeriod(preset: Preset, today: string): ReportPeriod {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const day = addDays(today, -1);
      return { from: day, to: day };
    }
    case 'thisWeek':
      return { from: addDays(today, 1 - isoWeekday(today)), to: today };
    case 'lastWeek': {
      const monday = addDays(today, 1 - isoWeekday(today) - 7);
      return { from: monday, to: addDays(monday, 6) };
    }
    case 'thisMonth':
      return { from: monthStart(today), to: today };
    case 'lastMonth': {
      const lastDay = addDays(monthStart(today), -1);
      return { from: monthStart(lastDay), to: lastDay };
    }
    case 'thisQuarter': {
      const month = Number(today.slice(5, 7));
      const first = Math.floor((month - 1) / 3) * 3 + 1;
      return { from: `${today.slice(0, 4)}-${String(first).padStart(2, '0')}-01`, to: today };
    }
    case 'thisYear':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

/** The period of the URL (`?from=&to=`), or this month when it is missing or invalid. */
export function periodOf(
  params: Record<string, string | string[] | undefined>,
  today: string,
): { period: ReportPeriod; invalid: boolean } {
  if (params.from === undefined && params.to === undefined) {
    return { period: presetPeriod('thisMonth', today), invalid: false };
  }
  const parsed = reportPeriodSchema.safeParse({ from: params.from, to: params.to });
  return parsed.success
    ? { period: parsed.data, invalid: false }
    : { period: presetPeriod('thisMonth', today), invalid: true };
}

/** `?from=…&to=…` plus extra parameters, for links that keep the period. */
export const periodQuery = (period: ReportPeriod, extra: Record<string, string> = {}) =>
  new URLSearchParams({ from: period.from, to: period.to, ...extra }).toString();
