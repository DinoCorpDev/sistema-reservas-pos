import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { LanguagePicker } from '@/components/language-picker';
import { LoginForm } from '@/components/login-form';
import { loginStaff, setLoginLanguage } from '../../login/actions';

export const metadata: Metadata = { title: 'Support' };

export default async function SupportLoginPage() {
  const session = await auth();
  if (session?.user?.kind === 'support') redirect('/support');
  const t = await getTranslations();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <p className="font-semibold">{t('app.name')}</p>
        <LanguagePicker onChange={setLoginLanguage} label={t('nav.language')} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('auth.supportTitle')}</CardTitle>
          <CardDescription>{t('auth.supportSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm action={loginStaff} />
        </CardContent>
      </Card>
      <Link
        href="/login"
        className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        {t('auth.backofficeLink')}
      </Link>
    </main>
  );
}
