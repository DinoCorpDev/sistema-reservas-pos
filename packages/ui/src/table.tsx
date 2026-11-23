import type { ComponentProps } from 'react';
import { cn } from './utils';

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    // Inside a card the table drops its own shadow: one frame, not two.
    <div className="relative w-full overflow-x-auto rounded-xl border bg-card shadow-card in-data-[slot=card]:shadow-none">
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('bg-surface-2 [&_tr]:border-b', className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      className={cn('border-b transition-colors duration-150 hover:bg-brand-soft/35', className)}
      {...props}
    />
  );
}

/** Column heading: small capitals with tracking (the `eyebrow` style of DEC-053). */
export function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'h-10 px-4 text-left align-middle text-[11px] font-semibold tracking-[0.12em] whitespace-nowrap text-muted-foreground uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('px-4 py-3 align-middle', className)} {...props} />;
}
