'use client';

import { CONSENT_PURPOSES, CONSENT_SOURCES } from '@pos/core';
import { Input, Textarea } from '@pos/ui/input';
import { Field, Label } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { Checkbox } from '@pos/ui/switch';
import { useTranslations } from 'next-intl';

export interface ConsentFormValues {
  given: boolean;
  purpose: string;
  source: string;
  textVersion: string;
  textSnapshot: string;
}

/** Default consent texts (DE) per purpose; the exact accepted text is stored (RN-23). */
export function useConsentDefaults() {
  const t = useTranslations('customers');
  const textOf = (purpose: string) =>
    purpose === 'marketing' ? t('consentMarketingText') : t('consentDefaultText');
  return {
    textOf,
    initial: (purpose = 'data_processing'): ConsentFormValues => ({
      given: false,
      purpose,
      source: 'backoffice',
      textVersion: t('consentDefaultVersion'),
      textSnapshot: textOf(purpose),
    }),
  };
}

export const consentPayload = (values: ConsentFormValues) => ({
  purpose: values.purpose,
  source: values.source,
  textVersion: values.textVersion.trim(),
  textSnapshot: values.textSnapshot.trim(),
});

/**
 * Consent block (RN-23, revDSG): the guest's explicit yes, the purpose, the channel and the exact
 * text with its version. `errorPrefix` is `consent.` inside the create form.
 */
export function ConsentFields({
  idPrefix,
  values,
  onChange,
  errors,
  errorPrefix = '',
  choosePurpose = false,
}: {
  idPrefix: string;
  values: ConsentFormValues;
  onChange: (values: ConsentFormValues) => void;
  errors: Record<string, string>;
  errorPrefix?: string;
  choosePurpose?: boolean;
}) {
  const t = useTranslations('customers');
  const { textOf } = useConsentDefaults();
  const id = (key: string) => `${idPrefix}-${key}`;
  const error = (key: string) => errors[`${errorPrefix}${key}`];

  return (
    <fieldset className="grid gap-4 rounded-lg border p-4">
      <legend className="px-1 text-sm font-medium">{t('consentLegend')}</legend>
      {choosePurpose ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('purpose')} error={error('purpose')}>
            <Select
              value={values.purpose}
              onValueChange={(purpose) =>
                onChange({
                  ...values,
                  purpose,
                  // Swap the default text along with the purpose, never a text typed by hand.
                  textSnapshot:
                    values.textSnapshot === textOf(values.purpose)
                      ? textOf(purpose)
                      : values.textSnapshot,
                })
              }
            >
              <SelectTrigger aria-label={t('purpose')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONSENT_PURPOSES.map((purpose) => (
                  <SelectItem key={purpose} value={purpose}>
                    {t(`purposes.${purpose}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('source')} error={error('source')}>
            <Select
              value={values.source}
              onValueChange={(source) => onChange({ ...values, source })}
            >
              <SelectTrigger aria-label={t('source')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONSENT_SOURCES.map((source) => (
                  <SelectItem key={source} value={source}>
                    {t(`sources.${source}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      ) : null}
      <Field
        label={t('consentText')}
        htmlFor={id('text')}
        hint={t('consentTextHint')}
        error={error('textSnapshot')}
      >
        <Textarea
          id={id('text')}
          required
          maxLength={5000}
          value={values.textSnapshot}
          aria-invalid={!!error('textSnapshot')}
          onChange={(e) => onChange({ ...values, textSnapshot: e.target.value })}
        />
      </Field>
      <Field
        label={t('consentVersion')}
        htmlFor={id('version')}
        error={error('textVersion')}
        className="sm:max-w-48"
      >
        <Input
          id={id('version')}
          required
          maxLength={32}
          value={values.textVersion}
          aria-invalid={!!error('textVersion')}
          onChange={(e) => onChange({ ...values, textVersion: e.target.value })}
        />
      </Field>
      <div className="flex items-start gap-3">
        <Checkbox
          id={id('given')}
          className="mt-0.5"
          checked={values.given}
          onCheckedChange={(checked) => onChange({ ...values, given: checked === true })}
        />
        <div className="grid gap-1">
          <Label htmlFor={id('given')}>{t('consentGiven')}</Label>
          {!values.given ? (
            <p className="text-sm text-muted-foreground">{t('consentRequired')}</p>
          ) : null}
        </div>
      </div>
    </fieldset>
  );
}
