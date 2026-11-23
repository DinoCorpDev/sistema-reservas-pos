import type { ComponentProps, ReactNode } from 'react';
import { cn } from './utils';

const inputClasses = cn(
  'flex h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 py-2 text-base shadow-xs transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 file:border-0 file:bg-transparent file:text-sm file:font-medium',
  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40',
  'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
);

/**
 * Text input, 44 px high for touch (RNF-22). `icon` puts a glyph on the left (a mail, a lock,
 * a search) so the field says what it wants before anything is typed.
 */
export function Input({
  className,
  type = 'text',
  icon,
  ...props
}: ComponentProps<'input'> & { icon?: ReactNode }) {
  if (!icon) {
    return (
      <input type={type} data-slot="input" className={cn(inputClasses, className)} {...props} />
    );
  }
  return (
    <div className="relative w-full">
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground [&_svg]:size-[18px]"
      >
        {icon}
      </span>
      <input
        type={type}
        data-slot="input"
        className={cn(inputClasses, 'pl-10', className)}
        {...props}
      />
    </div>
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-24 w-full rounded-lg border border-input bg-card px-3 py-2 text-base shadow-xs outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}
