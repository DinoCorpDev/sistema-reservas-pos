import { Card, CardContent } from '@pos/ui/card';
import type { ReactNode } from 'react';

/** One headline figure of a report: the label, the value large, a line of context below. */
export function Stat({
  label,
  value,
  detail,
  testId,
  rappen,
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  testId?: string;
  /** The exact amount behind `value`, for tests and tools reading the page. */
  rappen?: number;
}) {
  return (
    <Card>
      <CardContent className="grid gap-1 pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p
          className="text-2xl font-semibold tabular-nums"
          data-testid={testId}
          data-rappen={rappen}
        >
          {value}
        </p>
        {detail ? <p className="text-sm text-muted-foreground">{detail}</p> : null}
      </CardContent>
    </Card>
  );
}

/** A grid of headline figures: one per row on a phone, up to four side by side. */
export function Stats({ children }: { children: ReactNode }) {
  return <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}
