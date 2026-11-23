'use client';

import { type ReceiptContent, renderReceiptText } from '@pos/core';
import { formatPosMoney } from '@/pos/money';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Check, CircleCheckBig, Printer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { usePos } from '@/device/store';
import { hubReceiptPrinter, printReceipt } from '../actions';
import { usePosUi } from '../ui-store';
import { useRunner } from './order/run';
import { useFold } from './payment/hooks';
import { nextToCollect } from './payment/model';

/**
 * Print only the receipt, on 80 mm paper (DEC-027): everything that neither is the receipt nor
 * contains it is hidden, and its ancestors lose their screen layout. 42 columns of a monospace
 * font at 8 pt take about 71 mm, inside the 80 mm roll with 3 mm on each side.
 */
const PRINT_CSS = `
@media print {
  @page { size: 80mm auto; margin: 0; }
  html, body { background: #fff !important; }
  body *:not(:has(#pos-receipt)):not(#pos-receipt):not(#pos-receipt *) { display: none !important; }
  body *:has(#pos-receipt) {
    display: block !important; position: static !important; margin: 0 !important;
    padding: 0 !important; border: 0 !important; box-shadow: none !important;
    background: none !important; width: auto !important; min-width: 0 !important;
    max-width: none !important; height: auto !important; min-height: 0 !important;
    overflow: visible !important;
  }
  #pos-receipt {
    width: 80mm !important; max-width: none !important; margin: 0 !important;
    padding: 4mm 3mm !important; border: 0 !important; border-radius: 0 !important;
    box-shadow: none !important; background: #fff !important; color: #000 !important;
    font-size: 8pt !important; line-height: 1.25 !important; overflow: visible !important;
    white-space: pre !important;
  }
}
`;

/**
 * The receipt of a payment as it was frozen (DEC-024); a reprint shows "KOPIE" with the time
 * (RF-D24). With a hub and a receipt printer the hub prints it (DEC-031); otherwise the browser
 * does (DEC-027). From here the cashier prints, continues collecting what is still open (mixed
 * and split payments) or is done.
 */
export function ReceiptView({
  orderId,
  content,
  receiptId,
  copyAt,
  printedByHub = false,
}: {
  orderId: string;
  content: ReceiptContent;
  receiptId?: string;
  copyAt?: string;
  printedByHub?: boolean;
}) {
  const t = useTranslations('posPayment.receipt');
  const navigate = usePosUi((state) => state.navigate);
  const goBack = usePosUi((state) => state.goBack);
  const fold = useFold();
  const text = useMemo(() => renderReceiptText(content, { copyAt }).join('\n'), [content, copyAt]);
  // Re-evaluated when the connection or the printer changes.
  usePos((state) => state.sync.level);
  usePos((state) => state.printers);
  const printer = hubReceiptPrinter();
  const [sent, setSent] = useState(printedByHub);
  const run = useRunner();

  async function print() {
    if (printer && receiptId && !copyAt) {
      const result = await run(() => printReceipt(orderId, receiptId));
      if (result.ok) setSent(true);
      return;
    }
    window.print();
  }

  const order = fold.orders.get(orderId);
  const next = nextToCollect(fold, orderId);
  const nextOrder = next ? fold.orders.get(next) : undefined;
  const done = goBack;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 print:block print:overflow-visible print:p-0">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <div className="mr-auto flex items-center gap-3">
          {/* Paid: a large green check, read from across the counter (DEC-053). */}
          <span
            aria-hidden
            className={
              copyAt
                ? 'grid size-12 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground'
                : 'grid size-12 shrink-0 place-items-center rounded-full bg-success/12 text-success ring-8 ring-success/5'
            }
          >
            {copyAt ? <Printer className="size-6" /> : <CircleCheckBig className="size-6" />}
          </span>
          <div className="grid gap-1">
            <h1 className="flex flex-wrap items-center gap-2 font-brand text-xl font-semibold">
              {t('title', { number: content.receiptNumber })}
              {copyAt && <Badge variant="warning">{t('copy')}</Badge>}
              {content.partial && !copyAt && <Badge variant="secondary">{t('partial')}</Badge>}
            </h1>
            {!copyAt && (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {nextOrder && nextOrder.id !== orderId
                  ? t('nextOrder', {
                      number: nextOrder.displayNumber,
                      amount: formatPosMoney(nextOrder.balanceRappen),
                    })
                  : order && order.balanceRappen > 0
                    ? t('balanceLeft', { amount: formatPosMoney(order.balanceRappen) })
                    : t('paidInFull')}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sent && (
            <span className="text-sm text-emerald-800" role="status" data-testid="receipt-sent">
              {t('sentToPrinter')}
            </span>
          )}
          {printer?.health && !printer.health.ok && (
            <span className="text-sm text-destructive" role="alert">
              {t('printerProblem', { error: printer.health.error ?? '' })}
            </span>
          )}
          <Button
            size="lg"
            variant={next || sent ? 'outline' : 'default'}
            onClick={() => void print()}
            disabled={sent && Boolean(printer) && !copyAt}
          >
            <Printer /> {t('print')}
          </Button>
          {printer && (
            <Button size="lg" variant="ghost" onClick={() => window.print()}>
              {t('printInBrowser')}
            </Button>
          )}
          {next && (
            <Button size="lg" onClick={() => navigate({ name: 'payment', orderId: next })}>
              {t('continue')}
            </Button>
          )}
          {!next && order?.status === 'open' && (
            <Button
              size="lg"
              variant="outline"
              onClick={() => navigate({ name: 'order', orderId })}
            >
              {t('toOrder')}
            </Button>
          )}
          <Button size="lg" variant="outline" onClick={done}>
            <Check /> {t('done')}
          </Button>
        </div>
      </div>
      <div className="flex justify-center print:block">
        <pre
          id="pos-receipt"
          data-testid="receipt-text"
          lang={content.language}
          className="w-fit max-w-full overflow-x-auto rounded-lg border bg-white px-5 py-6 font-mono text-[11px] leading-snug whitespace-pre text-black shadow-raised sm:text-[13px]"
        >
          {text}
        </pre>
      </div>
    </div>
  );
}
