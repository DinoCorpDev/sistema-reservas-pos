import { account } from '@pos/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { PasswordForm } from '@/components/backoffice/password-form';
import { LanguagePicker } from '@/components/language-picker';
import { setUiLanguage } from '../../actions';
import { currentActor, deps } from '@/server/actor';
import { TwoFactorCard } from './two-factor-card';

export const metadata: Metadata = { title: 'Konto' };

export default async function AccountPage() {
  const actor = await currentActor();
  const t = await getTranslations('account');
  if (actor.kind !== 'user') return <PageHeader nav="account" title={t('title')} />;
  const me = await account.getOwnAccount(deps(), actor);
  return (
    <>
      <PageHeader
        nav="account"
        title={t('title')}
        description={`${me.displayName} · ${me.email ?? ''}`}
      />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('language')}</CardTitle>
            <CardDescription>{t('languageHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <LanguagePicker onChange={setUiLanguage} label={t('language')} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('passwordTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <PasswordForm />
          </CardContent>
        </Card>
        <TwoFactorCard enabled={me.twoFactorEnabled} />
      </div>
    </>
  );
}
