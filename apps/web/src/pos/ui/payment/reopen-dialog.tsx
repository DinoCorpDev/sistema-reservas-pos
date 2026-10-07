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
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { reopenOrder } from '../../actions';
import { requestApproval } from '../../ui-store';

/**
 * Reopening a closed order (RF-C14): a reason and a manager's approval (RN-15). It is recorded
 * as a new operation and audited; the day's closing shows it as a new movement.
 */
export function ReopenDialog({
  orderId,
  orderNumber,
  open,
  onOpenChange,
  onDone,
}: {
  orderId: string;
  orderNumber: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const t = useTranslations('posPayment.reopen');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description', { number: orderNumber })}</DialogDescription>
        </DialogHeader>
        {open && (
          <ReopenBody orderId={orderId} onCancel={() => onOpenChange(false)} onDone={onDone} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReopenBody({
  orderId,
  onCancel,
  onDone,
}: {
  orderId: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('posPayment.reopen');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (busy) return;
    const text = reason.trim();
    if (text === '') {
      setError(t('reasonRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const decision = await requestApproval({ kind: 'reopen_order' });
      if (decision === null) {
        setBusy(false);
        return;
      }
      await reopenOrder(orderId, text, decision === 'allowed' ? null : decision);
      onDone();
    } catch {
      setError(t('failed'));
      setBusy(false);
    }
  }

  return (
    <>
      <Field label={t('reason')} htmlFor="reopen-reason">
        <Input
          id="reopen-reason"
          maxLength={500}
          value={reason}
          aria-required
          onChange={(event) => {
            setReason(event.currentTarget.value);
            setError(null);
          }}
        />
      </Field>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button type="button" disabled={busy} onClick={() => void confirm()}>
          {t('confirm')}
        </Button>
      </DialogFooter>
    </>
  );
}
