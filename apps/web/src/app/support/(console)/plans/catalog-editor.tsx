'use client';

import type { platform } from '@pos/api';
import { PLAN_FEATURES, PLAN_LIMITS, type PlanFeature, type PlanLimit } from '@pos/core';
import { Button } from '@pos/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@pos/ui/card';
import { Switch } from '@pos/ui/switch';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import { PlusIcon, TrashIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useServerAction } from '@/components/backoffice/use-server-action';
import { saveAddon, savePlan, savePlanPrice } from '../actions';

type Catalog = platform.PlanCatalogDto;

const numberOrNull = (value: string) =>
  value.trim() === '' ? null : Math.max(0, Math.trunc(Number(value) || 0));

function FeatureChecks({
  value,
  onChange,
}: {
  value: readonly PlanFeature[];
  onChange: (next: PlanFeature[]) => void;
}) {
  const t = useTranslations('supportConsole.catalog');
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {PLAN_FEATURES.map((feature) => (
        <label key={feature} className="flex min-h-11 items-center gap-2 text-sm">
          <Switch
            checked={value.includes(feature)}
            onCheckedChange={(checked: boolean) =>
              onChange(
                checked ? [...value, feature] : value.filter((existing) => existing !== feature),
              )
            }
          />
          {t(`features.${feature}`)}
        </label>
      ))}
    </div>
  );
}

function PlanForm({ plan }: { plan: Catalog['plans'][number] | null }) {
  const t = useTranslations('supportConsole.catalog');
  const [code, setCode] = useState(plan?.code ?? '');
  const [name, setName] = useState(plan?.name ?? '');
  const [limits, setLimits] = useState<Record<PlanLimit, string>>(
    Object.fromEntries(
      PLAN_LIMITS.map((limit) => [limit, plan?.limits[limit]?.toString() ?? '']),
    ) as Record<PlanLimit, string>,
  );
  const [features, setFeatures] = useState<PlanFeature[]>([...(plan?.features ?? [])]);
  const [isActive, setActive] = useState(plan?.isActive ?? true);
  const save = useServerAction(() =>
    savePlan({
      code,
      name,
      limits: Object.fromEntries(PLAN_LIMITS.map((l) => [l, numberOrNull(limits[l])])),
      features,
      isActive,
      sortOrder: plan?.sortOrder ?? 9,
    }),
  );
  return (
    <Card data-testid="plan-form">
      <CardHeader>
        <CardTitle className="text-base">{plan ? plan.name : t('newPlan')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('code')}>
            <Input value={code} disabled={!!plan} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label={t('name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {PLAN_LIMITS.map((limit) => (
            <Field key={limit} label={t(`limits.${limit}`)} hint={t('noLimit')}>
              <Input
                type="number"
                min={0}
                value={limits[limit]}
                onChange={(e) => setLimits({ ...limits, [limit]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        <FeatureChecks value={features} onChange={setFeatures} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <Switch checked={isActive} onCheckedChange={(checked: boolean) => setActive(checked)} />
            {t('active')}
          </label>
          <Button onClick={() => void save.run()} disabled={save.pending || !code || !name}>
            {t('save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AddonForm({ addon }: { addon: Catalog['addons'][number] | null }) {
  const t = useTranslations('supportConsole.catalog');
  const [code, setCode] = useState(addon?.code ?? '');
  const [name, setName] = useState(addon?.name ?? '');
  const [adds, setAdds] = useState<Record<PlanLimit, string>>(
    Object.fromEntries(
      PLAN_LIMITS.map((limit) => [limit, addon?.adds[limit]?.toString() ?? '']),
    ) as Record<PlanLimit, string>,
  );
  const [features, setFeatures] = useState<PlanFeature[]>([...(addon?.features ?? [])]);
  const [isActive, setActive] = useState(addon?.isActive ?? true);
  const save = useServerAction(() =>
    saveAddon({
      code,
      name,
      adds: Object.fromEntries(
        PLAN_LIMITS.flatMap((l) => (numberOrNull(adds[l]) ? [[l, numberOrNull(adds[l])]] : [])),
      ),
      features,
      isActive,
    }),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{addon ? addon.name : t('newAddon')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('code')}>
            <Input value={code} disabled={!!addon} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label={t('name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {PLAN_LIMITS.map((limit) => (
            <Field key={limit} label={t('adds', { limit: t(`limits.${limit}`) })}>
              <Input
                type="number"
                min={0}
                value={adds[limit]}
                onChange={(e) => setAdds({ ...adds, [limit]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        <FeatureChecks value={features} onChange={setFeatures} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <Switch checked={isActive} onCheckedChange={(checked: boolean) => setActive(checked)} />
            {t('active')}
          </label>
          <Button onClick={() => void save.run()} disabled={save.pending || !code || !name}>
            {t('save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Prices({ catalog }: { catalog: Catalog }) {
  const t = useTranslations('supportConsole.catalog');
  const items = [
    ...catalog.plans.map((plan) => ({ key: `plan:${plan.code}`, label: plan.name })),
    ...catalog.addons.map((addon) => ({ key: `addon:${addon.code}`, label: addon.name })),
  ];
  const [item, setItem] = useState(items[0]?.key ?? '');
  const [country, setCountry] = useState('CH');
  const [currency, setCurrency] = useState('CHF');
  const [amount, setAmount] = useState('');
  const save = useServerAction((input: unknown) => savePlanPrice(input));
  const labelOf = (type: string, code: string) =>
    items.find((entry) => entry.key === `${type}:${code}`)?.label ?? code;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('prices')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('item')}</TableHead>
              <TableHead>{t('country')}</TableHead>
              <TableHead className="text-right">{t('monthly')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {catalog.prices.map((price) => (
              <TableRow
                key={`${price.itemType}:${price.itemCode}:${price.country}:${price.currency}`}
              >
                <TableCell>{labelOf(price.itemType, price.itemCode)}</TableCell>
                <TableCell>{price.country}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {price.currency} {(price.amountMinor / 100).toFixed(2)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('remove')}
                    onClick={() => void save.run({ ...price, amountMinor: null })}
                  >
                    <TrashIcon />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="grid items-end gap-3 sm:grid-cols-5">
          <Field label={t('item')}>
            <Select value={item} onValueChange={setItem}>
              <SelectTrigger aria-label={t('item')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {items.map((entry) => (
                  <SelectItem key={entry.key} value={entry.key}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('country')}>
            <Input
              value={country}
              maxLength={2}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
            />
          </Field>
          <Field label={t('currency')}>
            <Input
              value={currency}
              maxLength={3}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </Field>
          <Field label={t('monthly')}>
            <Input
              inputMode="decimal"
              value={amount}
              placeholder="79.00"
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Button
            disabled={save.pending || !item || amount.trim() === ''}
            onClick={() => {
              const [itemType, itemCode] = item.split(':');
              void save.run({
                itemType,
                itemCode,
                country,
                currency,
                amountMinor: Math.round(
                  Number(amount.replace(/['’\s]/g, '').replace(',', '.')) * 100,
                ),
              });
            }}
          >
            <PlusIcon /> {t('setPrice')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The catalog of plans and add-ons (DEC-045): limits, modules and monthly prices per country.
 * Changing a plan applies to every organization on it at once.
 */
export function CatalogEditor({ catalog }: { catalog: Catalog }) {
  const t = useTranslations('supportConsole.catalog');
  return (
    <div className="grid gap-6">
      <section className="grid gap-4">
        <h2 className="text-lg font-semibold">{t('plans')}</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {catalog.plans.map((plan) => (
            <PlanForm key={plan.code} plan={plan} />
          ))}
          <PlanForm plan={null} />
        </div>
      </section>
      <section className="grid gap-4">
        <h2 className="text-lg font-semibold">{t('addons')}</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {catalog.addons.map((addon) => (
            <AddonForm key={addon.code} addon={addon} />
          ))}
          <AddonForm addon={null} />
        </div>
      </section>
      <Prices catalog={catalog} />
    </div>
  );
}
