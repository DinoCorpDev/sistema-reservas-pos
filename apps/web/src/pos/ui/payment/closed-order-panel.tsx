'use client';

import {
  type FoldState,
  formatChf,
  type PaymentState,
  paymentsOf,
  rappen,
  refundsOf,
} from '@pos/core';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Copy, LockOpen, Undo2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { reprintReceipt } from '../../actions';
import { usePosUi } from '../../ui-store';
import { useFold } from './hooks';
import { refundableOf } from './model';
import { RefundDialog } from './refund-dialog';
import { ReopenDialog } from './reopen-dialog';

const copiesOf = (fold: FoldState, receiptId: string) => {
  let count = 0;
  for (const receipt of fold.receipts.values())
    if (receipt.copyOfReceiptId === receiptId) count += 1;
  return count;
};

/**
 * Payments of an order with their receipts and refunds, and the corrections a closed order
 * allows: a copy of a receipt (RF-D24, RN-09), a refund linked to its payment (RF-D07, RN-14)
 * and reopening the order (RF-C14). Works for open orders too (copies and refunds).
 */
export function ClosedOrderPanel({ orderId }: { orderId: string }) {
  const t = useTranslations('posPayment.closed');
  const tm = useTranslations('posPayment.methods');
  const format = useFormatter();
  const navigate = usePosUi((state) => state.navigate);
  const fold = useFold();
  const [refunding, setRefunding] = useState<PaymentState | null>(null);
  const [reopening, setReopening] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const order = fold.orders.get(orderId);
  if (!order) return null;
  const payments = paymentsOf(fold, orderId).sort((a, b) =>
    a.completedAt.localeCompare(b.completedAt),
  );
  const refunds = refundsOf(fold, orderId).sort((a, b) => a.refundedAt.localeCompare(b.refundedAt));
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'short' });

  async function printCopy(payment: PaymentState) {
    if (busy) return;
    setBusy(payment.id);
    setError(null);
    try {
      const { content, copyAt, printedByHub } = await reprintReceipt(orderId, payment.receiptId);
      navigate({ name: 'receipt', orderId, content, copyAt, printedByHub });
    } catch {
      setError(t('failed'));
      setBusy(null);
    }
  }

  return (
    <section
      aria-labelledby={`order-payments-${orderId}`}
      className="grid gap-3 rounded-xl border bg-card p-4"
      data-testid="closed-order-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`order-payments-${orderId}`} className="text-base font-semibold">
          {t('title')}
        </h2>
        {order.status === 'closed' && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setNotice(null);
              setReopening(true);
            }}
          >
            <LockOpen /> {t('reopen')}
          </Button>
        )}
      </div>

      {notice && (
        <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success" aria-live="polite">
          {notice}
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noPayments')}</p>
      ) : (
        <ul className="grid gap-2">
          {payments.map((payment) => {
            const receipt = fold.receipts.get(payment.receiptId);
            const copies = copiesOf(fold, payment.receiptId);
            const refundable = refundableOf(fold, payment);
            const paymentRefunds = refunds.filter((refund) => refund.paymentId === payment.id);
            return (
              <li
                key={payment.id}
                className="grid gap-2 rounded-lg border p-3"
                data-testid="payment-row"
                data-payment-id={payment.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid gap-0.5">
                    <p className="font-medium">
                      {tm(payment.method)}
                      {payment.splitLabel ? ` (${payment.splitLabel})` : ''}
                      {' · '}
                      <span className="tabular-nums">{formatChf(payment.amountRappen)}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {when(payment.completedAt)}
                      {receipt ? ` · ${t('receiptNumber', { number: receipt.receiptNumber })}` : ''}
                      {copies > 0 ? ` · ${t('copies', { count: copies })}` : ''}
                    </p>
                    {(payment.tipRappen > 0 || payment.roundingRappen !== 0) && (
                      <p className="text-sm text-muted-foreground tabular-nums">
                        {payment.tipRappen > 0 &&
                          t('tip', { amount: formatChf(payment.tipRappen) })}
                        {payment.tipRappen > 0 && payment.roundingRappen !== 0 ? ' · ' : ''}
                        {payment.roundingRappen !== 0 &&
                          t('rounding', { amount: formatChf(payment.roundingRappen) })}
                      </p>
                    )}
                    {refundable.amountRappen === 0 && (
                      <Badge variant="destructive">{t('refundedFully')}</Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!receipt || busy !== null}
                      onClick={() => void printCopy(payment)}
                    >
                      <Copy /> {t('printCopy')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={refundable.amountRappen <= 0}
                      onClick={() => {
                        setNotice(null);
                        setRefunding(payment);
                      }}
                    >
                      <Undo2 /> {t('refund')}
                    </Button>
                  </div>
                </div>
                {paymentRefunds.length > 0 && (
                  <ul className="grid gap-1 border-t pt-2 text-sm">
                    {paymentRefunds.map((refund) => (
                      <li key={refund.id} className="flex flex-wrap justify-between gap-x-3">
                        <span className="text-destructive tabular-nums">
                          {t('refundLine', {
                            amount: formatChf(rappen(-(refund.amountRappen + refund.tipRappen))),
                          })}
                          {refund.tipRappen > 0 &&
                            ` (${t('refundTip', { amount: formatChf(refund.tipRappen) })})`}
                        </span>
                        <span className="text-muted-foreground">
                          {refund.reason} · {when(refund.refundedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <RefundDialog
        orderId={orderId}
        payment={refunding}
        onOpenChange={(open) => !open && setRefunding(null)}
        onDone={(total) => {
          setRefunding(null);
          setNotice(t('refunded', { amount: formatChf(total) }));
        }}
      />
      <ReopenDialog
        orderId={orderId}
        orderNumber={order.displayNumber}
        open={reopening}
        onOpenChange={setReopening}
        onDone={() => {
          setReopening(false);
          navigate({ name: 'order', orderId });
        }}
      />
    </section>
  );
}
