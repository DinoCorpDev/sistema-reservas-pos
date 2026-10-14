'use client';

import { countTotal, type DenominationCount, formatChf, rappen, type ShiftReport } from '@pos/core';
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
import { toast } from '@pos/ui/toaster';
import { cn } from '@pos/ui/utils';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarCheck,
  FileText,
  Lock,
  Receipt,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { usePos } from '@/device/store';
import {
  businessDayNow,
  cashOwner,
  closeShift,
  currentShift,
  currentShiftReport,
  openShift,
  recordMovement,
} from '../actions';
import { requestApproval } from '../ui-store';
import { DayCloseDialog } from './cash/day-close-dialog';
import { DenominationCounter } from './cash/denomination-count';
import { ShiftReportView } from './cash/shift-report-view';
import { useFoldMemo } from './order/hooks';
import { parseAmount } from './payment/model';

const chf = (value: number) => formatChf(rappen(value));

/** Asks for the permission or a manager's PIN; null when cancelled (RN-15). */
async function permitted(permission: 'shift.open' | 'shift.close' | 'cash.movement') {
  const decision = await requestApproval({ kind: 'permission', permission });
  if (decision === null) return undefined;
  return decision === 'allowed' ? null : decision;
}

/**
 * The cash of this till or of this person's wallet (RF-D12…RF-D15, DEC-038): open the shift with
 * the counted float, record cash in and out, see the X report and close with the count by
 * denomination. All offline. The manager closes the day (Z) from here with the cloud.
 */
export function CashView() {
  const t = useTranslations('posCash');
  const user = usePos((state) => state.user);
  const location = usePos((state) => state.bootstrap?.location);
  const terminalType = usePos((state) => state.bootstrap?.terminal.type);
  // Re-read on every change of the fold: a payment on another device moves the expected cash.
  const shift = useFoldMemo(() => currentShift(), [user?.id]);
  const owner = useFoldMemo(() => cashOwner(), [user?.id, location?.settings.shiftMode]);
  const [dayOpen, setDayOpen] = useState(false);
  // The closing report outlives the shift view, which turns into the form for the next shift.
  const [closed, setClosed] = useState<{ report: ShiftReport; counted: number } | null>(null);
  const mayCloseDay = user?.permissions.has('day.close') || terminalType !== 'phone';

  return (
    <div className="mx-auto grid w-full max-w-3xl content-start gap-4 p-3 md:p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t('title')}</h1>
        {mayCloseDay && (
          <Button variant="outline" onClick={() => setDayOpen(true)} data-testid="day-close-open">
            <CalendarCheck /> {t('day.open')}
          </Button>
        )}
      </header>
      {!owner ? (
        <p className="rounded-xl border bg-card p-4" data-testid="no-cash-here">
          {t('noCashHere')}
        </p>
      ) : shift ? (
        <OpenShift key={shift.id} onClosed={setClosed} />
      ) : (
        <OpenShiftForm personal={owner.scope === 'personal'} />
      )}
      <DayCloseDialog open={dayOpen} onOpenChange={setDayOpen} />
      <ClosedReportDialog closed={closed} onClose={() => setClosed(null)} />
    </div>
  );
}

/** The closing report of the shift just closed, to read and print (RF-D15). */
function ClosedReportDialog({
  closed,
  onClose,
}: {
  closed: { report: ShiftReport; counted: number } | null;
  onClose: () => void;
}) {
  const t = useTranslations('posCash.close');
  return (
    <Dialog open={closed !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[92dvh] overflow-y-auto sm:max-w-lg"
        closeLabel={t('closeDialog')}
      >
        <DialogHeader>
          <DialogTitle>{t('reportTitle')}</DialogTitle>
        </DialogHeader>
        {closed && <ShiftReportView report={closed.report} counted={closed.counted} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => window.print()}>
            <Receipt /> {t('print')}
          </Button>
          <Button onClick={onClose} data-testid="close-shift-done">
            {t('finish')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OpenShiftForm({ personal }: { personal: boolean }) {
  const t = useTranslations('posCash.open');
  const user = usePos((state) => state.user);
  const terminal = usePos((state) => state.bootstrap?.terminal.name);
  const [count, setCount] = useState<DenominationCount>({});
  const [busy, setBusy] = useState(false);

  async function confirm() {
    const approval = await permitted('shift.open');
    if (approval === undefined) return;
    setBusy(true);
    try {
      await openShift(count, approval);
      toast.success(t('opened'));
    } catch {
      toast.error(t('failed'));
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-4 rounded-xl border bg-card p-4" data-testid="open-shift">
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold">
          {personal
            ? t('walletTitle', { name: user?.displayName ?? '' })
            : t('tillTitle', { name: terminal ?? '' })}
        </h2>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <DenominationCounter idPrefix="float" value={count} onChange={setCount} />
      <Button
        size="lg"
        disabled={busy}
        onClick={() => void confirm()}
        data-testid="open-shift-confirm"
      >
        {t('confirm', { amount: chf(countTotal(count)) })}
      </Button>
    </section>
  );
}

function OpenShift({
  onClosed,
}: {
  onClosed: (closed: { report: ShiftReport; counted: number }) => void;
}) {
  const t = useTranslations('posCash.shift');
  const format = useFormatter();
  const timeZone = usePos((state) => state.bootstrap?.location.timezone);
  const report = useFoldMemo(() => currentShiftReport(), []);
  const shift = useFoldMemo(() => currentShift(), []);
  const [dialog, setDialog] = useState<'movement' | 'report' | 'close' | null>(null);
  if (!report || !shift) return null;
  const oldDay = shift.businessDate < businessDayNow();

  return (
    <section className="grid gap-4" data-testid="shift-open">
      {oldDay && (
        <p className="rounded-xl border border-warning bg-warning/10 p-3 text-sm" role="status">
          {t('oldDay', { date: shift.businessDate })}
        </p>
      )}
      <div className="grid gap-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">{report.ownerName}</h2>
          <span className="text-sm text-muted-foreground">
            {t('since', {
              time: format.dateTime(new Date(shift.openedAt), {
                timeStyle: 'short',
                dateStyle: 'short',
                timeZone,
              }),
            })}
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <Figure label={t('float')} value={report.cash.openingFloatRappen} />
          <Figure label={t('collected')} value={report.cash.collectedRappen} />
          <Figure label={t('paidOut')} value={-report.cash.paidOutRappen} />
          <Figure label={t('movements')} value={report.cash.movementsRappen} />
        </dl>
        <p className="flex items-baseline justify-between rounded-lg bg-muted px-3 py-2">
          <span className="font-medium">{t('expected')}</span>
          <span className="text-2xl font-bold tabular-nums" data-testid="shift-expected">
            {chf(report.cash.expectedRappen)}
          </span>
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Button
          size="lg"
          variant="outline"
          className="h-auto min-h-14"
          onClick={() => setDialog('movement')}
        >
          <ArrowDownToLine /> {t('movement')}
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="h-auto min-h-14"
          onClick={() => setDialog('report')}
        >
          <FileText /> {t('report')}
        </Button>
        <Button
          size="lg"
          className="col-span-2 h-auto min-h-14 sm:col-span-1"
          onClick={() => setDialog('close')}
          data-testid="close-shift-open"
        >
          <Lock /> {t('close')}
        </Button>
      </div>
      <MovementDialog
        open={dialog === 'movement'}
        onOpenChange={(open) => setDialog(open ? 'movement' : null)}
      />
      <Dialog open={dialog === 'report'} onOpenChange={(open) => setDialog(open ? 'report' : null)}>
        <DialogContent
          className="max-h-[92dvh] overflow-y-auto sm:max-w-lg"
          closeLabel={t('closeDialog')}
        >
          <DialogHeader>
            <DialogTitle>{t('reportTitle')}</DialogTitle>
          </DialogHeader>
          <ShiftReportView report={report} />
          <DialogFooter>
            <Button variant="outline" onClick={() => window.print()}>
              <Receipt /> {t('print')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CloseShiftDialog
        open={dialog === 'close'}
        onOpenChange={(open) => setDialog(open ? 'close' : null)}
        expected={report.cash.expectedRappen}
        onClosed={onClosed}
      />
    </section>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{chf(value)}</dd>
    </div>
  );
}

const MOVEMENT_KINDS = ['cash_in', 'cash_out', 'expense'] as const;

function MovementDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('posCash.movement');
  const [kind, setKind] = useState<(typeof MOVEMENT_KINDS)[number]>('cash_out');
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    const amount = parseAmount(amountText);
    if (amount === null || amount <= 0) return setError(t('invalidAmount'));
    if (reason.trim() === '') return setError(t('reasonRequired'));
    const approval = await permitted('cash.movement');
    if (approval === undefined) return;
    setBusy(true);
    try {
      await recordMovement(kind, amount, reason.trim(), approval);
      toast.success(t('done'));
      setAmountText('');
      setReason('');
      onOpenChange(false);
    } catch {
      setError(t('failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div role="group" aria-label={t('kind')} className="grid grid-cols-3 gap-2">
            {MOVEMENT_KINDS.map((option) => (
              <Button
                key={option}
                type="button"
                variant={kind === option ? 'default' : 'outline'}
                aria-pressed={kind === option}
                className="h-auto min-h-14 flex-col gap-1 whitespace-normal"
                onClick={() => setKind(option)}
              >
                {option === 'cash_in' ? (
                  <ArrowDownToLine aria-hidden />
                ) : (
                  <ArrowUpFromLine aria-hidden />
                )}
                {t(`kind_${option}`)}
              </Button>
            ))}
          </div>
          <Field label={t('amount')} htmlFor="movement-amount">
            <Input
              id="movement-amount"
              inputMode="decimal"
              autoComplete="off"
              className="h-12 text-right text-xl tabular-nums"
              placeholder="0.00"
              value={amountText}
              onChange={(e) => {
                setAmountText(e.currentTarget.value);
                setError(null);
              }}
            />
          </Field>
          <Field label={t('reason')} htmlFor="movement-reason">
            <Input
              id="movement-reason"
              maxLength={500}
              value={reason}
              onChange={(e) => {
                setReason(e.currentTarget.value);
                setError(null);
              }}
            />
          </Field>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button size="lg" disabled={busy} onClick={() => void confirm()}>
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseShiftDialog({
  open,
  onOpenChange,
  expected,
  onClosed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expected: number;
  onClosed: (closed: { report: ShiftReport; counted: number }) => void;
}) {
  const t = useTranslations('posCash.close');
  const [count, setCount] = useState<DenominationCount>({});
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const counted = countTotal(count);
  const difference = counted - expected;

  async function confirm() {
    if (difference !== 0 && comment.trim() === '') return setError(t('commentRequired'));
    const approval = await permitted('shift.close');
    if (approval === undefined) return;
    setBusy(true);
    try {
      const result = await closeShift(count, comment.trim() || null, approval);
      toast.success(t('done'));
      finish(false);
      onClosed({ report: result.report, counted: result.countedRappen });
    } catch {
      setError(t('failed'));
    } finally {
      setBusy(false);
    }
  }

  const finish = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setCount({});
      setComment('');
      setError(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={finish}>
      <DialogContent
        className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl"
        closeLabel={t('closeDialog')}
      >
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <>
          <DenominationCounter idPrefix="close" value={count} onChange={setCount} />
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border p-2">
              <dt className="text-xs text-muted-foreground">{t('expected')}</dt>
              <dd className="font-semibold tabular-nums">{chf(expected)}</dd>
            </div>
            <div className="rounded-lg border p-2">
              <dt className="text-xs text-muted-foreground">{t('counted')}</dt>
              <dd className="font-semibold tabular-nums">{chf(counted)}</dd>
            </div>
            <div
              className={cn(
                'rounded-lg border p-2',
                difference !== 0 && 'border-destructive bg-destructive/10 text-destructive',
              )}
            >
              <dt className="text-xs">{t('difference')}</dt>
              <dd className="font-semibold tabular-nums" data-testid="close-difference">
                {chf(difference)}
              </dd>
            </div>
          </dl>
          {difference !== 0 && (
            <Field label={t('comment')} htmlFor="close-comment">
              <Input
                id="close-comment"
                maxLength={500}
                value={comment}
                data-testid="close-comment"
                onChange={(e) => {
                  setComment(e.currentTarget.value);
                  setError(null);
                }}
              />
            </Field>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              size="lg"
              disabled={busy}
              onClick={() => void confirm()}
              data-testid="close-shift-confirm"
            >
              {t('confirm')}
            </Button>
          </DialogFooter>
        </>
      </DialogContent>
    </Dialog>
  );
}
