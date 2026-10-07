'use client';

import type { LocationDto } from '@pos/api';
import { Button } from '@pos/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@pos/ui/card';
import { Input, Textarea } from '@pos/ui/input';
import { Field, Label } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { Checkbox } from '@pos/ui/switch';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useServerAction } from '@/components/backoffice/use-server-action';
import { saveLocation } from './actions';

const CONTENT_LANGUAGES = ['de', 'fr', 'it', 'en'] as const;

export function LocationForm({ location, canEdit }: { location: LocationDto; canEdit: boolean }) {
  const t = useTranslations('location');
  const tc = useTranslations('common');
  const tl = useTranslations('languages');
  const [form, setForm] = useState({
    name: location.name,
    legalName: location.legalName,
    street: location.street,
    postalCode: location.postalCode,
    city: location.city,
    canton: location.canton ?? '',
    vatUid: location.vatUid?.replace(/\s+(MWST|TVA|IVA)$/i, '') ?? '',
    phone: location.phone ?? '',
    email: location.email ?? '',
    defaultLanguage: location.defaultLanguage,
    kitchenLanguage: location.kitchenLanguage,
    languages: location.languages,
    receiptHeader: location.receiptHeader ?? '',
    receiptFooter: location.receiptFooter ?? '',
  });
  const { run, pending, fieldErrors } = useServerAction(saveLocation);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: event.target.value }));
  const toggleLanguage = (code: string, checked: boolean) =>
    setForm((f) => ({
      ...f,
      languages: checked
        ? [...new Set([...f.languages, code])]
        : f.languages.filter((l) => l !== code),
    }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void run(location.id, {
      ...form,
      canton: form.canton.trim() || null,
      vatUid: form.vatUid.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      receiptHeader: form.receiptHeader.trim() || null,
      receiptFooter: form.receiptFooter.trim() || null,
    });
  };

  const text = (
    key: keyof typeof form,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <Field label={label} htmlFor={`loc-${key}`} error={fieldErrors[key]}>
      <Input
        id={`loc-${key}`}
        value={form[key] as string}
        onChange={set(key)}
        disabled={!canEdit}
        aria-invalid={!!fieldErrors[key]}
        {...props}
      />
    </Field>
  );

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-4">
        <CardHeader>
          <CardTitle>{t('details')}</CardTitle>
          <CardDescription>{t('detailsHint')}</CardDescription>
        </CardHeader>
        <CardContent className="sm:grid-cols-2">
          {text('name', t('name'), { required: true })}
          {text('legalName', t('legalName'), { required: true })}
          {text('street', t('street'), { required: true })}
          <div className="grid grid-cols-[7rem_1fr_5rem] gap-3">
            {text('postalCode', t('postalCode'), {
              required: true,
              inputMode: 'numeric',
              maxLength: 4,
            })}
            {text('city', t('city'), { required: true })}
            {text('canton', t('canton'), { maxLength: 2 })}
          </div>
          <Field
            label={t('vatUid')}
            htmlFor="loc-vatUid"
            hint={t('vatUidHint')}
            error={fieldErrors.vatUid}
          >
            <Input
              id="loc-vatUid"
              value={form.vatUid}
              onChange={set('vatUid')}
              placeholder="CHE-123.456.789"
              disabled={!canEdit}
              aria-invalid={!!fieldErrors.vatUid}
            />
          </Field>
          {text('phone', t('phone'), { type: 'tel' })}
          {text('email', t('email'), { type: 'email' })}
          <Field label={t('defaultLanguage')}>
            <Select
              value={form.defaultLanguage}
              onValueChange={(value) => setForm((f) => ({ ...f, defaultLanguage: value }))}
              disabled={!canEdit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTENT_LANGUAGES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {tl(code)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('kitchenLanguage')} hint={t('kitchenLanguageHint')}>
            <Select
              value={form.kitchenLanguage}
              onValueChange={(value) => setForm((f) => ({ ...f, kitchenLanguage: value }))}
              disabled={!canEdit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTENT_LANGUAGES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {tl(code)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <fieldset className="grid gap-3 sm:col-span-2">
            <legend className="mb-2 text-sm font-medium">{t('languages')}</legend>
            <div className="flex flex-wrap gap-6">
              {CONTENT_LANGUAGES.map((code) => (
                <div key={code} className="flex items-center gap-3">
                  <Checkbox
                    id={`lang-${code}`}
                    checked={form.languages.includes(code)}
                    onCheckedChange={(checked) => toggleLanguage(code, checked === true)}
                    disabled={!canEdit}
                  />
                  <Label htmlFor={`lang-${code}`}>{tl(code)}</Label>
                </div>
              ))}
            </div>
            {fieldErrors.languages ? (
              <p className="text-sm text-destructive">{fieldErrors.languages}</p>
            ) : null}
          </fieldset>
          <Field label={t('receiptHeader')} htmlFor="loc-receiptHeader">
            <Textarea
              id="loc-receiptHeader"
              value={form.receiptHeader}
              onChange={set('receiptHeader')}
              disabled={!canEdit}
            />
          </Field>
          <Field label={t('receiptFooter')} htmlFor="loc-receiptFooter">
            <Textarea
              id="loc-receiptFooter"
              value={form.receiptFooter}
              onChange={set('receiptFooter')}
              disabled={!canEdit}
            />
          </Field>
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
