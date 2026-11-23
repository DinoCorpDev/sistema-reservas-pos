import type { ReactNode } from 'react';
import { cn } from './utils';

/**
 * What a list shows when it has nothing yet (DEC-053): an icon, a sentence that says what goes
 * here and, when the person can, the button that adds the first one.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card/60 text-center',
        compact ? 'px-4 py-8' : 'px-6 py-14',
        className,
      )}
    >
      <span
        aria-hidden
        className="grid size-12 place-items-center rounded-full bg-brand-soft text-brand-strong ring-8 ring-brand-soft/40 [&_svg]:size-6"
      >
        {icon}
      </span>
      <div className="grid max-w-sm gap-1">
        <p className="font-semibold">{title}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
