'use client';

import type { platform } from '@pos/api';
import { PLAN_LIMITS, SUBSCRIPTION_STATUSES, type SubscriptionStatus } from '@pos/core';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { CreditCardIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useServerAction } from '@/components/backoffice/use-server-action';
import { loadOrganizationPlan, updateSubscription } from './actions';

interface Catalog {
  plans: { code: string; name: string }[];
  addons: { code: string; name: string }[];
}

/**
 * The plan, add-ons and state of one organization (DEC-045, manual billing): what it uses now
 * against what its plan allows. Lowering never removes anything; it only stops what would exceed.
 */
export function SubscriptionDialog({
  organization,
  catalog,
}: {
  organization: { id: string; name: string };
  catalog: Catalog;
}) {
  const t = useTranslations('supportConsole.plan');
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<platform.OrganizationPlanDto | null>(null);
  const [planCode, setPlanCode] = useState('pro');
  const [status, setStatus] = useState<SubscriptionStatus>('active');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');

  const load = useServerAction(loadOrganizationPlan, {
    successMessage: false,
    onSuccess: (data) => {
      setCurrent(data);
      setPlanCode(data.subscription?.planCode ?? 'pro');
      setStatus(data.subscription?.status ?? 'active');
      setQuantities(
        Object.fromEntries((data.subscription?.addons ?? []).map((a) => [a.code, a.quantity])),
      );
      setNote(data.subscription?.note ?? '');
    },
  });
  const save = useServerAction(
    () =>
      updateSubscription(organization.id, {
        planCode,
        status,
        note: note.trim() || null,
        addons: Object.entries(quantities)
          .filter(([, quantity]) => quantity > 0)
          .map(([code, quantity]) => ({ code, quantity })),
      }),
    {
      onSuccess: (data) => {
        setCurrent(data);
        setOpen(false);
      },
    },
  );

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('edit', { name: organization.name })}
        title={t('edit', { name: organization.name })}
        onClick={() => {
          setOpen(true);
          void load.run(organization.id);
        }}
      >
        <CreditCardIcon />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('title', { name: organization.name })}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          {current && (
            <dl
              className="grid grid-cols-3 gap-2 rounded-lg border p-3 text-sm"
              data-testid="plan-usage"
            >
              {PLAN_LIMITS.map((limit) => (
                <div key={limit} className="grid">
                  <dt className="text-muted-foreground">{t(`limits.${limit}`)}</dt>
                  <dd className="font-medium tabular-nums">
                    {current.usage[limit]} / {current.limits[limit] ?? '∞'}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('plan')}>
              <Select value={planCode} onValueChange={setPlanCode}>
                <SelectTrigger aria-label={t('plan')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {catalog.plans.map((plan) => (
                    <SelectItem key={plan.code} value={plan.code}>
                      {plan.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('status')}>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as SubscriptionStatus)}
              >
                <SelectTrigger aria-label={t('status')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBSCRIPTION_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`statuses.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid gap-2">
            <p className="text-sm font-medium">{t('addons')}</p>
            {catalog.addons.map((addon) => (
              <label key={addon.code} className="flex items-center justify-between gap-3 text-sm">
                {addon.name}
                <Input
                  type="number"
                  min={0}
                  max={1000}
                  className="w-24"
                  aria-label={addon.name}
                  value={quantities[addon.code] ?? 0}
                  onChange={(event) =>
                    setQuantities({
                      ...quantities,
                      [addon.code]: Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                    })
                  }
                />
              </label>
            ))}
          </div>
          <Field label={t('note')} htmlFor={`note-${organization.id}`}>
            <Input
              id={`note-${organization.id}`}
              value={note}
              maxLength={500}
              placeholder={t('notePlaceholder')}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={() => void save.run()} disabled={save.pending || load.pending}>
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
