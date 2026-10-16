'use client';

import { type PaymentState, type Rappen, rappen } from '@pos/core';
import { formatPosMoney, roundPosCash } from '@/pos/money';
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
import { NoShiftError, refundPayment } from '../../actions';
import { requestApproval } from '../../ui-store';
import { useFold } from './hooks';
import { parseAmount, refundableOf, toAmountText } from './model';

const REASON_PRESETS = ['complaint', 'wrongEntry', 'duplicate'] as const;

/**
 * Refund of a payment, total or partial (RF-D07, RN-14): always linked to the original payment
 * and by the same method, with a mandatory reason and a manager's approval when the person on
 * the terminal may not refund alone or the amount is above the location's threshold (RN-15).
 */
export function RefundDialog({
  orderId,
  payment,
  onOpenChange,
  onDone,
}: {
  orderId: string;
  payment: PaymentState | null;
  onOpenChange: (open: boolean) => void;
  /** Called with the total handed back (sale part + tip). */
  onDone: (totalRappen: Rappen) => void;
}) {
  const t = useTranslations('posPayment.refund');
  const tm = useTranslations('posPayment.methods');
  return (
    <Dialog open={payment !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {payment
              ? t('description', {
                  method: tm(payment.method),
                  amount: formatPosMoney(payment.amountRappen),
                })
              : null}
          </DialogDescription>
        </DialogHeader>
        {payment && (
          <RefundBody
            orderId={orderId}
            payment={payment}
            onCancel={() => onOpenChange(false)}
            onDone={onDone}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RefundBody({
  orderId,
  payment,
  onCancel,
  onDone,
}: {
  orderId: string;
  payment: PaymentState;
  onCancel: () => void;
  onDone: (totalRappen: Rappen) => void;
}) {
  const t = useTranslations('posPayment.refund');
  const fold = useFold();
  const refundable = refundableOf(fold, payment);
  const [amountText, setAmountText] = useState(() => toAmountText(refundable.amountRappen));
  const [tipText, setTipText] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const amount = parseAmount(amountText);
  const tip = tipText.trim() === '' ? rappen(0) : parseAmount(tipText);
  const total = amount !== null && tip !== null ? rappen(amount + tip) : null;
  // Cash goes back rounded to CHF 0.05, like it was collected (RN-06, DEC-038).
  const handBack =
    total === null ? null : payment.method === 'cash' ? roundPosCash(total).payable : total;
  const tcash = useTranslations('posCash.payment');

  async function confirm() {
    if (busy) return;
    if (amount === null || amount <= 0 || amount > refundable.amountRappen) {
      setError(
        t('errors.amount', {
          min: formatPosMoney(rappen(1)),
          max: formatPosMoney(refundable.amountRappen),
        }),
      );
      return;
    }
    if (tip === null || tip > refundable.tipRappen) {
      setError(t('errors.tip', { max: formatPosMoney(refundable.tipRappen) }));
      return;
    }
    const text = reason.trim();
    if (text === '') {
      setError(t('errors.reason'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const decision = await requestApproval({ kind: 'refund', amountRappen: amount });
      if (decision === null) {
        setBusy(false);
        return;
      }
      await refundPayment(
        orderId,
        payment.id,
        { amountRappen: amount, tipRappen: tip, reason: text },
        decision === 'allowed' ? null : decision,
      );
      onDone(handBack ?? rappen(amount + tip));
    } catch (caught) {
      setError(caught instanceof NoShiftError ? tcash('noShift') : t('errors.failed'));
      setBusy(false);
    }
  }

  return (
    <>
      <div className="grid gap-4">
        <Field
          label={t('amount')}
          htmlFor="refund-amount"
          hint={t('max', { amount: formatPosMoney(refundable.amountRappen) })}
        >
          <Input
            id="refund-amount"
            inputMode="decimal"
            autoComplete="off"
            value={amountText}
            className="h-12 text-right text-xl font-semibold tabular-nums"
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              setAmountText(event.currentTarget.value);
              setError(null);
            }}
          />
        </Field>
        {refundable.tipRappen > 0 && (
          <Field
            label={t('tip')}
            htmlFor="refund-tip"
            hint={t('tipMax', { amount: formatPosMoney(refundable.tipRappen) })}
          >
            <Input
              id="refund-tip"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={tipText}
              className="h-12 text-right text-xl tabular-nums"
              onChange={(event) => {
                setTipText(event.currentTarget.value);
                setError(null);
              }}
            />
          </Field>
        )}
        <Field label={t('reason')} htmlFor="refund-reason">
          <Input
            id="refund-reason"
            maxLength={500}
            value={reason}
            aria-required
            onChange={(event) => {
              setReason(event.currentTarget.value);
              setError(null);
            }}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          {REASON_PRESETS.map((preset) => (
            <Button
              key={preset}
              type="button"
              variant="secondary"
              onClick={() => {
                setReason(t(`reasons.${preset}`));
                setError(null);
              }}
            >
              {t(`reasons.${preset}`)}
            </Button>
          ))}
        </div>
        {handBack !== null && handBack > 0 && (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm" data-testid="refund-hand-back">
            {payment.method === 'cash'
              ? t('handBackCash', { amount: formatPosMoney(handBack) })
              : t('handBackTerminal', { amount: formatPosMoney(handBack) })}
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button type="button" variant="destructive" disabled={busy} onClick={() => void confirm()}>
          {t('confirm')}
        </Button>
      </DialogFooter>
    </>
  );
}
