'use client';

import { formatChf, MoneyError, parseChf, rappen } from '@pos/core';
import { Input } from '@pos/ui/input';
import { type ComponentProps, useEffect, useState } from 'react';

/**
 * Amount input in CHF that works in integer rappen (PA-08): the user types `12.50` or `1'234.50`,
 * the form receives 1250 / 123450. Invalid text keeps the last valid value and marks the field.
 */
export function ChfInput({
  value,
  onValueChange,
  ...props
}: Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  value: number | null;
  onValueChange: (rappenValue: number | null) => void;
}) {
  const display = (v: number | null) => (v === null ? '' : formatChf(rappen(v), { currency: false }));
  const [text, setText] = useState(display(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(display(value));
  }, [value]);

  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
        CHF
      </span>
      <Input
        {...props}
        inputMode="decimal"
        className="pl-12 tabular-nums"
        value={text}
        aria-invalid={invalid || props['aria-invalid']}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (text.trim() === '') {
            setInvalid(false);
            return onValueChange(null);
          }
          try {
            const parsed = parseChf(text);
            if (parsed < 0) throw new MoneyError('negative');
            setInvalid(false);
            setText(display(parsed));
            onValueChange(parsed);
          } catch {
            setInvalid(true);
          }
        }}
      />
    </div>
  );
}
