'use client';

import type { ClosingDto, DayClosePreview } from '@pos/api';
import { type DailyClosingTotals, formatChf, type PaymentMethod, rappen } from '@pos/core';
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
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { NodeError } from '@/device/http';
import {
  businessDayNow,
  closeBusinessDay,
  dayClosePreview,
  managerSession,
  sendPendingToCloud,
} from '../../actions';
import { usePosUi } from '../../ui-store';
import { parseAmount, toAmountText } from '../payment/model';

type Step =
  | { name: 'pin' }
  | { name: 'review'; token: string; preview: DayClosePreview }
  | { name: 'done'; closing: ClosingDto };

const chf = (value: number) => formatChf(rappen(value));

/**
 * Closing the business day from the POS (RF-D15, RF-D19, RF-D11): a manager's PIN, then what
 * still stops the day (each one opens where it is solved), the card terminal totals and the Z.
 * Needs the cloud: everything of this device is sent first, so the Z misses nothing of it.
 */
export function DayCloseDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('posCash.day');
  const [step, setStep] = useState<Step>({ name: 'pin' });
  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) setStep({ name: 'pin' });
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl" closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {step.name === 'pin' && (
          <PinStep onReady={(token, preview) => setStep({ name: 'review', token, preview })} />
        )}
        {step.name === 'review' && (
          <ReviewStep
            token={step.token}
            preview={step.preview}
            onPreview={(preview) => setStep({ name: 'review', token: step.token, preview })}
            onClosed={(closing) => setStep({ name: 'done', closing })}
            onLeave={() => close(false)}
          />
        )}
        {step.name === 'done' && <DoneStep closing={step.closing} onClose={() => close(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function PinStep({ onReady }: { onReady: (token: string, preview: DayClosePreview) => void }) {
  const t = useTranslations('posCash.day');
  const [pin, setPin] = useState('');
  const [day, setDay] = useState(businessDayNow);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const pending = await sendPendingToCloud();
      if (pending > 0) {
        setError(t('pending', { count: pending }));
        return;
      }
      const token = await managerSession(pin).catch((cause: unknown) => {
        throw cause instanceof NodeError && cause.status < 500 ? new Error('pin') : cause;
      });
      onReady(token, await dayClosePreview(token, day));
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message === 'pin'
          ? t('wrongPin')
          : cause instanceof NodeError && cause.status === 403
            ? t('notAllowed')
            : t('offline'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <Field label={t('day')} htmlFor="day-close-date">
        <Input
          id="day-close-date"
          type="date"
          value={day}
          max={businessDayNow()}
          onChange={(e) => setDay(e.currentTarget.value)}
        />
      </Field>
      <Field label={t('pin')} htmlFor="day-close-pin">
        <Input
          id="day-close-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          className="h-12 text-center text-2xl tracking-[0.5em]"
          value={pin}
          data-testid="day-close-pin"
          onChange={(e) => {
            setPin(e.currentTarget.value.replace(/\D/g, ''));
            setError(null);
          }}
        />
      </Field>
      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button
          type="submit"
          size="lg"
          disabled={busy || pin.length < 4}
          aria-busy={busy || undefined}
        >
          {t('continue')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ReviewStep({
  token,
  preview,
  onPreview,
  onClosed,
  onLeave,
}: {
  token: string;
  preview: DayClosePreview;
  onPreview: (preview: DayClosePreview) => void;
  onClosed: (closing: ClosingDto) => void;
  onLeave: () => void;
}) {
  const t = useTranslations('posCash.day');
  const tm = useTranslations('posPayment.methods');
  const navigate = usePosUi((state) => state.navigate);
  const [terminal, setTerminal] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { blockers } = preview;

  if (preview.closing) {
    return (
      <div className="grid gap-4">
        <p className="rounded-lg bg-muted px-3 py-2">
          {t('already', { number: preview.closing.closingNumber })}
        </p>
        <ZSummary totals={preview.closing.totals} />
      </div>
    );
  }

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      await sendPendingToCloud();
      onPreview(await dayClosePreview(token, preview.businessDate));
    } catch {
      setError(t('offline'));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    const reconciliations: {
      method: PaymentMethod;
      terminalTotalRappen: number;
      reason: string | null;
    }[] = [];
    for (const { method, posTotalRappen } of preview.toReconcile) {
      const typed = parseAmount(terminal[method] ?? toAmountText(rappen(posTotalRappen)));
      if (typed === null) {
        setError(t('terminalInvalid', { method: tm(method) }));
        return;
      }
      const reason = (reasons[method] ?? '').trim();
      if (typed !== posTotalRappen && reason === '') {
        setError(t('reasonRequired', { method: tm(method) }));
        return;
      }
      reconciliations.push({
        method,
        terminalTotalRappen: typed,
        reason: reason === '' ? null : reason,
      });
    }
    setBusy(true);
    setError(null);
    try {
      onClosed(
        await closeBusinessDay(token, { businessDate: preview.businessDate, reconciliations }),
      );
    } catch (cause) {
      setBusy(false);
      if (cause instanceof NodeError && cause.status === 409) await refresh();
      else setError(t('failed'));
    }
  }

  const blocked = !preview.canClose;
  return (
    <div className="grid gap-4">
      {blocked && (
        <section className="grid gap-2" aria-labelledby="day-blockers">
          <h3 id="day-blockers" className="flex items-center gap-2 font-semibold text-destructive">
            <AlertTriangle className="size-5" aria-hidden /> {t('blockers')}
          </h3>
          <ul className="grid gap-1.5" data-testid="day-blockers">
            {blockers.future && <li className="rounded-lg border px-3 py-2">{t('future')}</li>}
            {blockers.previousDayOpen && (
              <li className="rounded-lg border px-3 py-2">
                {t('previousDay', { date: blockers.previousDayOpen })}
              </li>
            )}
            {blockers.openShifts.map((shift) => (
              <li key={shift.id} className="rounded-lg border px-3 py-2">
                {t('openShift', { name: shift.ownerName, date: shift.businessDate })}
              </li>
            ))}
            {blockers.openOrders.map((order) => (
              <li key={order.id}>
                <Button
                  variant="outline"
                  className="h-auto min-h-11 w-full justify-between whitespace-normal"
                  onClick={() => {
                    onLeave();
                    navigate({ name: 'payment', orderId: order.id });
                  }}
                >
                  <span>{t('openOrder', { number: order.displayNumber })}</span>
                  <span className="tabular-nums">{chf(order.balanceRappen)}</span>
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="secondary" onClick={() => void refresh()} disabled={busy}>
            {t('refresh')}
          </Button>
        </section>
      )}

      <ZSummary totals={preview.totals} />

      {!blocked && preview.toReconcile.length > 0 && (
        <section className="grid gap-3" aria-labelledby="day-reconcile">
          <h3 id="day-reconcile" className="font-semibold">
            {t('reconcile')}
          </h3>
          {preview.toReconcile.map(({ method, posTotalRappen }) => {
            const text = terminal[method] ?? toAmountText(rappen(posTotalRappen));
            const typed = parseAmount(text);
            const differs = typed !== null && typed !== posTotalRappen;
            return (
              <div key={method} className="grid gap-2 rounded-lg border p-3">
                <Field
                  label={t('terminalTotal', { method: tm(method) })}
                  htmlFor={`terminal-${method}`}
                  hint={t('posTotal', { amount: chf(posTotalRappen) })}
                >
                  <Input
                    id={`terminal-${method}`}
                    inputMode="decimal"
                    className="h-11 text-right text-lg tabular-nums"
                    value={text}
                    data-testid={`terminal-total-${method}`}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setTerminal({ ...terminal, [method]: e.currentTarget.value })}
                  />
                </Field>
                {differs && typed !== null && (
                  <Field
                    label={t('reason', { difference: chf(typed - posTotalRappen) })}
                    htmlFor={`reason-${method}`}
                  >
                    <Input
                      id={`reason-${method}`}
                      maxLength={500}
                      value={reasons[method] ?? ''}
                      onChange={(e) => setReasons({ ...reasons, [method]: e.currentTarget.value })}
                    />
                  </Field>
                )}
              </div>
            );
          })}
        </section>
      )}

      {preview.warnings.unresolvedConflicts > 0 && (
        <p className="text-sm text-muted-foreground">
          {t('conflicts', { count: preview.warnings.unresolvedConflicts })}
        </p>
      )}
      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button
          size="lg"
          disabled={blocked || busy}
          aria-busy={busy || undefined}
          data-testid="day-close-confirm"
          onClick={() => void confirm()}
        >
          {t('confirm')}
        </Button>
      </DialogFooter>
    </div>
  );
}

/** The main figures of a Z: turnover, per method, MWST, tips and the cash difference. */
export function ZSummary({ totals }: { totals: DailyClosingTotals }) {
  const t = useTranslations('posCash.day');
  const tm = useTranslations('posPayment.methods');
  return (
    <dl className="grid gap-1 rounded-lg bg-muted px-3 py-2 text-sm" data-testid="z-summary">
      <div className="flex justify-between gap-3 text-base font-semibold">
        <dt>{t('turnover')}</dt>
        <dd className="tabular-nums">{chf(totals.grossSalesRappen)}</dd>
      </div>
      {totals.byPaymentMethod.map((m) => (
        <div key={m.method} className="flex justify-between gap-3">
          <dt>{tm(m.method)}</dt>
          <dd className="tabular-nums">{chf(m.totalRappen)}</dd>
        </div>
      ))}
      {totals.byTaxRate.map((rate) => (
        <div
          key={`${rate.rateCode}${rate.rateBp}`}
          className="flex justify-between gap-3 text-muted-foreground"
        >
          <dt>{t('tax', { rate: (rate.rateBp / 100).toFixed(1) })}</dt>
          <dd className="tabular-nums">{chf(rate.taxRappen)}</dd>
        </div>
      ))}
      <div className="flex justify-between gap-3">
        <dt>{t('tips')}</dt>
        <dd className="tabular-nums">{chf(totals.tipsRappen)}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>{t('cashDifference')}</dt>
        <dd className="tabular-nums">{chf(totals.cash.differenceRappen)}</dd>
      </div>
    </dl>
  );
}

function DoneStep({ closing, onClose }: { closing: ClosingDto; onClose: () => void }) {
  const t = useTranslations('posCash.day');
  return (
    <div className="grid gap-4" data-testid="day-closed">
      <p className="flex items-center gap-2 text-lg font-semibold">
        <CheckCircle2 className="size-6 text-emerald-600" aria-hidden />
        {t('closed', { number: closing.closingNumber, date: closing.businessDate })}
      </p>
      <ZSummary totals={closing.totals} />
      <DialogFooter>
        <Button variant="outline" onClick={() => window.print()}>
          {t('print')}
        </Button>
        <Button onClick={onClose}>{t('done')}</Button>
      </DialogFooter>
    </div>
  );
}
