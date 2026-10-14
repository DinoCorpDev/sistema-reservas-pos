'use client';

import { Button } from '@pos/ui/button';
import { ConfirmButton } from '@pos/ui/confirm';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@pos/ui/dialog';
import { QrCode } from '@pos/ui/qr-code';
import { toast } from '@pos/ui/toaster';
import { Power, Smartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { issuePhoneCode, phonePairingUrl, signOutPhone, UnsentOperationsError } from '../actions';

/**
 * Waiters' own phones (DEC-036): the cashier POS shows the QR that pairs one, and a phone signs
 * out of its shift with the power button.
 */

/** On the cashier POS: a QR (and its code) that several waiters may scan for 5 minutes. */
export function PhonePairingButton() {
  const t = useTranslations('pos.phone');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="icon" onClick={() => setOpen(true)} aria-label={t('pair')}>
        <Smartphone />
      </Button>
      {open && <PhonePairingDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function PhonePairingDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('pos.phone');
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const issue = useCallback(async () => {
    setFailed(false);
    setIssued(null);
    try {
      setIssued(await issuePhoneCode());
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void issue();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [issue]);

  const remaining = issued
    ? Math.max(0, Math.ceil((Date.parse(issued.expiresAt) - now) / 1000))
    : 0;
  const expired = issued !== null && remaining === 0;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm" closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('instruction')}</DialogDescription>
        </DialogHeader>
        {failed ? (
          <p className="text-center text-destructive" role="alert">
            {t('failed')}
          </p>
        ) : !issued ? (
          <p className="text-center text-muted-foreground">{t('loading')}</p>
        ) : expired ? (
          <p className="text-center text-muted-foreground">{t('expired')}</p>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <QrCode
              value={phonePairingUrl(issued.code)}
              label={t('qrLabel')}
              className="w-full max-w-64"
            />
            <p
              className="font-mono text-3xl font-semibold tracking-widest select-all"
              data-testid="phone-code"
            >
              {issued.code}
            </p>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {t('remaining', {
                minutes: Math.floor(remaining / 60),
                seconds: String(remaining % 60).padStart(2, '0'),
              })}
            </p>
          </div>
        )}
        <Button variant="outline" onClick={() => void issue()}>
          {t('newCode')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/**
 * On a waiter's phone: end of the shift. Everything goes to the cloud first; only then the
 * phone unpairs and forgets the shift.
 */
export function SignOutButton() {
  const t = useTranslations('pos.phone');
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmButton
      variant="outline"
      size="icon"
      aria-label={t('signOut')}
      disabled={busy}
      title={t('signOutTitle')}
      description={t('signOutDescription')}
      confirmLabel={t('signOutConfirm')}
      cancelLabel={t('cancel')}
      onConfirm={async () => {
        setBusy(true);
        try {
          await signOutPhone();
        } catch (cause) {
          toast.error(
            cause instanceof UnsentOperationsError
              ? t('signOutPending', { count: cause.pending })
              : t('signOutFailed'),
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <Power />
    </ConfirmButton>
  );
}
