'use client';

import { formatWorked, workedMinutes } from '@pos/core';
import { Button } from '@pos/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pos/ui/dialog';
import { toast } from '@pos/ui/toaster';
import { LogOut, TimerIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { lockTerminal } from '../pin';
import { usePos } from '../store';
import { clockIn, clockOut, openEntryOf } from '../time';

/** The open entry of the person on the terminal, kept current with every operation. */
export function useOpenEntry() {
  const user = usePos((state) => state.user);
  const fold = usePos((state) => state.fold);
  const version = usePos((state) => state.foldVersion);
  return useMemo(
    () => (user ? openEntryOf(fold, user.id) : null),
    // `version` marks in-place changes of the fold.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, fold, version],
  );
}

/**
 * After the PIN, a bar asks a person who is not clocked in whether they start working (DEC-054).
 * It does not block the screen: "just a quick look" or simply working on hides it until the next
 * unlock. Not on a practice till, whose hours mean nothing.
 */
export function ClockInBar() {
  const t = useTranslations('pos.clock');
  const format = useFormatter();
  const user = usePos((state) => state.user);
  const training = usePos((state) => state.bootstrap?.organization.isTraining ?? false);
  const entry = useOpenEntry();
  // Each unlock makes a new user object: answering hides the bar for this unlock only.
  const [answered, setAnswered] = useState<object | null>(null);
  const [pending, setPending] = useState(false);
  if (!user || training || entry || answered === user) return null;

  const start = async () => {
    setPending(true);
    try {
      await clockIn();
      toast.success(t('started', { time: format.dateTime(new Date(), { timeStyle: 'short' }) }));
      setAnswered(user);
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      role="region"
      aria-label={t('question')}
      data-testid="clock-in-bar"
      className="flex flex-wrap items-center gap-3 border-b bg-brand-soft px-4 py-2.5 text-brand-strong"
    >
      <TimerIcon className="size-5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">{t('question')}</span>{' '}
        <span className="text-foreground/70">{t('hint')}</span>
      </p>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setAnswered(user)}>
          {t('later')}
        </Button>
        <Button onClick={() => void start()} disabled={pending}>
          <TimerIcon /> {t('start')}
        </Button>
      </div>
    </div>
  );
}

/** Confirms the end of the working time, shows the hours, clocks out and locks (DEC-054). */
export function ClockOutDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('pos.clock');
  const format = useFormatter();
  const entry = useOpenEntry();
  const [pending, setPending] = useState(false);
  if (!entry?.clockInAt) return null;
  const since = format.dateTime(new Date(entry.clockInAt), { timeStyle: 'short' });
  const worked = formatWorked(
    workedMinutes({ clockInAt: entry.clockInAt, clockOutAt: new Date().toISOString() }) ?? 0,
  );

  const finish = async () => {
    setPending(true);
    try {
      await clockOut();
      onOpenChange(false);
      toast.success(t('ended', { worked }));
      lockTerminal();
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t('endTitle')}</DialogTitle>
          <DialogDescription>{t('endText', { since, worked })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void finish()} disabled={pending}>
            <LogOut /> {t('endConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
