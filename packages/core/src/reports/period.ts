import { z } from 'zod';
import { addDays } from '../shared/time';
import type { IsoDate } from '../tax/calculation';

/**
 * The period of a report: business days from `from` to `to`, both included (DEC-022). At most a
 * year, so a report never reads more than one fiscal year at once.
 */
export const REPORT_MAX_DAYS = 366;

export const VAT_GRANULARITIES = ['day', 'month', 'quarter', 'half', 'year'] as const;
export type VatGranularity = (typeof VAT_GRANULARITIES)[number];

/** Whole days from `from` to `to`, both included (`2026-10-01`…`2026-10-31` = 31). */
export function daysInPeriod(from: IsoDate, to: IsoDate): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

export const reportPeriodSchema = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((period) => period.from <= period.to, { message: 'from is after to', path: ['to'] })
  .refine((period) => daysInPeriod(period.from, period.to) <= REPORT_MAX_DAYS, {
    message: `A report covers at most ${REPORT_MAX_DAYS} days`,
    path: ['to'],
  });
export type ReportPeriod = z.infer<typeof reportPeriodSchema>;

export const vatReportQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    granularity: z.enum(VAT_GRANULARITIES).default('month'),
  })
  .refine((period) => period.from <= period.to, { message: 'from is after to', path: ['to'] })
  .refine((period) => daysInPeriod(period.from, period.to) <= REPORT_MAX_DAYS, {
    message: `A report covers at most ${REPORT_MAX_DAYS} days`,
    path: ['to'],
  });

/** The period of the same length right before (RF-F01: compared with the previous period). */
export function previousPeriod(period: ReportPeriod): ReportPeriod {
  const length = daysInPeriod(period.from, period.to);
  return { from: addDays(period.from, -length), to: addDays(period.from, -1) };
}

/**
 * The bucket of a business day for the MWST report (RF-F02): the day, `2026-10`, `2026-Q4`,
 * `2026-H2` or `2026`. Quarters and halves are those of the MWST settlement periods.
 */
export function periodKey(date: IsoDate, granularity: VatGranularity): string {
  const year = date.slice(0, 4);
  const month = Number(date.slice(5, 7));
  switch (granularity) {
    case 'day':
      return date;
    case 'month':
      return date.slice(0, 7);
    case 'quarter':
      return `${year}-Q${Math.ceil(month / 3)}`;
    case 'half':
      return `${year}-H${month <= 6 ? 1 : 2}`;
    case 'year':
      return year;
  }
}
