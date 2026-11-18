import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { LanguagePicker } from '@/components/language-picker';
import { LoginForm } from '@/components/login-form';
import { loginUser, setLoginLanguage } from './actions';
import { ZitasLogo } from '@/components/brand/zitas-logo';

export const metadata: Metadata = { title: 'Login' };

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.kind === 'user') redirect('/backoffice');
  const t = await getTranslations();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <p>
          <span className="sr-only">{t('app.name')}</span>
          <ZitasLogo />
        </p>
        <LanguagePicker onChange={setLoginLanguage} label={t('nav.language')} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('auth.title')}</CardTitle>
          <CardDescription>{t('auth.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm action={loginUser} />
        </CardContent>
      </Card>
      <Link
        href="/support/login"
        className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        {t('auth.supportLink')}
      </Link>
    </main>
  );
}
