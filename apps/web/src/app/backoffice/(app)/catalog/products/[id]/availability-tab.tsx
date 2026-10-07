'use client';

import type { catalog } from '@pos/api';
import { type Channel, CHANNELS } from '@pos/core';
import { Alert } from '@pos/ui/alert';
import { Button } from '@pos/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@pos/ui/card';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { cn } from '@pos/ui/utils';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ALL_DAYS, newRowKey, WEEKDAYS } from '@/components/backoffice/catalog/catalog-data';
import { useDraft } from '@/components/backoffice/catalog/use-draft';
import { useServerAction } from '@/components/backoffice/use-server-action';
import { replaceAvailability } from '../../actions';
import type { TabProps } from './editor-shared';

const EVERYWHERE = 'all';

type RuleRow = {
  key: string;
  id?: string;
  locationId: string | null;
  channel: Channel | null;
  daysOfWeek: number;
  /** `HH:MM`, '' = all day. */
  startTime: string;
  endTime: string;
  /** `YYYY-MM-DD`, '' = open. */
  validFrom: string;
  validTo: string;
};

const rulesOf = (product: catalog.ProductDto): RuleRow[] =>
  product.availability.map((rule) => ({
    key: rule.id,
    id: rule.id,
    locationId: rule.locationId,
    channel: (CHANNELS as readonly string[]).includes(rule.channel ?? '')
      ? (rule.channel as Channel)
      : null,
    daysOfWeek: rule.daysOfWeek,
    startTime: rule.startTime?.slice(0, 5) ?? '',
    endTime: rule.endTime?.slice(0, 5) ?? '',
    validFrom: rule.validFrom ?? '',
    validTo: rule.validTo ?? '',
  }));

type RuleProblem = 'days' | 'bothTimes' | 'sameTimes' | 'dates';

function problemOf(rule: RuleRow): RuleProblem | null {
  if ((rule.daysOfWeek & ALL_DAYS) === 0) return 'days';
  if ((rule.startTime === '') !== (rule.endTime === '')) return 'bothTimes';
  if (rule.startTime !== '' && rule.startTime === rule.endTime) return 'sameTimes';
  if (rule.validFrom && rule.validTo && rule.validFrom > rule.validTo) return 'dates';
  return null;
}

/**
 * Availability by weekday, time window, channel, location and dates (RF-B08). Without rules the
 * product is always available; with rules only when one matches (RN-17).
 */
export function AvailabilityTab({
  product,
  permissions,
  locations,
}: TabProps & { locations: { id: string; name: string }[] }) {
  const t = useTranslations('availability');
  const te = useTranslations('productEditor');
  const tc = useTranslations('common');
  const tch = useTranslations('channels');
  const { draft: rows, dirty, setDraft: setRows, reset } = useDraft(rulesOf(product));
  const [attempted, setAttempted] = useState(false);
  const save = useServerAction((input: unknown) => replaceAvailability(product.id, input), {
    onSuccess: (saved) => {
      setAttempted(false);
      reset(rulesOf(saved));
    },
  });
  const canEdit = permissions.manage;
  const update = (index: number, patch: Partial<RuleRow>) =>
    setRows((list) => list.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (rows.some((row) => problemOf(row) !== null)) return;
    void save.run({
      rules: rows.map((row) => ({
        id: row.id,
        locationId: row.locationId,
        channel: row.channel,
        daysOfWeek: row.daysOfWeek,
        startTime: row.startTime || null,
        endTime: row.endTime || null,
        validFrom: row.validFrom || null,
        validTo: row.validTo || null,
      })),
    });
  };

  return (
    <Card>
      <form className="grid gap-4" onSubmit={submit}>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('hint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="info">
            {rows.length === 0 ? t('alwaysAvailable') : t('onlyWhenMatching')}
          </Alert>
          {rows.length > 0 ? (
            <ul className="grid gap-4">
              {rows.map((row, index) => {
                const problem = attempted ? problemOf(row) : null;
                const serverError = (field: string) => save.fieldErrors[`rules.${index}.${field}`];
                return (
                  <li key={row.key} className="grid gap-4 rounded-lg border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <fieldset className="grid gap-2">
                        <legend className="mb-2 text-sm font-medium">{t('days')}</legend>
                        <div className="flex flex-wrap gap-1.5">
                          {WEEKDAYS.map(({ key, bit }) => {
                            const on = (row.daysOfWeek & bit) !== 0;
                            return (
                              <button
                                key={key}
                                type="button"
                                aria-pressed={on}
                                aria-label={t(`weekdays.${key}`)}
                                disabled={!canEdit}
                                onClick={() => update(index, { daysOfWeek: row.daysOfWeek ^ bit })}
                                className={cn(
                                  'size-11 rounded-lg border text-sm font-medium transition-colors',
                                  'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50',
                                  on
                                    ? 'border-primary bg-primary text-primary-foreground'
                                    : 'bg-background text-muted-foreground hover:bg-accent',
                                )}
                              >
                                {t(`weekdaysShort.${key}`)}
                              </button>
                            );
                          })}
                        </div>
                        {problem === 'days' ? (
                          <p className="text-sm text-destructive" role="alert">
                            {t('problems.days')}
                          </p>
                        ) : null}
                      </fieldset>
                      {canEdit ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t('remove', { index: index + 1 })}
                          onClick={() => setRows((list) => list.filter((_, i) => i !== index))}
                        >
                          <Trash2Icon />
                        </Button>
                      ) : null}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <Field
                        label={t('from')}
                        htmlFor={`rule-${row.key}-start`}
                        hint={t('timeHint')}
                      >
                        <Input
                          id={`rule-${row.key}-start`}
                          type="time"
                          value={row.startTime}
                          disabled={!canEdit}
                          aria-invalid={problem === 'bothTimes' || problem === 'sameTimes'}
                          onChange={(e) => update(index, { startTime: e.target.value })}
                        />
                      </Field>
                      <Field
                        label={t('to')}
                        htmlFor={`rule-${row.key}-end`}
                        hint={t('midnightHint')}
                        error={
                          problem === 'bothTimes' || problem === 'sameTimes'
                            ? t(`problems.${problem}`)
                            : serverError('endTime')
                        }
                      >
                        <Input
                          id={`rule-${row.key}-end`}
                          type="time"
                          value={row.endTime}
                          disabled={!canEdit}
                          aria-invalid={problem === 'bothTimes' || problem === 'sameTimes'}
                          onChange={(e) => update(index, { endTime: e.target.value })}
                        />
                      </Field>
                      <Field label={t('channel')}>
                        <Select
                          value={row.channel ?? EVERYWHERE}
                          disabled={!canEdit}
                          onValueChange={(value) =>
                            update(index, {
                              channel: value === EVERYWHERE ? null : (value as Channel),
                            })
                          }
                        >
                          <SelectTrigger aria-label={t('channel')}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={EVERYWHERE}>{t('allChannels')}</SelectItem>
                            {CHANNELS.map((channel) => (
                              <SelectItem key={channel} value={channel}>
                                {tch(channel)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label={t('location')}>
                        <Select
                          value={row.locationId ?? EVERYWHERE}
                          disabled={!canEdit}
                          onValueChange={(value) =>
                            update(index, { locationId: value === EVERYWHERE ? null : value })
                          }
                        >
                          <SelectTrigger aria-label={t('location')}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={EVERYWHERE}>{t('allLocations')}</SelectItem>
                            {locations.map((location) => (
                              <SelectItem key={location.id} value={location.id}>
                                {location.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label={t('validFrom')} htmlFor={`rule-${row.key}-valid-from`}>
                        <Input
                          id={`rule-${row.key}-valid-from`}
                          type="date"
                          value={row.validFrom}
                          disabled={!canEdit}
                          onChange={(e) => update(index, { validFrom: e.target.value })}
                        />
                      </Field>
                      <Field
                        label={t('validTo')}
                        htmlFor={`rule-${row.key}-valid-to`}
                        error={problem === 'dates' ? t('problems.dates') : serverError('validTo')}
                      >
                        <Input
                          id={`rule-${row.key}-valid-to`}
                          type="date"
                          value={row.validTo}
                          min={row.validFrom || undefined}
                          disabled={!canEdit}
                          aria-invalid={problem === 'dates'}
                          onChange={(e) => update(index, { validTo: e.target.value })}
                        />
                      </Field>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {save.fieldErrors.rules ? (
            <p className="text-sm text-destructive" role="alert">
              {save.fieldErrors.rules}
            </p>
          ) : null}
        </CardContent>
        {canEdit ? (
          <CardFooter className="justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={rows.length >= 20}
              onClick={() =>
                setRows((list) => [
                  ...list,
                  {
                    key: newRowKey(),
                    locationId: null,
                    channel: null,
                    daysOfWeek: ALL_DAYS,
                    startTime: '',
                    endTime: '',
                    validFrom: '',
                    validTo: '',
                  },
                ])
              }
            >
              <PlusIcon /> {t('add')}
            </Button>
            <div className="flex flex-wrap gap-2">
              {dirty ? (
                <Button type="button" variant="outline" onClick={() => reset()}>
                  {te('discard')}
                </Button>
              ) : null}
              <Button type="submit" disabled={save.pending || !dirty}>
                {save.pending ? tc('saving') : tc('save')}
              </Button>
            </div>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  );
}
