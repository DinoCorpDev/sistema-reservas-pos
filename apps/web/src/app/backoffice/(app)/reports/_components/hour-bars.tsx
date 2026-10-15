'use client';

import { formatChf, rappen } from '@pos/core';
import { Tooltip } from '@pos/ui/tooltip';
import { useTranslations } from 'next-intl';

/**
 * Sales by hour as thin bars of one hue (one series: no legend, the title names it). Each bar
 * shows its hour and amount on hover or focus; the table next to it carries the same figures.
 */
export function HourBars({ hours }: { hours: { key: number; salesRappen: number }[] }) {
  const t = useTranslations('reports.sales');
  const highest = Math.max(1, ...hours.map((hour) => hour.salesRappen));
  return (
    <figure className="grid gap-2" aria-label={t('hourChart')}>
      <div className="flex h-40 items-end gap-0.5 border-b border-border" role="list">
        {hours.map((hour) => {
          const share = Math.max(0, hour.salesRappen) / highest;
          const label = t('hourTooltip', {
            hour: String(hour.key).padStart(2, '0'),
            amount: formatChf(rappen(hour.salesRappen)),
          });
          return (
            <Tooltip key={hour.key} content={label}>
              <button
                type="button"
                role="listitem"
                aria-label={label}
                className="group flex h-full min-w-0 flex-1 items-end focus-visible:outline-2"
              >
                <span
                  className="w-full rounded-t-[4px] bg-primary/80 transition-colors group-hover:bg-primary"
                  style={{ height: `${share * 100}%`, minHeight: hour.salesRappen > 0 ? 2 : 0 }}
                />
              </button>
            </Tooltip>
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
        {[0, 6, 12, 18, 23].map((hour) => (
          <span key={hour}>{String(hour).padStart(2, '0')}:00</span>
        ))}
      </div>
    </figure>
  );
}
