import { platform } from '@pos/api';
import { PLAN_FEATURES, PLAN_LIMITS } from '@pos/core';
import { Alert } from '@pos/ui/alert';
import { Badge } from '@pos/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import { CheckIcon, LockIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';

export const metadata: Metadata = { title: 'Plan' };

/**
 * «My plan» (DEC-045): what the restaurant bought and uses — devices, people, locations —, its
 * add-ons and monthly price, and what each module needs. Changes go through DINOLABS.
 */
export default async function MyPlanPage() {
  const actor = await currentActor();
  const t = await getTranslations('myPlan');
  const format = await getFormatter();
  if (!actor.permissions.has('location.manage')) {
    return (
      <>
        <PageHeader title={t('title')} />
        <Alert variant="warning">{t('noPermission')}</Alert>
      </>
    );
  }
  const plan = await platform.getMyPlan(deps(), actor);
  const status = plan.subscription?.status ?? 'active';
  const money = (amountMinor: number, currency: string) =>
    format.number(amountMinor / 100, { style: 'currency', currency });
  const total =
    plan.prices.plan &&
    plan.prices.plan.amountMinor +
      plan.prices.addons.reduce((sum, addon) => {
        const quantity =
          plan.subscription?.addons.find((a) => a.code === addon.code)?.quantity ?? 0;
        return sum + addon.amountMinor * quantity;
      }, 0);

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {status !== 'active' && (
        <Alert variant={status === 'suspended' ? 'destructive' : 'warning'} className="mb-6">
          {t(`statusNotice.${status}`)}
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span data-testid="my-plan-name">{plan.subscription?.planName ?? 'Pro'}</span>
              <Badge
                variant={
                  status === 'active'
                    ? 'success'
                    : status === 'past_due'
                      ? 'warning'
                      : 'destructive'
                }
              >
                {t(`statuses.${status}`)}
              </Badge>
            </CardTitle>
            {plan.prices.plan && total !== null && (
              <CardDescription>
                {t('monthly', { amount: money(total ?? 0, plan.prices.plan.currency) })}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="grid gap-4">
            {PLAN_LIMITS.map((limit) => {
              const allowed = plan.limits[limit];
              const used = plan.usage[limit];
              const share = allowed ? Math.min(1, used / allowed) : 0;
              return (
                <div key={limit} className="grid gap-1" data-testid={`usage-${limit}`}>
                  <div className="flex justify-between text-sm">
                    <span>{t(`limits.${limit}`)}</span>
                    <span className="font-medium tabular-nums">
                      {allowed === null ? t('unlimitedUse', { used }) : t('use', { used, allowed })}
                    </span>
                  </div>
                  {allowed !== null && (
                    <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div
                        className={`h-full rounded-full ${share >= 1 ? 'bg-amber-500' : 'bg-primary'}`}
                        style={{ width: `${share * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {(plan.subscription?.addons.length ?? 0) > 0 && (
              <div className="grid gap-1 border-t pt-3 text-sm">
                <p className="font-medium">{t('addons')}</p>
                {plan.subscription!.addons.map((addon) => {
                  const price = plan.prices.addons.find((p) => p.code === addon.code);
                  return (
                    <div key={addon.code} className="flex justify-between">
                      <span>
                        {addon.quantity} × {addon.name}
                      </span>
                      {price && (
                        <span className="tabular-nums text-muted-foreground">
                          {money(price.amountMinor * addon.quantity, price.currency)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('modules')}</CardTitle>
            <CardDescription>{t('modulesHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2">
              {PLAN_FEATURES.map((feature) => {
                const included = plan.features.includes(feature);
                return (
                  <li
                    key={feature}
                    className="flex items-start gap-2 text-sm"
                    data-testid={`module-${feature}`}
                    data-included={included}
                  >
                    {included ? (
                      <CheckIcon className="mt-0.5 size-4 shrink-0 text-green-600" aria-hidden />
                    ) : (
                      <LockIcon
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    )}
                    <span>
                      {t(`features.${feature}`)}
                      {!included && plan.featurePlans[feature] && (
                        <span className="block text-xs text-muted-foreground">
                          {t('inPlan', { plan: plan.featurePlans[feature] })}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
      <p className="mt-6 text-sm text-muted-foreground">{t('change')}</p>
    </>
  );
}
