'use client';

import { Alert } from '@pos/ui/alert';
import { Button } from '@pos/ui/button';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { closeDayAction } from './actions';
import { useMoney } from '@/components/money';

const toText = (value: number) => (value / 100).toFixed(2);
const parse = (text: string): number | null => {
  const normalized = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
};

/**
 * The Z from the backoffice (RF-D15, RF-D11): the card terminal totals, a reason for any
 * difference, and the closing, which can never be changed afterwards.
 */
export function DayCloseForm({
  businessDate,
  toReconcile,
}: {
  businessDate: string;
  toReconcile: { method: string; posTotalRappen: number }[];
}) {
  const money = useMoney();
  const t = useTranslations('cash.close');
  const tm = useTranslations('posPayment.methods');
  const router = useRouter();
  const [terminal, setTerminal] = useState<Record<string, string>>(() =>
    Object.fromEntries(toReconcile.map((r) => [r.method, toText(r.posTotalRappen)])),
  );
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    const reconciliations = [];
    for (const { method, posTotalRappen } of toReconcile) {
      const typed = parse(terminal[method] ?? '');
      if (typed === null) return setError(t('invalid', { method: tm(method) }));
      const reason = (reasons[method] ?? '').trim();
      if (typed !== posTotalRappen && reason === '') {
        return setError(t('reasonRequired', { method: tm(method) }));
      }
      reconciliations.push({ method, terminalTotalRappen: typed, reason: reason || null });
    }
    if (!window.confirm(t('confirmQuestion', { date: businessDate }))) return;
    setBusy(true);
    setError(null);
    const result = await closeDayAction({ businessDate, reconciliations });
    if (result.ok) {
      router.push(`/backoffice/cash/closings/${result.data.id}`);
      return;
    }
    setBusy(false);
    setError(result.error.code === 'CONFLICT' ? t('blocked') : result.error.message);
    router.refresh();
  }

  return (
    <div className="grid gap-4">
      {toReconcile.map(({ method, posTotalRappen }) => {
        const typed = parse(terminal[method] ?? '');
        const differs = typed !== null && typed !== posTotalRappen;
        return (
          <div key={method} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
            <Field
              label={t('terminalTotal', { method: tm(method) })}
              htmlFor={`terminal-${method}`}
              hint={t('posTotal', { amount: money.format(posTotalRappen) })}
            >
              <Input
                id={`terminal-${method}`}
                inputMode="decimal"
                className="text-right tabular-nums"
                value={terminal[method] ?? ''}
                onChange={(e) => setTerminal({ ...terminal, [method]: e.currentTarget.value })}
              />
            </Field>
            {differs && typed !== null && (
              <Field
                label={t('reason', { difference: money.format(typed - posTotalRappen) })}
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
      {error && <Alert variant="destructive">{error}</Alert>}
      <div>
        <Button size="lg" disabled={busy} onClick={() => void confirm()}>
          {t('confirm')}
        </Button>
      </div>
    </div>
  );
}
