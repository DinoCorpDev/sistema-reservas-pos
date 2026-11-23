'use client';

import { Alert } from '@pos/ui/alert';
import { Button } from '@pos/ui/button';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { EyeIcon, EyeOffIcon, KeyRoundIcon, LockIcon, LogInIcon, MailIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import type { LoginState } from '@/app/login/actions';

export function LoginForm({
  action,
}: {
  action: (state: LoginState, formData: FormData) => Promise<LoginState>;
}) {
  const t = useTranslations('auth');
  const [state, formAction, pending] = useActionState(action, { error: null, email: '' });
  const [showPassword, setShowPassword] = useState(false);
  const askTotp = state.error === 'totp_required' || state.error === 'totp_invalid';

  return (
    <form action={formAction} className="grid gap-5">
      {state.error ? <Alert variant="destructive">{t(state.error as 'invalid')}</Alert> : null}
      <Field label={t('email')} htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state.email}
          icon={<MailIcon />}
          placeholder={t('emailPlaceholder')}
        />
      </Field>
      <Field label={t('password')} htmlFor="password">
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            icon={<LockIcon />}
            className="pr-12"
          />
          {/* Its name avoids the word "password", so the field keeps a single label. */}
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-pressed={showPassword}
            aria-label={showPassword ? t('hideInput') : t('showInput')}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none [&_svg]:size-[18px]"
          >
            {showPassword ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
          </button>
        </div>
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
            icon={<KeyRoundIcon />}
          />
        </Field>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
        <LogInIcon aria-hidden />
        {t('submit')}
      </Button>
    </form>
  );
}
