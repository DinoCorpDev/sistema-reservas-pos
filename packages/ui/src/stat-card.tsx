import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconTile } from './card';
import { cn } from './utils';

export type Trend = { direction: 'up' | 'down' | 'flat'; label: ReactNode };

/**
 * A key figure (DEC-053): an icon tile, what it measures, the value in tabular figures, a line
 * of context and, optionally, how it moved against a reference period.
 */
export function StatCard({
  label,
  value,
  icon,
  detail,
  trend,
  tone = 'brand',
  testId,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  detail?: ReactNode;
  trend?: Trend;
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'muted';
  testId?: string;
  className?: string;
}) {
  return (
    <div
      data-slot="card"
      data-testid={testId}
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-card p-5 text-card-foreground shadow-card transition-shadow duration-150 hover:shadow-raised',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">{label}</p>
        {icon ? <IconTile tone={tone}>{icon}</IconTile> : null}
      </div>
      <p className="text-[1.75rem] leading-none font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      {detail || trend ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {trend ? <TrendChip trend={trend} /> : null}
          {detail ? <span>{detail}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function TrendChip({ trend }: { trend: Trend }) {
  const Icon =
    trend.direction === 'up' ? TrendingUp : trend.direction === 'down' ? TrendingDown : Minus;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums [&_svg]:size-3.5',
        trend.direction === 'up' && 'bg-success/12 text-success',
        trend.direction === 'down' && 'bg-destructive/12 text-destructive',
        trend.direction === 'flat' && 'bg-muted text-muted-foreground',
      )}
    >
      <Icon aria-hidden />
      {trend.label}
    </span>
  );
}
