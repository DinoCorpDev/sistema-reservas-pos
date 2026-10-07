'use client';

import { formatChf, type ReceiptContent, renderReceiptText } from '@pos/core';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Check, Printer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { usePosUi } from '../ui-store';
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
 * The receipt of a payment as it was frozen (DEC-024), printed through the browser in Phase 2
 * (DEC-027); a reprint shows "KOPIE" with the time (RF-D24). From here the cashier prints,
 * continues collecting what is still open (mixed and split payments) or is done.
 */
export function ReceiptView({
  orderId,
  content,
  copyAt,
}: {
  orderId: string;
  content: ReceiptContent;
  copyAt?: string;
}) {
  const t = useTranslations('posPayment.receipt');
  const navigate = usePosUi((state) => state.navigate);
  const fold = useFold();
  const text = useMemo(() => renderReceiptText(content, { copyAt }).join('\n'), [content, copyAt]);

  const order = fold.orders.get(orderId);
  const next = nextToCollect(fold, orderId);
  const nextOrder = next ? fold.orders.get(next) : undefined;
  const done = () => navigate(order?.tableId ? { name: 'floor' } : { name: 'orders' });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 print:block print:overflow-visible print:p-0">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <div className="mr-auto grid gap-1">
          <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            {t('title', { number: content.receiptNumber })}
            {copyAt && <Badge variant="warning">{t('copy')}</Badge>}
            {content.partial && !copyAt && <Badge variant="secondary">{t('partial')}</Badge>}
          </h1>
          {!copyAt && (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {nextOrder && nextOrder.id !== orderId
                ? t('nextOrder', {
                    number: nextOrder.displayNumber,
                    amount: formatChf(nextOrder.balanceRappen),
                  })
                : order && order.balanceRappen > 0
                  ? t('balanceLeft', { amount: formatChf(order.balanceRappen) })
                  : t('paidInFull')}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="lg" variant={next ? 'outline' : 'default'} onClick={() => window.print()}>
            <Printer /> {t('print')}
          </Button>
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
          className="w-fit max-w-full overflow-x-auto rounded-md border bg-white px-4 py-5 font-mono text-[11px] leading-snug whitespace-pre text-black shadow-sm sm:text-[13px]"
        >
          {text}
        </pre>
      </div>
    </div>
  );
}
