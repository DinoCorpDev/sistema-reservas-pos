'use client';

import { Button } from '@pos/ui/button';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { changePassword } from '@/app/backoffice/account-actions';
import { useServerAction } from './use-server-action';

export function PasswordForm({ onDone }: { onDone?: () => void }) {
  const t = useTranslations('account');
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [mismatch, setMismatch] = useState(false);
  const { run, pending, fieldErrors } = useServerAction(changePassword, {
    successMessage: t('passwordChanged'),
    onSuccess: () => {
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      onDone?.();
    },
  });

  return (
    <form
      className="grid max-w-md gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (form.newPassword !== form.confirm) return setMismatch(true);
        setMismatch(false);
        void run({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      }}
    >
      <Field
        label={t('currentPassword')}
        htmlFor="pw-current"
        error={fieldErrors.currentPassword ? t('wrongPassword') : undefined}
      >
        <Input
          id="pw-current"
          type="password"
          autoComplete="current-password"
          required
          value={form.currentPassword}
          onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
        />
      </Field>
      <Field label={t('newPassword')} htmlFor="pw-new" hint={t('newPasswordHint')} error={fieldErrors.newPassword}>
        <Input
          id="pw-new"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          value={form.newPassword}
          onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
        />
      </Field>
      <Field label={t('confirmPassword')} htmlFor="pw-confirm" error={mismatch ? t('mismatch') : undefined}>
        <Input
          id="pw-confirm"
          type="password"
          autoComplete="new-password"
          required
          value={form.confirm}
          onChange={(e) => setForm({ ...form, confirm: e.target.value })}
        />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {t('passwordTitle')}
        </Button>
      </div>
    </form>
  );
}
