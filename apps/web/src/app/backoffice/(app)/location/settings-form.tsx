'use client';

import type { LocationSettings } from '@pos/core';
import { Button } from '@pos/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@pos/ui/card';
import { Input } from '@pos/ui/input';
import { Field, Label } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { Switch } from '@pos/ui/switch';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useServerAction } from '@/components/backoffice/use-server-action';
import { saveLocationSettings } from './actions';

/** Operating rules of the location (DEC-004): approval thresholds and timings, all configurable. */
export function SettingsForm({
  locationId,
  settings,
  canEdit,
}: {
  locationId: string;
  settings: LocationSettings;
  canEdit: boolean;
}) {
  const t = useTranslations('location');
  const tc = useTranslations('common');
  const [form, setForm] = useState({
    shiftMode: settings.shiftMode,
    discountAbovePercent: settings.managerApproval.discountAboveBp / 100,
    voidSentItem: settings.managerApproval.voidSentItem,
    refundAboveChf: settings.managerApproval.refundAboveRappen / 100,
    blockMinutesBefore: settings.reservations.blockMinutesBefore,
    noShowAfterMinutes: settings.reservations.noShowAfterMinutes,
    defaultDurationMinutes: settings.reservations.defaultDurationMinutes,
    alertAfterMinutes: settings.kitchen.alertAfterMinutes,
    customerNameFromChf: settings.receipts.customerNameFromRappen / 100,
    maxPinAttempts: settings.security.maxPinAttempts,
    pinLockMinutes: settings.security.pinLockMinutes,
  });
  const { run, pending, fieldErrors } = useServerAction(saveLocationSettings);
  const num = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: Number(event.target.value) }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void run(locationId, {
      shiftMode: form.shiftMode,
      managerApproval: {
        discountAboveBp: Math.round(form.discountAbovePercent * 100),
        voidSentItem: form.voidSentItem,
        refundAboveRappen: Math.round(form.refundAboveChf * 100),
      },
      reservations: {
        blockMinutesBefore: form.blockMinutesBefore,
        noShowAfterMinutes: form.noShowAfterMinutes,
        defaultDurationMinutes: form.defaultDurationMinutes,
      },
      kitchen: { alertAfterMinutes: form.alertAfterMinutes },
      receipts: { customerNameFromRappen: Math.round(form.customerNameFromChf * 100) },
      security: { maxPinAttempts: form.maxPinAttempts, pinLockMinutes: form.pinLockMinutes },
    });
  };

  const numberField = (key: keyof typeof form, label: string, step = 1) => (
    <Field label={label} htmlFor={`set-${key}`} error={fieldErrors[key]}>
      <Input
        id={`set-${key}`}
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        value={String(form[key])}
        onChange={num(key)}
        disabled={!canEdit}
      />
    </Field>
  );

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-4">
        <CardHeader>
          <CardTitle>{t('settings')}</CardTitle>
          <CardDescription>{t('settingsHint')}</CardDescription>
        </CardHeader>
        <CardContent className="sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t('shiftMode')}>
            <Select
              value={form.shiftMode}
              onValueChange={(value) => setForm((f) => ({ ...f, shiftMode: value as typeof f.shiftMode }))}
              disabled={!canEdit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="terminal">{t('shiftMode_terminal')}</SelectItem>
                <SelectItem value="cashier">{t('shiftMode_cashier')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {numberField('discountAbovePercent', t('discountAbove'))}
          {numberField('refundAboveChf', t('refundAbove'), 0.05)}
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
            <Switch
              id="set-voidSentItem"
              checked={form.voidSentItem}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, voidSentItem: checked }))}
              disabled={!canEdit}
            />
            <Label htmlFor="set-voidSentItem">{t('voidSentItem')}</Label>
          </div>
          {numberField('blockMinutesBefore', t('blockMinutesBefore'))}
          {numberField('noShowAfterMinutes', t('noShowAfter'))}
          {numberField('defaultDurationMinutes', t('defaultDuration'))}
          {numberField('alertAfterMinutes', t('kitchenAlert'))}
          {numberField('customerNameFromChf', t('customerNameFrom'), 0.05)}
          {numberField('maxPinAttempts', t('maxPinAttempts'))}
          {numberField('pinLockMinutes', t('pinLockMinutes'))}
        </CardContent>
        {canEdit ? (
          <CardFooter>
            <Button type="submit" disabled={pending}>
              {pending ? tc('saving') : tc('save')}
            </Button>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  );
}
