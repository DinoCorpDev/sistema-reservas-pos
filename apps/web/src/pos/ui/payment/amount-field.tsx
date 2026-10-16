'use client';

import { Input } from '@pos/ui/input';
import { Label } from '@pos/ui/label';
import { cn } from '@pos/ui/utils';
import type { ReactNode } from 'react';
import { posCurrency } from '@/pos/money';

/**
 * An amount in the location's currency: typed with the on-screen keypad (it types into the highlighted field) or with a
 * keyboard. Focusing it makes it the keypad's target and selects the text, so the next key
 * replaces the proposed amount.
 */
export function AmountField({
  id,
  label,
  value,
  active,
  keypad,
  invalid = false,
  hint,
  aside,
  size = 'lg',
  onFocus,
  onChange,
  className,
}: {
  id: string;
  label: ReactNode;
  value: string;
  /** Target of the on-screen keypad. */
  active: boolean;
  /** The on-screen keypad is visible: no system keyboard on touch devices. */
  keypad: boolean;
  invalid?: boolean;
  hint?: ReactNode;
  /** Shown next to the label (e.g. a badge). */
  aside?: ReactNode;
  size?: 'lg' | 'md';
  onFocus: () => void;
  onChange: (text: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {aside}
      </div>
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
        >
          {posCurrency()}
        </span>
        <Input
          id={id}
          value={value}
          inputMode={keypad ? 'none' : 'decimal'}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          data-active={active || undefined}
          className={cn(
            'pl-12 text-right font-semibold tabular-nums',
            size === 'lg' ? 'h-14 text-2xl' : 'h-12 text-xl',
            active && 'border-primary ring-[3px] ring-primary/25',
          )}
          onFocus={(event) => {
            event.currentTarget.select();
            onFocus();
          }}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </div>
      {hint ? (
        <p
          id={`${id}-hint`}
          className={cn('text-sm', invalid ? 'text-destructive' : 'text-muted-foreground')}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
