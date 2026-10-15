import type { ReportPeriod } from '@pos/core';
import { Alert } from '@pos/ui/alert';
import { Button } from '@pos/ui/button';
import { Input } from '@pos/ui/input';
import { cn } from '@pos/ui/utils';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { PRESETS, periodQuery, presetPeriod } from './period';

/**
 * The period of a report: quick choices (today, this month…) and a free range in business days.
 * A plain form: the page reloads on the server with `?from=&to=`.
 */
export async function PeriodFilter({
  path,
  period,
  today,
  invalid,
  extra = {},
}: {
  path: string;
  period: ReportPeriod;
  today: string;
  invalid: boolean;
  /** Other parameters of the page to keep (e.g. the MWST grouping). */
  extra?: Record<string, string>;
}) {
  const t = await getTranslations('reports.period');
  const activePreset = PRESETS.find((preset) => {
    const range = presetPeriod(preset, today);
    return range.from === period.from && range.to === period.to;
  });
  return (
    <div className="mb-6 grid gap-3 print:hidden">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => {
          const range = presetPeriod(preset, today);
          // Two choices can be the same days (this month = this quarter on 1 October): the first.
          const active = preset === activePreset;
          return (
            <Button
              key={preset}
              asChild
              variant={active ? 'default' : 'outline'}
              className={cn('min-h-11')}
            >
              <Link
                href={`${path}?${periodQuery(range, extra)}`}
                aria-current={active ? 'true' : undefined}
              >
                {t(`presets.${preset}`)}
              </Link>
            </Button>
          );
        })}
      </div>
      <form className="flex flex-wrap items-end gap-2" action={path}>
        {Object.entries(extra).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <label className="grid gap-1 text-sm font-medium">
          {t('from')}
          <Input
            type="date"
            name="from"
            defaultValue={period.from}
            max={today}
            className="w-auto"
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {t('to')}
          <Input type="date" name="to" defaultValue={period.to} max={today} className="w-auto" />
        </label>
        <Button type="submit" variant="secondary">
          {t('show')}
        </Button>
      </form>
      {invalid && <Alert variant="warning">{t('invalid')}</Alert>}
    </div>
  );
}
