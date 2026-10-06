'use client';

import { Label } from '@pos/ui/label';
import { Checkbox } from '@pos/ui/switch';
import type { ReactNode } from 'react';

/** A labelled checkbox with an optional description; the whole row is a 44 px touch target. */
export function CheckOption({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  checked: boolean | 'indeterminate';
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 py-1">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        aria-describedby={description ? `${id}-description` : undefined}
      />
      <div className="grid gap-0.5">
        <Label htmlFor={id} className="leading-snug">
          {label}
        </Label>
        {description ? (
          <p id={`${id}-description`} className="text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
