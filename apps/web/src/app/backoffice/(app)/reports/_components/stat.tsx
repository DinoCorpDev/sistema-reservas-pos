import { StatCard, type Trend } from '@pos/ui/stat-card';
import type { ReactNode } from 'react';

/**
 * One headline figure of a report (DEC-053): the label, the value large, a line of context below
 * and, optionally, an icon and how it moved. The test id and the exact rappen stay on the value.
 */
export function Stat({
  label,
  value,
  detail,
  testId,
  rappen,
  icon,
  trend,
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  testId?: string;
  /** The exact amount behind `value`, for tests and tools reading the page. */
  rappen?: number;
  icon?: ReactNode;
  trend?: Trend;
}) {
  return (
    <StatCard
      label={label}
      icon={icon}
      trend={trend}
      detail={detail}
      value={
        <span data-testid={testId} data-rappen={rappen}>
          {value}
        </span>
      }
    />
  );
}

/** A grid of headline figures: one per row on a phone, up to four side by side. */
export function Stats({ children }: { children: ReactNode }) {
  return <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}
