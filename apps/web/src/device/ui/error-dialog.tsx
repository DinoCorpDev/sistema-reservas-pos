'use client';

import { Button } from '@pos/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pos/ui/dialog';
import { AlertTriangle } from 'lucide-react';

/**
 * A sign-in problem in a modal (PIN, pairing): it cannot be missed, says what happened and what
 * to do, and closes with one tap back to the keypad.
 */
export function ErrorDialog({
  title,
  message,
  okLabel,
  onClose,
}: {
  title: string;
  message: string | null;
  okLabel: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={message !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={okLabel} data-testid="sign-in-error">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-destructive" aria-hidden />
            {title}
          </DialogTitle>
          <DialogDescription role="alert" className="text-base text-foreground">
            {message}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button size="lg" autoFocus onClick={onClose}>
            {okLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
