'use client';

import { Alert } from '@pos/ui/alert';
import { Button } from '@pos/ui/button';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import type { LoginState } from '@/app/login/actions';

export function LoginForm({
  action,
}: {
  action: (state: LoginState, formData: FormData) => Promise<LoginState>;
}) {
  const t = useTranslations('auth');
  const [state, formAction, pending] = useActionState(action, { error: null, email: '' });
  const askTotp = state.error === 'totp_required' || state.error === 'totp_invalid';

  return (
    <form action={formAction} className="grid gap-4">
      {state.error ? <Alert variant="destructive">{t(state.error as 'invalid')}</Alert> : null}
      <Field label={t('email')} htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state.email}
        />
      </Field>
      <Field label={t('password')} htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      {askTotp ? (
        <Field label={t('totp')} htmlFor="totp" hint={t('totpHint')}>
          <Input
            id="totp"
            name="totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
          />
        </Field>
      ) : null}
      <Button type="submit" size="lg" disabled={pending}>
        {t('submit')}
      </Button>
    </form>
  );
}
