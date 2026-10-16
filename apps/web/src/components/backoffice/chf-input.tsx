'use client';

import { MoneyError } from '@pos/core';
import { Input } from '@pos/ui/input';
import { type ComponentProps, useEffect, useState } from 'react';
import { useMoney } from '@/components/money';

/**
 * Amount input in the location's currency that works in integer minor units (PA-08, DEC-047):
 * the user types `12.50` or `1'234.50` (CHF), `15000` or `15.000` (COP); the form receives
 * 1250 / 123450 / 1500000. Invalid text keeps the last valid value and marks the field.
 */
export function ChfInput({
  value,
  onValueChange,
  ...props
}: Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  value: number | null;
  onValueChange: (rappenValue: number | null) => void;
}) {
  const money = useMoney();
  const display = (v: number | null) => (v === null ? '' : money.format(v, { symbol: false }));
  const [text, setText] = useState(display(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(value === null ? '' : money.format(value, { symbol: false }));
  }, [value, money]);

  const commit = () => {
    if (text.trim() === '') {
      setInvalid(false);
      return onValueChange(null);
    }
    try {
      const parsed = money.parse(text);
      if (parsed < 0) throw new MoneyError('negative');
      setInvalid(false);
      setText(display(parsed));
      onValueChange(parsed);
    } catch {
      setInvalid(true);
    }
  };

  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
        {money.currency}
      </span>
      <Input
        {...props}
        inputMode="decimal"
        className="pl-12 tabular-nums"
        value={text}
        aria-invalid={invalid || props['aria-invalid']}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        // Enter submits the form: commit the typed amount first.
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          props.onKeyDown?.(event);
        }}
      />
    </div>
  );
}
