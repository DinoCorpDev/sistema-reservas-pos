'use client';

import { type ReactNode, useState } from 'react';
import { Button, type ButtonProps } from './button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';

/**
 * Button that asks before running a destructive or irreversible action (remove, deactivate,
 * anonymize, revoke…). Texts come from the caller, already translated.
 */
export function ConfirmButton({
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  children,
  ...buttonProps
}: Omit<ButtonProps, 'onClick'> & {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => unknown;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button {...buttonProps} type="button" onClick={() => setOpen(true)}>
        {children}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={cancelLabel}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {cancelLabel}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                setOpen(false);
                await onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
