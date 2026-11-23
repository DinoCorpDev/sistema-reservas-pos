'use client';

import type { admin } from '@pos/api';
import { CONSUMPTION_TYPES, TAX_RATE_CODES } from '@pos/core';
import { Alert, AlertDescription, AlertTitle } from '@pos/ui/alert';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@pos/ui/dialog';
import { Input } from '@pos/ui/input';
import { Field, Label } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { Checkbox } from '@pos/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import { InfoIcon, PlusIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState, useTransition } from 'react';
import {
  formatIsoDate,
  formatRateBp,
  parsePercentToBp,
} from '@/components/backoffice/admin/format';
import { useServerAction } from '@/components/backoffice/use-server-action';
import * as actions from './actions';

type Period = { validFrom: string; validTo: string | null };
type Status = 'current' | 'future' | 'past';

const statusOf = (period: Period, date: string): Status =>
  period.validFrom > date
    ? 'future'
    : period.validTo !== null && period.validTo < date
      ? 'past'
      : 'current';

const STATUS_VARIANT = { current: 'success', future: 'secondary', past: 'outline' } as const;

interface RateDraft {
  code: string;
  percent: string;
  validFrom: string;
  validTo: string;
  closePrevious: boolean;
}

interface RuleDraft {
  taxCategoryId: string;
  consumptionType: string;
  rateCode: string;
  validFrom: string;
  validTo: string;
  closePrevious: boolean;
}

function useTaxLabels() {
  const t = useTranslations('tax');
  return {
    category: (key: string) => (t.has(`categoryKeys.${key}`) ? t(`categoryKeys.${key}`) : key),
    rateCode: (code: string) => (t.has(`rateCodes.${code}`) ? t(`rateCodes.${code}`) : code),
    consumption: (type: string) =>
      t.has(`consumptionTypes.${type}`) ? t(`consumptionTypes.${type}`) : type,
    status: (status: Status) => t(`status.${status}`),
  };
}

/** MWST administration (RF-B12, RF-B13): matrix in force, categories, rates and rules. */
export function TaxManager({
  overview,
  today,
  canEdit,
}: {
  overview: admin.TaxOverviewDto;
  today: string;
  canEdit: boolean;
}) {
  const t = useTranslations('tax');
  const tc = useTranslations('common');
  const label = useTaxLabels();
  const [rateDraft, setRateDraft] = useState<RateDraft | null>(null);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null);
  const [percentInvalid, setPercentInvalid] = useState(false);
  const [overlap, setOverlap] = useState(false);

  const createRate = useServerAction(actions.createTaxRate, {
    onSuccess: () => setRateDraft(null),
  });
  const createRule = useServerAction(actions.createTaxRule, {
    onSuccess: () => setRuleDraft(null),
  });

  const categoryName = (id: string) => overview.categories.find((c) => c.id === id)?.name ?? '—';
  const entryOf = (key: string, type: string) =>
    overview.matrix.find((e) => e.taxCategoryKey === key && e.consumptionType === type);
  /** Rate of a code in force on the matrix date, to show next to the code in the rule dialog. */
  const rateInForce = (code: string) =>
    overview.rates.find((r) => r.code === code && statusOf(r, overview.date) === 'current');

  const openRateDialog = () => {
    setPercentInvalid(false);
    setOverlap(false);
    setRateDraft({
      code: 'normal',
      percent: '',
      validFrom: today,
      validTo: '',
      closePrevious: true,
    });
  };
  const openRuleDialog = () => {
    setOverlap(false);
    setRuleDraft({
      taxCategoryId: overview.categories[0]?.id ?? '',
      consumptionType: 'on_premise',
      rateCode: 'normal',
      validFrom: today,
      validTo: '',
      closePrevious: true,
    });
  };

  const submitRate = async (event: FormEvent) => {
    event.preventDefault();
    if (!rateDraft) return;
    const rateBp = parsePercentToBp(rateDraft.percent);
    setPercentInvalid(rateBp === null);
    setOverlap(false);
    if (rateBp === null) return;
    const result = await createRate.run({
      code: rateDraft.code,
      rateBp,
      validFrom: rateDraft.validFrom,
      validTo: rateDraft.validTo || null,
      closePrevious: rateDraft.closePrevious,
    });
    if (!result.ok && result.error.code === 'CONFLICT') setOverlap(true);
  };

  const submitRule = async (event: FormEvent) => {
    event.preventDefault();
    if (!ruleDraft) return;
    setOverlap(false);
    const result = await createRule.run({
      taxCategoryId: ruleDraft.taxCategoryId,
      consumptionType: ruleDraft.consumptionType,
      rateCode: ruleDraft.rateCode,
      validFrom: ruleDraft.validFrom,
      validTo: ruleDraft.validTo || null,
      closePrevious: ruleDraft.closePrevious,
    });
    if (!result.ok && result.error.code === 'CONFLICT') setOverlap(true);
  };

  return (
    <div className="grid gap-6">
      <Alert icon={false} variant="info" className="grid-cols-[auto_1fr] gap-x-3">
        <InfoIcon className="row-span-2 size-5 text-brand-strong" aria-hidden />
        <AlertTitle>{t('frozenTitle')}</AlertTitle>
        <AlertDescription>
          {t('frozenText')}
          {canEdit ? null : <span className="mt-1 block">{t('readOnly')}</span>}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="flex-row flex-wrap items-end justify-between gap-4">
          <div className="grid gap-1">
            <CardTitle>{t('matrix')}</CardTitle>
            <CardDescription>
              {t('matrixHint', { date: formatIsoDate(overview.date) })}
            </CardDescription>
          </div>
          <PreviewDateForm key={overview.date} date={overview.date} today={today} />
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('category')}</TableHead>
              {CONSUMPTION_TYPES.map((type) => (
                <TableHead key={type}>{label.consumption(type)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.categories.map((category) => (
              <TableRow key={category.id}>
                <TableCell className="font-medium">{category.name}</TableCell>
                {CONSUMPTION_TYPES.map((type) => {
                  const entry = entryOf(category.key, type);
                  return (
                    <TableCell key={type}>
                      {!entry ? (
                        '—'
                      ) : 'rateBp' in entry ? (
                        <span className="grid">
                          <span className="font-medium tabular-nums">
                            {formatRateBp(entry.rateBp)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {label.rateCode(entry.rateCode)}
                          </span>
                        </span>
                      ) : (
                        <Badge variant="destructive" title={entry.message}>
                          {t.has(`matrixErrors.${entry.error}`)
                            ? t(`matrixErrors.${entry.error}`)
                            : entry.error}
                        </Badge>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('categories')}</CardTitle>
          <CardDescription>{t('categoriesHint')}</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('key')}</TableHead>
              <TableHead>{t('label')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.categories.map((category) => (
              <CategoryRow
                key={`${category.id}:${category.name}`}
                category={category}
                keyLabel={label.category(category.key)}
                canEdit={canEdit}
              />
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
          <div className="grid gap-1">
            <CardTitle>{t('rates')}</CardTitle>
            <CardDescription>{t('ratesHint')}</CardDescription>
          </div>
          {canEdit ? (
            <Button onClick={openRateDialog}>
              <PlusIcon /> {t('newRate')}
            </Button>
          ) : null}
        </CardHeader>
        {overview.rates.length === 0 ? (
          <p className="text-muted-foreground">{tc('empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('code')}</TableHead>
                <TableHead className="text-right">{t('rate')}</TableHead>
                <TableHead>{t('validFrom')}</TableHead>
                <TableHead>{t('validTo')}</TableHead>
                <TableHead>{t('statusLabel')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.rates.map((rate) => {
                const status = statusOf(rate, today);
                return (
                  <TableRow key={rate.id}>
                    <TableCell className="font-medium">{label.rateCode(rate.code)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRateBp(rate.rateBp)}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatIsoDate(rate.validFrom)}</TableCell>
                    <TableCell className="tabular-nums">
                      {rate.validTo ? formatIsoDate(rate.validTo) : t('openEnded')}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[status]}>{label.status(status)}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
          <div className="grid gap-1">
            <CardTitle>{t('rules')}</CardTitle>
            <CardDescription>{t('rulesHint')}</CardDescription>
          </div>
          {canEdit && overview.categories.length > 0 ? (
            <Button onClick={openRuleDialog}>
              <PlusIcon /> {t('newRule')}
            </Button>
          ) : null}
        </CardHeader>
        {overview.rules.length === 0 ? (
          <p className="text-muted-foreground">{tc('empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('category')}</TableHead>
                <TableHead>{t('consumptionType')}</TableHead>
                <TableHead>{t('code')}</TableHead>
                <TableHead>{t('validFrom')}</TableHead>
                <TableHead>{t('validTo')}</TableHead>
                <TableHead>{t('statusLabel')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.rules.map((rule) => {
                const status = statusOf(rule, today);
                return (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">
                      {categoryName(rule.taxCategoryId)}
                    </TableCell>
                    <TableCell>{label.consumption(rule.consumptionType)}</TableCell>
                    <TableCell>{label.rateCode(rule.rateCode)}</TableCell>
                    <TableCell className="tabular-nums">{formatIsoDate(rule.validFrom)}</TableCell>
                    <TableCell className="tabular-nums">
                      {rule.validTo ? formatIsoDate(rule.validTo) : t('openEnded')}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[status]}>{label.status(status)}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={!!rateDraft} onOpenChange={(open) => !open && setRateDraft(null)}>
        <DialogContent closeLabel={tc('close')}>
          {rateDraft ? (
            <form className="grid gap-4" onSubmit={submitRate}>
              <DialogHeader>
                <DialogTitle>{t('newRate')}</DialogTitle>
                <DialogDescription>{t('ratesHint')}</DialogDescription>
              </DialogHeader>
              <Field label={t('code')}>
                <Select
                  value={rateDraft.code}
                  onValueChange={(code) => setRateDraft({ ...rateDraft, code })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TAX_RATE_CODES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {label.rateCode(code)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label={t('ratePercent')}
                htmlFor="rate-percent"
                hint={t('ratePercentHint')}
                error={percentInvalid ? t('rateInvalid') : createRate.fieldErrors.rateBp}
              >
                <div className="relative">
                  <Input
                    id="rate-percent"
                    inputMode="decimal"
                    autoComplete="off"
                    required
                    autoFocus
                    className="pr-10 tabular-nums"
                    value={rateDraft.percent}
                    aria-invalid={percentInvalid || !!createRate.fieldErrors.rateBp}
                    onChange={(e) => setRateDraft({ ...rateDraft, percent: e.target.value })}
                  />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">
                    %
                  </span>
                </div>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={t('validFrom')}
                  htmlFor="rate-from"
                  error={createRate.fieldErrors.validFrom}
                >
                  <Input
                    id="rate-from"
                    type="date"
                    required
                    value={rateDraft.validFrom}
                    onChange={(e) => setRateDraft({ ...rateDraft, validFrom: e.target.value })}
                  />
                </Field>
                <Field
                  label={t('validTo')}
                  htmlFor="rate-to"
                  hint={t('validToHint')}
                  error={createRate.fieldErrors.validTo}
                >
                  <Input
                    id="rate-to"
                    type="date"
                    min={rateDraft.validFrom}
                    value={rateDraft.validTo}
                    onChange={(e) => setRateDraft({ ...rateDraft, validTo: e.target.value })}
                  />
                </Field>
              </div>
              <ClosePreviousField
                id="rate-close"
                label={t('closePreviousRate')}
                hint={t('closePreviousHint')}
                checked={rateDraft.closePrevious}
                onChange={(closePrevious) => setRateDraft({ ...rateDraft, closePrevious })}
              />
              {overlap ? <Alert variant="destructive">{t('overlap')}</Alert> : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setRateDraft(null)}>
                  {tc('cancel')}
                </Button>
                <Button type="submit" disabled={createRate.pending}>
                  {createRate.pending ? tc('saving') : tc('create')}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!ruleDraft} onOpenChange={(open) => !open && setRuleDraft(null)}>
        <DialogContent closeLabel={tc('close')}>
          {ruleDraft ? (
            <form className="grid gap-4" onSubmit={submitRule}>
              <DialogHeader>
                <DialogTitle>{t('newRule')}</DialogTitle>
                <DialogDescription>{t('rulesHint')}</DialogDescription>
              </DialogHeader>
              <Field label={t('category')} error={createRule.fieldErrors.taxCategoryId}>
                <Select
                  value={ruleDraft.taxCategoryId}
                  onValueChange={(taxCategoryId) => setRuleDraft({ ...ruleDraft, taxCategoryId })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {overview.categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('consumptionType')}>
                  <Select
                    value={ruleDraft.consumptionType}
                    onValueChange={(consumptionType) =>
                      setRuleDraft({ ...ruleDraft, consumptionType })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONSUMPTION_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {label.consumption(type)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t('code')}>
                  <Select
                    value={ruleDraft.rateCode}
                    onValueChange={(rateCode) => setRuleDraft({ ...ruleDraft, rateCode })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TAX_RATE_CODES.map((code) => {
                        const rate = rateInForce(code);
                        return (
                          <SelectItem key={code} value={code}>
                            {label.rateCode(code)}
                            {rate ? ` (${formatRateBp(rate.rateBp)})` : ''}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={t('validFrom')}
                  htmlFor="rule-from"
                  error={createRule.fieldErrors.validFrom}
                >
                  <Input
                    id="rule-from"
                    type="date"
                    required
                    value={ruleDraft.validFrom}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, validFrom: e.target.value })}
                  />
                </Field>
                <Field
                  label={t('validTo')}
                  htmlFor="rule-to"
                  hint={t('validToHint')}
                  error={createRule.fieldErrors.validTo}
                >
                  <Input
                    id="rule-to"
                    type="date"
                    min={ruleDraft.validFrom}
                    value={ruleDraft.validTo}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, validTo: e.target.value })}
                  />
                </Field>
              </div>
              <ClosePreviousField
                id="rule-close"
                label={t('closePreviousRule')}
                hint={t('closePreviousHint')}
                checked={ruleDraft.closePrevious}
                onChange={(closePrevious) => setRuleDraft({ ...ruleDraft, closePrevious })}
              />
              {overlap ? <Alert variant="destructive">{t('overlap')}</Alert> : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setRuleDraft(null)}>
                  {tc('cancel')}
                </Button>
                <Button type="submit" disabled={createRule.pending}>
                  {createRule.pending ? tc('saving') : tc('create')}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Date to resolve the matrix on; today shows the rates in force now. */
function PreviewDateForm({ date, today }: { date: string; today: string }) {
  const t = useTranslations('tax');
  const router = useRouter();
  const [value, setValue] = useState(date);
  const [pending, startTransition] = useTransition();
  const show = (next: string) =>
    startTransition(() =>
      router.push(next === today ? '/backoffice/tax' : `/backoffice/tax?date=${next}`, {
        scroll: false,
      }),
    );

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (value) show(value);
      }}
    >
      <Field label={t('previewDate')} htmlFor="tax-preview-date">
        <Input
          id="tax-preview-date"
          type="date"
          required
          className="w-44"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      <Button type="submit" variant="outline" disabled={pending}>
        {t('show')}
      </Button>
      {date !== today ? (
        <Button type="button" variant="ghost" disabled={pending} onClick={() => show(today)}>
          {t('today')}
        </Button>
      ) : null}
    </form>
  );
}

/** Inline rename of a tax category (the key never changes). */
function CategoryRow({
  category,
  keyLabel,
  canEdit,
}: {
  category: admin.TaxCategoryDto;
  keyLabel: string;
  canEdit: boolean;
}) {
  const t = useTranslations('tax');
  const tc = useTranslations('common');
  const [name, setName] = useState(category.name);
  const rename = useServerAction(actions.renameTaxCategory);
  const trimmed = name.trim();
  const dirty = trimmed !== '' && trimmed !== category.name;

  return (
    <TableRow>
      <TableCell>
        <span className="block">{keyLabel}</span>
        <span className="font-mono text-xs text-muted-foreground">{category.key}</span>
      </TableCell>
      <TableCell>
        {canEdit ? (
          <form
            className="grid gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              if (dirty) void rename.run(category.id, { name: trimmed });
            }}
          >
            <div className="flex items-center gap-2">
              <Input
                aria-label={`${t('label')}: ${keyLabel}`}
                className="min-w-40"
                required
                maxLength={100}
                value={name}
                aria-invalid={!!rename.fieldErrors.name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button type="submit" variant="outline" disabled={!dirty || rename.pending}>
                {tc('save')}
              </Button>
            </div>
            {rename.fieldErrors.name ? (
              <p className="text-sm text-destructive" role="alert">
                {rename.fieldErrors.name}
              </p>
            ) : null}
          </form>
        ) : (
          <span className="font-medium">{category.name}</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function ClosePreviousField({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <div className="grid gap-1">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
