import { cva, type VariantProps } from 'class-variance-authority';
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './utils';

const alertVariants = cva('relative grid w-full gap-1 rounded-xl border px-4 py-3 text-sm', {
  variants: {
    variant: {
      default: 'bg-card text-card-foreground',
      info: 'border-brand/30 bg-brand-soft/50',
      success: 'border-success/35 bg-success/8',
      warning: 'border-warning/60 bg-warning/12',
      destructive: 'border-destructive/35 bg-destructive/6 text-destructive',
    },
  },
  defaultVariants: { variant: 'default' },
});

/** Each kind of notice carries its icon (DEC-053), so it reads before a word is read. */
const ICONS = {
  info: { Icon: InfoIcon, className: 'text-brand-strong' },
  success: { Icon: CircleCheckIcon, className: 'text-success' },
  warning: { Icon: TriangleAlertIcon, className: 'text-amber-600 dark:text-warning' },
  destructive: { Icon: CircleAlertIcon, className: 'text-destructive' },
} as const;

export function Alert({
  className,
  variant,
  icon,
  children,
  ...props
}: ComponentProps<'div'> &
  VariantProps<typeof alertVariants> & {
    /** Replaces the variant's icon; `false` shows none. */
    icon?: ReactNode | false;
  }) {
  const auto = variant && variant !== 'default' ? ICONS[variant] : null;
  const glyph = icon === false ? null : (icon ?? (auto ? <auto.Icon /> : null));
  return (
    <div
      role="alert"
      className={cn(alertVariants({ variant }), glyph ? 'pl-11' : null, className)}
      {...props}
    >
      {glyph ? (
        <span
          aria-hidden
          className={cn('absolute top-3 left-4 [&_svg]:size-[18px]', auto?.className)}
        >
          {glyph}
        </span>
      ) : null}
      {children}
    </div>
  );
}

export function AlertTitle({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('font-medium', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('text-muted-foreground', className)} {...props} />;
}
