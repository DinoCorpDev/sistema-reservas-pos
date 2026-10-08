'use client';

import { Button } from '@pos/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@pos/ui/dialog';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { approveWithPin, checkAction } from '../actions';
import { usePosUi } from '../ui-store';
import { NumPad } from '@/device/ui/num-pad';

/**
 * Manager approval on the same device (RN-15, RF-A05): opened by `requestApproval()`. When the
 * person on the terminal may act alone it resolves at once; otherwise a manager enters their PIN.
 */
export function ApprovalDialog() {
  const t = useTranslations('pos.approval');
  const request = usePosUi((state) => state.approval);
  const decision = useMemo(() => (request ? checkAction(request.action) : null), [request]);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (request && decision?.status === 'allowed') {
      request.resolve('allowed');
      usePosUi.setState({ approval: null });
    }
    setPin('');
    setError(false);
  }, [request, decision]);

  const close = (value: Parameters<NonNullable<typeof request>['resolve']>[0]) => {
    request?.resolve(value);
    usePosUi.setState({ approval: null });
  };

  async function submit() {
    if (!decision || pin.length < 4) return;
    setBusy(true);
    const approval = await approveWithPin(pin, decision);
    setBusy(false);
    setPin('');
    if (approval) close(approval);
    else setError(true);
  }

  const open = Boolean(request && decision?.status === 'needs_approval');
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {decision?.status === 'needs_approval' && decision.reason === 'above_threshold'
              ? t('aboveThreshold')
              : t('missingPermission')}
          </DialogDescription>
        </DialogHeader>
        <p className="text-center font-mono text-3xl tracking-[0.5em]" aria-live="polite">
          {'•'.repeat(pin.length) || ' '}
        </p>
        <NumPad
          onDigit={(digit) => setPin((value) => (value.length < 6 ? value + digit : value))}
          onBackspace={() => setPin((value) => value.slice(0, -1))}
          onClear={() => setPin('')}
        />
        {error && (
          <p className="text-center text-destructive" role="alert">
            {t('refused')}
          </p>
        )}
        <Button size="lg" onClick={() => void submit()} disabled={busy || pin.length < 4}>
          {t('approve')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
