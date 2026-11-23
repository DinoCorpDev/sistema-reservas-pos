import type { ReactNode } from 'react';
import { cn } from './utils';

/**
 * The actions of a table row, together in one pill (DEC-053). Each child stays a button with its
 * own name (shown as a tooltip), so screen readers and tests still find every action.
 */
export function ActionGroup({
  children,
  label,
  className,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex items-center divide-x overflow-hidden rounded-lg border bg-card shadow-xs',
        '[&_[data-slot=button]]:rounded-none [&_[data-slot=button]]:text-muted-foreground [&_[data-slot=button]:hover]:text-foreground',
        className,
      )}
    >
      {children}
    </div>
  );
}
