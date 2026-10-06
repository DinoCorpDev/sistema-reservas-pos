'use client';

import type { admin } from '@pos/api';
import { CONTENT_LANGUAGES } from '@pos/core';
import { Input, Textarea } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { useTranslations } from 'next-intl';

const NO_LANGUAGE = 'none';

/** Text state of the guest form; converted to the use case input by `customerPayload`. */
export interface CustomerFormValues {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  language: string;
  notes: string;
  declaredAllergies: string;
  tags: string;
}

export const emptyCustomerForm = (): CustomerFormValues => ({
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  language: NO_LANGUAGE,
  notes: '',
  declaredAllergies: '',
  tags: '',
});

export const customerFormOf = (customer: admin.CustomerDto): CustomerFormValues => ({
  firstName: customer.firstName ?? '',
  lastName: customer.lastName ?? '',
  phone: customer.phone ?? '',
  email: customer.email ?? '',
  language: customer.language ?? NO_LANGUAGE,
  notes: customer.notes ?? '',
  declaredAllergies: customer.declaredAllergies ?? '',
  tags: customer.tags.join(', '),
});

const orNull = (value: string) => value.trim() || null;

export function customerPayload(values: CustomerFormValues) {
  return {
    firstName: orNull(values.firstName),
    lastName: orNull(values.lastName),
    phone: orNull(values.phone),
    email: orNull(values.email),
    language: values.language === NO_LANGUAGE ? null : values.language,
    notes: orNull(values.notes),
    declaredAllergies: orNull(values.declaredAllergies),
    tags: [
      ...new Set(
        values.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ],
  };
}

export const hasContact = (values: CustomerFormValues) =>
  values.phone.trim() !== '' || values.email.trim() !== '';

/** Name, contact, language, notes, declared allergies and tags of a guest (RF-E14, RF-E15). */
export function CustomerFields({
  idPrefix,
  values,
  onChange,
  errors,
  contactMissing = false,
  disabled = false,
}: {
  idPrefix: string;
  values: CustomerFormValues;
  onChange: (values: CustomerFormValues) => void;
  errors: Record<string, string>;
  contactMissing?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations('customers');
  const tl = useTranslations('languages');
  const id = (key: string) => `${idPrefix}-${key}`;
  const set = (key: keyof CustomerFormValues) => (event: { target: { value: string } }) =>
    onChange({ ...values, [key]: event.target.value });
  const tagsError = Object.entries(errors).find(([key]) => key.startsWith('tags'))?.[1];

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t('firstName')} htmlFor={id('firstName')} error={errors.firstName}>
        <Input
          id={id('firstName')}
          autoComplete="off"
          maxLength={100}
          disabled={disabled}
          value={values.firstName}
          onChange={set('firstName')}
        />
      </Field>
      <Field label={t('lastName')} htmlFor={id('lastName')} error={errors.lastName}>
        <Input
          id={id('lastName')}
          autoComplete="off"
          maxLength={100}
          disabled={disabled}
          value={values.lastName}
          onChange={set('lastName')}
        />
      </Field>
      <Field
        label={t('phone')}
        htmlFor={id('phone')}
        hint={t('phoneHint')}
        error={errors.phone ?? (contactMissing ? t('contactRequired') : undefined)}
      >
        <Input
          id={id('phone')}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          maxLength={32}
          disabled={disabled}
          value={values.phone}
          aria-invalid={!!errors.phone || contactMissing}
          onChange={set('phone')}
        />
      </Field>
      <Field label={t('email')} htmlFor={id('email')} hint={t('contactHint')} error={errors.email}>
        <Input
          id={id('email')}
          type="email"
          autoComplete="off"
          maxLength={254}
          disabled={disabled}
          value={values.email}
          aria-invalid={!!errors.email || contactMissing}
          onChange={set('email')}
        />
      </Field>
      <Field label={t('language')} error={errors.language}>
        <Select
          value={values.language}
          disabled={disabled}
          onValueChange={(language) => onChange({ ...values, language })}
        >
          <SelectTrigger aria-label={t('language')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_LANGUAGE}>{t('languageNone')}</SelectItem>
            {CONTENT_LANGUAGES.map((code) => (
              <SelectItem key={code} value={code}>
                {tl(code)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={t('tags')} htmlFor={id('tags')} hint={t('tagsHint')} error={tagsError}>
        <Input
          id={id('tags')}
          autoComplete="off"
          disabled={disabled}
          value={values.tags}
          onChange={set('tags')}
        />
      </Field>
      <Field
        label={t('allergies')}
        htmlFor={id('allergies')}
        hint={t('allergiesHint')}
        error={errors.declaredAllergies}
        className="sm:col-span-2"
      >
        <Textarea
          id={id('allergies')}
          maxLength={1000}
          className="min-h-16"
          disabled={disabled}
          value={values.declaredAllergies}
          onChange={set('declaredAllergies')}
        />
      </Field>
      <Field
        label={t('notes')}
        htmlFor={id('notes')}
        error={errors.notes}
        className="sm:col-span-2"
      >
        <Textarea
          id={id('notes')}
          maxLength={2000}
          className="min-h-16"
          disabled={disabled}
          value={values.notes}
          onChange={set('notes')}
        />
      </Field>
    </div>
  );
}
