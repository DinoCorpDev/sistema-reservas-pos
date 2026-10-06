'use client';

import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@pos/ui/card';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { confirmTwoFactor, disableTwoFactor, startTwoFactor } from '@/app/backoffice/account-actions';
import { useServerAction } from '@/components/backoffice/use-server-action';

/** Two-factor sign-in with an authenticator app (RF-A07). */
export function TwoFactorCard({ enabled }: { enabled: boolean }) {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');

  const start = useServerAction(startTwoFactor, { successMessage: false, onSuccess: setSetup });
  const confirm = useServerAction(confirmTwoFactor, {
    successMessage: t('twoFactorEnabled'),
    onSuccess: () => {
      setSetup(null);
      router.refresh();
    },
  });
  const disable = useServerAction(disableTwoFactor, {
    successMessage: t('twoFactorDisabled'),
    onSuccess: () => router.refresh(),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>{t('twoFactorTitle')}</CardTitle>
        <Badge variant={enabled ? 'success' : 'secondary'}>{enabled ? t('twoFactorOn') : t('twoFactorOff')}</Badge>
      </CardHeader>
      <CardContent>
        {enabled ? (
          <form
            className="grid max-w-md gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void disable.run(password);
            }}
          >
            <Field label={t('currentPassword')} htmlFor="tfa-password" error={disable.fieldErrors.currentPassword}>
              <Input
                id="tfa-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <div>
              <Button type="submit" variant="destructive" disabled={disable.pending}>
                {t('twoFactorDisable')}
              </Button>
            </div>
          </form>
        ) : setup ? (
          <form
            className="grid max-w-md gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void confirm.run(code);
            }}
          >
            <p className="text-sm text-muted-foreground">{t('twoFactorScan')}</p>
            <Field label={t('twoFactorSecret')}>
              <code className="rounded-md bg-muted px-3 py-2 font-mono text-sm break-all select-all">{setup.secret}</code>
            </Field>
            <Field label={tc('confirm')} htmlFor="tfa-code" error={confirm.fieldErrors.token}>
              <Input
                id="tfa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <div>
              <Button type="submit" disabled={confirm.pending}>
                {t('twoFactorConfirm')}
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button onClick={() => void start.run()} disabled={start.pending}>
              {t('twoFactorStart')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
