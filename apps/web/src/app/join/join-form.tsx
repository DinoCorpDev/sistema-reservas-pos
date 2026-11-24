'use client';

import { UI_LANGUAGES } from '@pos/core';
import { Alert } from '@pos/ui/alert';
import { Button } from '@pos/ui/button';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { CircleCheckBigIcon, UserPlusIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { joinTeam, type JoinResult } from './actions';

const LANGUAGE_NAMES: Record<(typeof UI_LANGUAGES)[number], string> = {
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
  en: 'English',
  es: 'Español',
};

const digits = (value: string) => value.replace(/\D/g, '').slice(0, 6);

/** Name, PIN twice and language, on the waiter's phone (DEC-055). */
export function JoinForm({ initialCode }: { initialCode: string }) {
  const t = useTranslations('join');
  const locale = useLocale();
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const [language, setLanguage] = useState(
    (UI_LANGUAGES as readonly string[]).includes(locale) ? locale : 'de',
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<JoinResult, { ok: true }> | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <div className="grid gap-4 text-center" role="status" data-testid="join-done">
        <CircleCheckBigIcon className="mx-auto size-12 text-success" aria-hidden />
        <h2 className="text-xl font-semibold">{t('done.title', { name: done.name })}</h2>
        <p className="text-muted-foreground">{t('done.text', { location: done.location })}</p>
      </div>
    );
  }

  const pinError =
    pin.length > 0 && pin.length < 4
      ? t('errors.pinLength')
      : repeat.length > 0 && repeat !== pin
        ? t('errors.pinMismatch')
        : null;

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setProblem(null);
        if (pin.length < 4 || pin !== repeat) {
          setProblem(pin !== repeat ? t('errors.pinMismatch') : t('errors.pinLength'));
          return;
        }
        startTransition(async () => {
          const result = await joinTeam({ code, displayName: name, pin, uiLanguage: language });
          if (result.ok) {
            setDone(result);
            return;
          }
          if (result.reason === 'pin_taken') {
            setPin('');
            setRepeat('');
            setProblem(t('errors.pinTaken'));
          } else {
            setProblem(t(`errors.${result.reason}`));
          }
        });
      }}
    >
      {initialCode ? null : (
        <Field label={t('code')} htmlFor="join-code" hint={t('codeHint')}>
          <Input
            id="join-code"
            required
            autoCapitalize="characters"
            autoComplete="off"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="ABCD-1234"
          />
        </Field>
      )}
      <Field label={t('name')} htmlFor="join-name" hint={t('nameHint')}>
        <Input
          id="join-name"
          required
          minLength={2}
          maxLength={100}
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('pin')} htmlFor="join-pin">
          <Input
            id="join-pin"
            required
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            value={pin}
            onChange={(event) => setPin(digits(event.target.value))}
          />
        </Field>
        <Field label={t('pinRepeat')} htmlFor="join-pin-repeat">
          <Input
            id="join-pin-repeat"
            required
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => setRepeat(digits(event.target.value))}
          />
        </Field>
      </div>
      <p className={pinError ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
        {pinError ?? t('pinHint')}
      </p>
      <Field label={t('language')} htmlFor="join-language">
        <Select value={language} onValueChange={setLanguage}>
          <SelectTrigger id="join-language">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UI_LANGUAGES.map((value) => (
              <SelectItem key={value} value={value}>
                {LANGUAGE_NAMES[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {problem ? (
        <Alert variant="destructive" role="alert">
          {problem}
        </Alert>
      ) : null}
      <Button type="submit" size="lg" disabled={pending}>
        <UserPlusIcon /> {pending ? t('sending') : t('submit')}
      </Button>
    </form>
  );
}
