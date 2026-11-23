import type { ComponentProps, ReactNode } from 'react';
import { cn } from './utils';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col gap-4 rounded-xl border bg-card p-5 text-card-foreground shadow-card',
        className,
      )}
      {...props}
    />
  );
}

type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'muted';

/**
 * Title block of a card. With `icon` it gets a tile on the left (`iconTone` colours it), and with
 * `action` a control on the right (DEC-053); without them it is the plain title and description.
 */
export function CardHeader({
  className,
  icon,
  iconTone = 'brand',
  action,
  children,
  ...props
}: ComponentProps<'div'> & { icon?: ReactNode; iconTone?: Tone; action?: ReactNode }) {
  if (!icon && !action) {
    return (
      <div className={cn('flex flex-col gap-1', className)} {...props}>
        {children}
      </div>
    );
  }
  return (
    <div className={cn('flex items-start gap-3', className)} {...props}>
      {icon ? <IconTile tone={iconTone}>{icon}</IconTile> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

/** A square tile for an icon: brand-soft background, teal glyph. */
export function IconTile({
  className,
  tone = 'brand',
  ...props
}: ComponentProps<'span'> & { tone?: Tone }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-lg [&_svg]:size-[18px]',
        tone === 'brand' && 'bg-brand-soft text-brand-strong',
        tone === 'success' && 'bg-success/12 text-success',
        tone === 'warning' && 'bg-warning/20 text-amber-700 dark:text-warning',
        tone === 'danger' && 'bg-destructive/12 text-destructive',
        tone === 'muted' && 'bg-muted text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return (
    <h3 className={cn('text-base leading-tight font-semibold sm:text-lg', className)} {...props} />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('grid gap-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('flex flex-wrap items-center justify-end gap-2', className)} {...props} />
  );
}
