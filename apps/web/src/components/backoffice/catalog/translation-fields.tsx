'use client';

import { CONTENT_LANGUAGES } from '@pos/core';
import { Badge } from '@pos/ui/badge';
import { Input, Textarea } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { useTranslations } from 'next-intl';
import { LABEL_LANGUAGES, type LabelDraft, type TextDraft } from './catalog-data';

/**
 * Name (and description) in DE, FR, IT and EN (RF-B07). Languages the location uses are marked;
 * an empty language falls back to the location language on every channel.
 */
export function TextTranslationFields({
  value,
  onChange,
  idPrefix,
  disabled,
  withDescription = true,
  locationLanguages = [],
  defaultLanguage,
}: {
  value: TextDraft;
  onChange: (value: TextDraft) => void;
  idPrefix: string;
  disabled?: boolean;
  withDescription?: boolean;
  locationLanguages?: readonly string[];
  defaultLanguage?: string;
}) {
  const t = useTranslations('catalog');
  const tl = useTranslations('languages');
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {CONTENT_LANGUAGES.map((language) => {
        const texts = value[language];
        const missingName = !texts.name.trim() && texts.description.trim() !== '';
        return (
          <fieldset key={language} className="grid gap-3 rounded-lg border p-4">
            <legend className="flex flex-wrap items-center gap-2 px-1 text-sm font-semibold">
              {tl(language)}
              {language === defaultLanguage ? (
                <Badge variant="default">{t('locationLanguage')}</Badge>
              ) : locationLanguages.includes(language) ? (
                <Badge variant="secondary">{t('usedAtLocation')}</Badge>
              ) : null}
            </legend>
            <Field
              label={t('name')}
              htmlFor={`${idPrefix}-${language}-name`}
              error={missingName ? t('translationNameMissing') : undefined}
            >
              <Input
                id={`${idPrefix}-${language}-name`}
                lang={language}
                maxLength={150}
                value={texts.name}
                disabled={disabled}
                aria-invalid={missingName}
                onChange={(e) =>
                  onChange({ ...value, [language]: { ...texts, name: e.target.value } })
                }
              />
            </Field>
            {withDescription ? (
              <Field label={t('description')} htmlFor={`${idPrefix}-${language}-description`}>
                <Textarea
                  id={`${idPrefix}-${language}-description`}
                  lang={language}
                  maxLength={2000}
                  value={texts.description}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange({ ...value, [language]: { ...texts, description: e.target.value } })
                  }
                />
              </Field>
            ) : null}
          </fieldset>
        );
      })}
    </div>
  );
}

/**
 * Short names in FR, IT and EN for nested rows (variants, modifiers, groups); the main name is
 * the catalog text. A German label set through the API is shown too, so it can be seen and cleared.
 */
export function LabelFields({
  value,
  onChange,
  idPrefix,
  disabled,
}: {
  value: LabelDraft;
  onChange: (value: LabelDraft) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  const tl = useTranslations('languages');
  const languages = value.de ? (['de', ...LABEL_LANGUAGES] as const) : LABEL_LANGUAGES;
  return (
    <div className="grid gap-4">
      {languages.map((language) => (
        <Field key={language} label={tl(language)} htmlFor={`${idPrefix}-${language}`}>
          <Input
            id={`${idPrefix}-${language}`}
            lang={language}
            maxLength={150}
            value={value[language]}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, [language]: e.target.value })}
          />
        </Field>
      ))}
    </div>
  );
}
