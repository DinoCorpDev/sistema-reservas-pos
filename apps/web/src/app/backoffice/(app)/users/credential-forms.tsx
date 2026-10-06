'use client';

import type { people } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import { Button } from '@pos/ui/button';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@pos/ui/dialog';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useServerAction } from '@/components/backoffice/use-server-action';
import * as actions from './actions';

type CredentialFormProps = { user: people.UserDto; onCancel: () => void; onSaved: () => void };

/** Sets the POS PIN (RF-A06): 4–6 digits, unique in the organization. */
export function PinForm({ user, onCancel, onSaved }: CredentialFormProps) {
  const t = useTranslations('users');
  const tc = useTranslations('common');
  const [pin, setPin] = useState('');
  const [problem, setProblem] = useState<string>();
  const save = useServerAction((value: string) => actions.setUserPin(user.id, { pin: value }), {
    successMessage: t('pinSaved'),
    onSuccess: onSaved,
  });
  const error = problem ?? save.fieldErrors.pin;

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!/^\d{4,6}$/.test(pin)) return setProblem(t('pinInvalid'));
        setProblem(undefined);
        void save.run(pin);
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('setPinTitle', { name: user.displayName })}</DialogTitle>
        <DialogDescription>{t('setPinHint')}</DialogDescription>
      </DialogHeader>
      <Field label={t('newPin')} htmlFor="pin-new" error={error}>
        <Input
          id="pin-new"
          type="password"
          inputMode="numeric"
          pattern="[0-9]{4,6}"
          minLength={4}
          maxLength={6}
          autoComplete="off"
          required
          autoFocus
          className="font-mono tracking-widest"
          value={pin}
          aria-invalid={!!error}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc('cancel')}
        </Button>
        <Button type="submit" disabled={save.pending}>
          {t('setPin')}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Sets the backoffice password (RF-A07); signing in also needs an email. */
export function PasswordForm({ user, onCancel, onSaved }: CredentialFormProps) {
  const t = useTranslations('users');
  const tc = useTranslations('common');
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [mismatch, setMismatch] = useState(false);
  const save = useServerAction(
    (password: string) => actions.setUserPassword(user.id, { password }),
    { successMessage: t('passwordSaved'), onSuccess: onSaved },
  );

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (form.password !== form.confirm) return setMismatch(true);
        setMismatch(false);
        void save.run(form.password);
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('setPasswordTitle', { name: user.displayName })}</DialogTitle>
      </DialogHeader>
      {user.email ? null : <Alert variant="warning">{t('noEmailWarning')}</Alert>}
      <Field
        label={t('newPassword')}
        htmlFor="password-new"
        hint={t('newPasswordHint')}
        error={save.fieldErrors.password}
      >
        <Input
          id="password-new"
          type="password"
          autoComplete="new-password"
          minLength={10}
          maxLength={200}
          required
          autoFocus
          value={form.password}
          aria-invalid={!!save.fieldErrors.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
      </Field>
      <Field
        label={t('confirmPassword')}
        htmlFor="password-confirm"
        error={mismatch ? t('mismatch') : undefined}
      >
        <Input
          id="password-confirm"
          type="password"
          autoComplete="new-password"
          required
          value={form.confirm}
          aria-invalid={mismatch}
          onChange={(e) => setForm({ ...form, confirm: e.target.value })}
        />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc('cancel')}
        </Button>
        <Button type="submit" disabled={save.pending}>
          {t('setPassword')}
        </Button>
      </DialogFooter>
    </form>
  );
}
