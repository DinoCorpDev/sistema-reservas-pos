'use client';

import type { admin } from '@pos/api';
import {
  BUSINESS_PROFILES,
  type BusinessProfile,
  CO_TAX_REGIMES,
  CONTENT_LANGUAGES,
  type CoTaxRegime,
  COUNTRIES,
  type Country,
  formatNit,
  isValidNit,
  nitSuggestion,
  UI_LANGUAGES,
} from '@pos/core';
import { Alert } from '@pos/ui/alert';
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
import { Field, Label } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { Checkbox } from '@pos/ui/switch';
import { toast } from '@pos/ui/toaster';
import { cn } from '@pos/ui/utils';
import { CopyIcon, PlusIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ComponentProps, type FormEvent, type ReactNode, useState } from 'react';
import { useServerAction } from '@/components/backoffice/use-server-action';
import * as actions from './actions';

const STEPS = ['organization', 'location', 'owner', 'review'] as const;

interface Draft {
  profile: BusinessProfile;
  country: Country;
  taxRegime: CoTaxRegime;
  organization: { name: string; legalName: string; defaultLanguage: string };
  location: {
    name: string;
    legalName: string;
    street: string;
    postalCode: string;
    city: string;
    canton: string;
    vatUid: string;
    languages: string[];
    kitchenLanguage: string;
  };
  owner: { displayName: string; email: string; uiLanguage: string };
}

const initialDraft = (): Draft => ({
  profile: 'restaurant',
  country: 'CH',
  taxRegime: 'inc',
  organization: { name: '', legalName: '', defaultLanguage: 'de' },
  location: {
    name: '',
    legalName: '',
    street: '',
    postalCode: '',
    city: '',
    canton: '',
    vatUid: '',
    languages: ['de'],
    kitchenLanguage: 'de',
  },
  owner: { displayName: '', email: '', uiLanguage: 'de' },
});

const payloadOf = (draft: Draft) => ({
  profile: draft.profile,
  country: draft.country,
  taxRegime: draft.taxRegime,
  organization: {
    name: draft.organization.name.trim(),
    legalName: draft.organization.legalName.trim(),
    defaultLanguage: draft.organization.defaultLanguage,
  },
  location: {
    name: draft.location.name.trim(),
    legalName: draft.location.legalName.trim(),
    street: draft.location.street.trim(),
    postalCode: draft.location.postalCode.trim(),
    city: draft.location.city.trim(),
    canton: draft.country === 'CH' ? draft.location.canton.trim() || null : null,
    vatUid: draft.location.vatUid.trim() || null,
    languages: draft.location.languages,
    kitchenLanguage: draft.location.kitchenLanguage,
  },
  owner: {
    displayName: draft.owner.displayName.trim(),
    email: draft.owner.email.trim(),
    uiLanguage: draft.owner.uiLanguage,
  },
});

const stepOfError = (path: string) =>
  path.startsWith('organization')
    ? 0
    : path.startsWith('location')
      ? 1
      : path.startsWith('owner')
        ? 2
        : 3;

/**
 * "Neues Restaurant" (Flujo 7.1, DEC-017): organization, first location and owner in three steps,
 * a review, then the owner's temporary password, shown once.
 */
export function OnboardingWizard() {
  const t = useTranslations('onboarding');
  const tc = useTranslations('common');
  const tl = useTranslations('languages');
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [emailTaken, setEmailTaken] = useState(false);
  const [result, setResult] = useState<{
    organizationName: string;
    data: admin.OnboardingResultDto;
  } | null>(null);

  const onboard = useServerAction(actions.onboardOrganization, {
    successMessage: false,
    onSuccess: (data) => setResult({ organizationName: draft.organization.name.trim(), data }),
  });
  const error = (path: string) => onboard.fieldErrors[path];

  const close = () => {
    setOpen(false);
    // After a successful onboarding everything is cleared, the password included.
    if (result) {
      setResult(null);
      setDraft(initialDraft());
      setStep(0);
      setEmailTaken(false);
    }
  };

  const setOrganization = (patch: Partial<Draft['organization']>) =>
    setDraft((d) => ({ ...d, organization: { ...d.organization, ...patch } }));
  const setLocation = (patch: Partial<Draft['location']>) =>
    setDraft((d) => ({ ...d, location: { ...d.location, ...patch } }));
  const setOwner = (patch: Partial<Draft['owner']>) =>
    setDraft((d) => ({ ...d, owner: { ...d.owner, ...patch } }));

  /** The default language is always a location language; kitchen and owner follow it by default. */
  const setDefaultLanguage = (language: string) =>
    setDraft((d) => {
      const previous = d.organization.defaultLanguage;
      const languages = new Set([...d.location.languages, language]);
      return {
        ...d,
        organization: { ...d.organization, defaultLanguage: language },
        location: {
          ...d.location,
          languages: CONTENT_LANGUAGES.filter((code) => languages.has(code)),
          kitchenLanguage:
            d.location.kitchenLanguage === previous ? language : d.location.kitchenLanguage,
        },
        owner: {
          ...d.owner,
          uiLanguage: d.owner.uiLanguage === previous ? language : d.owner.uiLanguage,
        },
      };
    });

  const toggleLanguage = (code: string, checked: boolean) =>
    setDraft((d) => {
      const languages = new Set(d.location.languages);
      if (checked) languages.add(code);
      else if (code !== d.organization.defaultLanguage) languages.delete(code);
      return {
        ...d,
        location: {
          ...d.location,
          languages: CONTENT_LANGUAGES.filter((c) => languages.has(c)),
        },
      };
    });

  const next = (event: FormEvent) => {
    event.preventDefault();
    if (step === 0) {
      // The first location usually carries the organization's names.
      setDraft((d) => ({
        ...d,
        location: {
          ...d.location,
          name: d.location.name || d.organization.name,
          legalName: d.location.legalName || d.organization.legalName,
        },
      }));
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setEmailTaken(false);
    const response = await onboard.run(payloadOf(draft));
    if (response.ok) return;
    if (response.error.code === 'CONFLICT') {
      setEmailTaken(true);
      setStep(2);
      return;
    }
    const first = Object.keys(response.error.fieldErrors)[0];
    if (first) setStep(stepOfError(first));
  };

  const copyPassword = async (password: string) => {
    try {
      await navigator.clipboard.writeText(password);
      toast.success(tc('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };

  const languageSelect = (
    id: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
    codes: readonly string[],
  ) => (
    <Field label={label} htmlFor={id}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {codes.map((code) => (
            <SelectItem key={code} value={code}>
              {tl(code)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );

  const text = (
    id: string,
    label: string,
    path: string,
    value: string,
    onChange: (value: string) => void,
    props: ComponentProps<typeof Input> & { hint?: ReactNode; errorText?: string } = {},
  ) => {
    const { hint, errorText, ...inputProps } = props;
    return (
      <Field label={label} htmlFor={id} hint={hint} error={errorText ?? error(path)}>
        <Input
          id={id}
          autoComplete="off"
          value={value}
          aria-invalid={!!error(path)}
          onChange={(e) => onChange(e.target.value)}
          {...inputProps}
        />
      </Field>
    );
  };

  const footer = (primary: ReactNode) => (
    <DialogFooter>
      {step > 0 ? (
        <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)}>
          {t('back')}
        </Button>
      ) : (
        <Button type="button" variant="outline" onClick={close}>
          {tc('cancel')}
        </Button>
      )}
      {primary}
    </DialogFooter>
  );

  const { organization: org, location: loc, owner } = draft;
  const swiss = draft.country === 'CH';
  // The NIT as it will be saved, or why it is refused, in the user's words (DEC-047).
  const nitHint = (value: string) =>
    isValidNit(value) ? t('nitWillBe', { nit: formatNit(value) }) : t('nitHint');
  const nitError = (value: string) => {
    const suggestion = nitSuggestion(value);
    return suggestion ? t('nitWrongDigit', { nit: suggestion }) : t('nitInvalid');
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon /> {t('start')}
      </Button>
      <Dialog open={open} onOpenChange={(value) => (value ? setOpen(true) : close())}>
        <DialogContent
          closeLabel={tc('close')}
          className="sm:max-w-2xl"
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            if (result) event.preventDefault();
          }}
        >
          {result ? (
            <div className="grid gap-4">
              <DialogHeader>
                <DialogTitle>{t('resultTitle')}</DialogTitle>
                <DialogDescription>{t('resultText')}</DialogDescription>
              </DialogHeader>
              <dl className="grid gap-3">
                <div className="grid gap-1">
                  <dt className="text-sm text-muted-foreground">{t('orgName')}</dt>
                  <dd className="font-medium">{result.organizationName}</dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-sm text-muted-foreground">{t('ownerEmail')}</dt>
                  <dd className="font-mono break-all">{result.data.ownerEmail}</dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-sm text-muted-foreground">{t('temporaryPassword')}</dt>
                  <dd className="flex flex-wrap items-center gap-2">
                    <code className="rounded-md bg-muted px-3 py-2 font-mono text-lg break-all select-all">
                      {result.data.temporaryPassword}
                    </code>
                    <Button
                      variant="outline"
                      onClick={() => void copyPassword(result.data.temporaryPassword)}
                    >
                      <CopyIcon /> {t('copyPassword')}
                    </Button>
                  </dd>
                </div>
              </dl>
              <Alert variant="warning">{t('passwordOnce')}</Alert>
              <p className="text-sm text-muted-foreground">{t('nextSteps')}</p>
              <DialogFooter>
                <Button onClick={close}>{t('done')}</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="grid gap-4">
              <DialogHeader>
                <DialogTitle>{t('title')}</DialogTitle>
                <DialogDescription>{t('description')}</DialogDescription>
              </DialogHeader>
              <ol
                className="grid grid-cols-4 gap-2"
                aria-label={t('step', { current: step + 1, total: STEPS.length })}
              >
                {STEPS.map((key, index) => (
                  <li
                    key={key}
                    aria-current={index === step ? 'step' : undefined}
                    className={cn(
                      'grid gap-1 border-t-4 pt-2 text-xs font-medium sm:text-sm',
                      index < step && 'border-primary/50 text-muted-foreground',
                      index === step && 'border-primary text-foreground',
                      index > step && 'border-muted text-muted-foreground',
                    )}
                  >
                    {t(`steps.${key}`)}
                  </li>
                ))}
              </ol>

              {step === 0 ? (
                <form className="grid gap-4" onSubmit={next}>
                  <Field
                    label={t('profile')}
                    htmlFor="ob-profile"
                    hint={t(`profileHint.${draft.profile}`)}
                  >
                    <Select
                      value={draft.profile}
                      onValueChange={(profile) =>
                        setDraft((d) => ({ ...d, profile: profile as BusinessProfile }))
                      }
                    >
                      <SelectTrigger id="ob-profile">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BUSINESS_PROFILES.map((profile) => (
                          <SelectItem key={profile} value={profile}>
                            {t(`profiles.${profile}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t('country')} htmlFor="ob-country">
                      <Select
                        value={draft.country}
                        onValueChange={(value) => {
                          const country = value as Country;
                          setDraft((d) => ({ ...d, country }));
                          // A Colombian restaurant usually works in Spanish (DEC-046).
                          if (country === 'CO' && org.defaultLanguage === 'de') {
                            setDefaultLanguage('es');
                          }
                        }}
                      >
                        <SelectTrigger id="ob-country">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {COUNTRIES.map((country) => (
                            <SelectItem key={country} value={country}>
                              {t(`countries.${country}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    {draft.country === 'CO' ? (
                      <Field
                        label={t('taxRegime')}
                        htmlFor="ob-tax-regime"
                        hint={t(`taxRegimeHint.${draft.taxRegime}`)}
                      >
                        <Select
                          value={draft.taxRegime}
                          onValueChange={(value) =>
                            setDraft((d) => ({ ...d, taxRegime: value as CoTaxRegime }))
                          }
                        >
                          <SelectTrigger id="ob-tax-regime">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CO_TAX_REGIMES.map((regime) => (
                              <SelectItem key={regime} value={regime}>
                                {t(`taxRegimes.${regime}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    ) : null}
                  </div>
                  {text(
                    'ob-org-name',
                    t('orgName'),
                    'organization.name',
                    org.name,
                    (name) => setOrganization({ name }),
                    {
                      required: true,
                      autoFocus: true,
                      maxLength: 200,
                    },
                  )}
                  {text(
                    'ob-org-legal',
                    t('orgLegalName'),
                    'organization.legalName',
                    org.legalName,
                    (legalName) => setOrganization({ legalName }),
                    { required: true, maxLength: 200 },
                  )}
                  {languageSelect(
                    'ob-org-language',
                    t('defaultLanguage'),
                    org.defaultLanguage,
                    setDefaultLanguage,
                    CONTENT_LANGUAGES,
                  )}
                  {footer(<Button type="submit">{t('next')}</Button>)}
                </form>
              ) : null}

              {step === 1 ? (
                <form className="grid gap-4" onSubmit={next}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {text(
                      'ob-loc-name',
                      t('locationName'),
                      'location.name',
                      loc.name,
                      (name) => setLocation({ name }),
                      {
                        required: true,
                        autoFocus: true,
                        maxLength: 200,
                      },
                    )}
                    {text(
                      'ob-loc-legal',
                      t('locationLegalName'),
                      'location.legalName',
                      loc.legalName,
                      (legalName) => setLocation({ legalName }),
                      { required: true, maxLength: 200 },
                    )}
                  </div>
                  {text(
                    'ob-loc-street',
                    t('street'),
                    'location.street',
                    loc.street,
                    (street) => setLocation({ street }),
                    {
                      required: true,
                      maxLength: 200,
                    },
                  )}
                  <div
                    className={cn(
                      'grid grid-cols-[6.5rem_1fr] gap-4',
                      swiss && 'sm:grid-cols-[6.5rem_1fr_7rem]',
                    )}
                  >
                    {text(
                      'ob-loc-postal',
                      t('postalCode'),
                      'location.postalCode',
                      loc.postalCode,
                      (postalCode) => setLocation({ postalCode }),
                      swiss
                        ? { required: true, inputMode: 'numeric', pattern: '\\d{4}', maxLength: 4 }
                        : { inputMode: 'numeric', pattern: '\\d{6}', maxLength: 6 },
                    )}
                    {text(
                      'ob-loc-city',
                      t('city'),
                      'location.city',
                      loc.city,
                      (city) => setLocation({ city }),
                      {
                        required: true,
                        maxLength: 100,
                      },
                    )}
                    {swiss
                      ? text(
                          'ob-loc-canton',
                          t('canton'),
                          'location.canton',
                          loc.canton,
                          (canton) => setLocation({ canton }),
                          {
                            maxLength: 2,
                            pattern: '[A-Za-z]{2}',
                            className: 'uppercase',
                            hint: t('cantonHint'),
                          },
                        )
                      : null}
                  </div>
                  {text(
                    'ob-loc-uid',
                    swiss ? t('vatUid') : t('nit'),
                    'location.vatUid',
                    loc.vatUid,
                    (vatUid) => setLocation({ vatUid }),
                    {
                      placeholder: swiss ? 'CHE-123.456.789' : '900.123.456-7',
                      maxLength: 32,
                      hint: swiss ? t('vatUidHint') : nitHint(loc.vatUid),
                      errorText:
                        !swiss && error('location.vatUid') ? nitError(loc.vatUid) : undefined,
                    },
                  )}
                  <fieldset className="grid gap-3">
                    <legend className="mb-2 text-sm font-medium">{t('languages')}</legend>
                    <div className="flex flex-wrap gap-6">
                      {CONTENT_LANGUAGES.map((code) => (
                        <div key={code} className="flex items-center gap-3">
                          <Checkbox
                            id={`ob-lang-${code}`}
                            checked={loc.languages.includes(code)}
                            disabled={code === org.defaultLanguage}
                            onCheckedChange={(checked) => toggleLanguage(code, checked === true)}
                          />
                          <Label htmlFor={`ob-lang-${code}`}>{tl(code)}</Label>
                        </div>
                      ))}
                    </div>
                    <p
                      className={cn(
                        'text-sm',
                        error('location.languages') ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {error('location.languages')
                        ? t('languagesMissingDefault')
                        : t('languagesHint')}
                    </p>
                  </fieldset>
                  {languageSelect(
                    'ob-loc-kitchen',
                    t('kitchenLanguage'),
                    loc.kitchenLanguage,
                    (kitchenLanguage) => setLocation({ kitchenLanguage }),
                    CONTENT_LANGUAGES,
                  )}
                  {footer(<Button type="submit">{t('next')}</Button>)}
                </form>
              ) : null}

              {step === 2 ? (
                <form className="grid gap-4" onSubmit={next}>
                  {text(
                    'ob-owner-name',
                    t('ownerName'),
                    'owner.displayName',
                    owner.displayName,
                    (displayName) => setOwner({ displayName }),
                    { required: true, autoFocus: true, maxLength: 100 },
                  )}
                  <Field
                    label={t('ownerEmail')}
                    htmlFor="ob-owner-email"
                    error={emailTaken ? t('emailTaken') : error('owner.email')}
                  >
                    <Input
                      id="ob-owner-email"
                      type="email"
                      autoComplete="off"
                      required
                      maxLength={254}
                      value={owner.email}
                      aria-invalid={emailTaken || !!error('owner.email')}
                      onChange={(e) => {
                        setEmailTaken(false);
                        setOwner({ email: e.target.value });
                      }}
                    />
                  </Field>
                  {languageSelect(
                    'ob-owner-language',
                    t('ownerLanguage'),
                    owner.uiLanguage,
                    (uiLanguage) => setOwner({ uiLanguage }),
                    UI_LANGUAGES,
                  )}
                  {footer(<Button type="submit">{t('next')}</Button>)}
                </form>
              ) : null}

              {step === 3 ? (
                <form className="grid gap-4" onSubmit={submit}>
                  <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                    <Summary label={t('profile')}>{t(`profiles.${draft.profile}`)}</Summary>
                    <Summary label={t('country')}>
                      {t(`countries.${draft.country}`)}
                      {swiss ? '' : ` · ${t(`taxRegimes.${draft.taxRegime}`)}`}
                    </Summary>
                    <Summary label={t('orgName')}>{org.name}</Summary>
                    <Summary label={t('orgLegalName')}>{org.legalName}</Summary>
                    <Summary label={t('defaultLanguage')}>{tl(org.defaultLanguage)}</Summary>
                    <Summary label={t('locationName')}>{loc.name}</Summary>
                    <Summary label={t('street')}>
                      {loc.street}, {loc.postalCode} {loc.city}
                      {loc.canton ? ` ${loc.canton.toUpperCase()}` : ''}
                    </Summary>
                    <Summary label={swiss ? t('vatUid') : t('nit')}>{loc.vatUid || '—'}</Summary>
                    <Summary label={t('languages')}>
                      {loc.languages.map((code) => tl(code)).join(', ')}
                    </Summary>
                    <Summary label={t('kitchenLanguage')}>{tl(loc.kitchenLanguage)}</Summary>
                    <Summary label={t('ownerName')}>{owner.displayName}</Summary>
                    <Summary label={t('ownerEmail')}>{owner.email}</Summary>
                    <Summary label={t('ownerLanguage')}>{tl(owner.uiLanguage)}</Summary>
                  </dl>
                  {footer(
                    <Button type="submit" disabled={onboard.pending}>
                      {onboard.pending ? t('creating') : t('submit')}
                    </Button>,
                  )}
                </form>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Summary({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">{children}</dd>
    </div>
  );
}
