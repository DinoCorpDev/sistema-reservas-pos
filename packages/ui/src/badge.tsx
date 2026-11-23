import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from './utils';

export const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        info: 'border-transparent bg-brand-soft text-brand-strong',
        success: 'border-transparent bg-success/12 text-success',
        warning: 'border-transparent bg-warning/25 text-amber-800 dark:text-warning',
        destructive: 'border-transparent bg-destructive/12 text-destructive',
        outline: 'bg-card text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

/** A status pill. `dot` adds a small dot in the badge colour, for states at a glance. */
export function Badge({
  className,
  variant,
  dot = false,
  children,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}
