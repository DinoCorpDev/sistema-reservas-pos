import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { Tooltip } from './tooltip';
import { cn } from './utils';

/**
 * Touch button (shadcn/ui). Every size is at least 44 px tall (RNF-22);
 * `pos` is the size of the product buttons in the POS.
 */
export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-base font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-150 select-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // The primary action glows softly in the brand teal (DEC-053).
        default:
          'bg-primary text-primary-foreground shadow-[0_0_0_1px_var(--glow),0_10px_24px_-12px_var(--glow)] hover:-translate-y-px hover:bg-primary/90 active:translate-y-0 active:bg-primary/80',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/70',
        outline:
          'border border-border bg-card shadow-xs hover:border-brand/40 hover:bg-accent hover:text-accent-foreground active:bg-accent/80',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 active:bg-destructive/80 focus-visible:ring-destructive/40',
        ghost: 'hover:bg-accent hover:text-accent-foreground active:bg-accent/80',
        link: 'text-brand-strong underline-offset-4 hover:underline',
      },
      size: {
        default: 'min-h-11 px-4 py-2',
        lg: 'min-h-14 px-6 text-lg',
        pos: 'min-h-20 min-w-24 flex-col px-3 py-2 text-base leading-tight',
        icon: 'size-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Renders the child (e.g. a `<Link>`) with the button styles. */
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  // An icon alone says little: its name shows in a tooltip on hover or focus (desktop).
  const label = size === 'icon' ? (props['aria-label'] ?? props.title) : undefined;
  if (label) {
    const { title: _title, ...rest } = props;
    return (
      <Tooltip content={label} side="top">
        <Component
          data-slot="button"
          className={cn(buttonVariants({ variant, size, className }))}
          {...rest}
        />
      </Tooltip>
    );
  }
  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
