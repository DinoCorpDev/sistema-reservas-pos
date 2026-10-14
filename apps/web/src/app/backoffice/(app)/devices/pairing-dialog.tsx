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
import { QrCode } from '@pos/ui/qr-code';
import { cn } from '@pos/ui/utils';
import { RefreshCwIcon } from 'lucide-react';
import { useNow, useTranslations } from 'next-intl';
import { useDateTime } from '@/components/backoffice/people/use-date-time';

/**
 * A code for one device, or (`phone`) a code for waiters' own phones, shown with its QR and
 * valid for several phones (DEC-036).
 */
export type Pairing =
  | { kind: 'device'; terminalId: string; name: string; code: string; expiresAt: string }
  | { kind: 'phone'; code: string; expiresAt: string };

/**
 * Shows a freshly issued pairing code (RF-A06) large enough to read across the counter, with a
 * countdown to its expiry. The code is never shown again, so a tap outside does not close it.
 */
export function PairingDialog({
  pairing,
  renewing,
  onRenew,
  onClose,
}: {
  pairing: Pairing | null;
  renewing: boolean;
  onRenew: () => void;
  onClose: () => void;
}) {
  const tc = useTranslations('common');
  return (
    <Dialog open={!!pairing} onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={tc('close')} onInteractOutside={(event) => event.preventDefault()}>
        {pairing ? (
          <PairingCode pairing={pairing} renewing={renewing} onRenew={onRenew} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PairingCode({
  pairing,
  renewing,
  onRenew,
  onClose,
}: {
  pairing: Pairing;
  renewing: boolean;
  onRenew: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('terminals');
  const tp = useTranslations('phones');
  const formatDate = useDateTime();
  const now = useNow({ updateInterval: 1000 });
  const remainingMs = Math.max(0, new Date(pairing.expiresAt).getTime() - now.getTime());
  const expired = remainingMs === 0;
  const minutes = Math.floor(remainingMs / 60_000);
  const seconds = Math.floor((remainingMs % 60_000) / 1000);
  const remaining = `${minutes}:${String(seconds).padStart(2, '0')}`;
  const phone = pairing.kind === 'phone';

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {phone ? tp('codeTitle') : t('pairingTitle', { name: pairing.name })}
        </DialogTitle>
        <DialogDescription>
          {phone ? tp('codeInstruction') : t('pairingInstruction')}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2 rounded-xl border bg-muted/50 px-4 py-6 text-center">
        {phone && !expired ? (
          <QrCode
            value={`${window.location.origin}/pos?phone=${encodeURIComponent(pairing.code)}`}
            label={tp('qrLabel')}
            className="mx-auto w-full max-w-56"
          />
        ) : null}
        <p
          className={cn(
            'font-mono text-4xl font-semibold tracking-[0.15em] break-all select-all sm:text-5xl',
            expired && 'text-muted-foreground line-through',
          )}
        >
          {pairing.code}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('pairingValidUntil', { time: formatDate(pairing.expiresAt, 'time') ?? '' })}
        </p>
        {expired ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {t('pairingExpired')}
          </p>
        ) : (
          <p className="text-sm font-medium tabular-nums">{t('pairingRemaining', { remaining })}</p>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{phone ? tp('codeShared') : t('pairingOnce')}</p>
      <DialogFooter>
        {expired ? (
          <Button variant="outline" onClick={onRenew} disabled={renewing}>
            <RefreshCwIcon /> {t('pairingNew')}
          </Button>
        ) : null}
        <Button onClick={onClose}>{t('pairingDone')}</Button>
      </DialogFooter>
    </>
  );
}
