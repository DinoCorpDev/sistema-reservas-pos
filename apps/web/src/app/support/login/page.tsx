import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { LanguagePicker } from '@/components/language-picker';
import { LoginForm } from '@/components/login-form';
import { loginStaff, setLoginLanguage } from '../../login/actions';
import { ZitasLogo } from '@/components/brand/zitas-logo';
import { ThemeMenu } from '@/components/theme/theme-menu';

export const metadata: Metadata = { title: 'Support' };

export default async function SupportLoginPage() {
  const session = await auth();
  if (session?.user?.kind === 'support') redirect('/support');
  const t = await getTranslations();
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-chrome p-6 text-chrome-foreground">
      {/* The brand's dot, large, behind the card (brandbook covers). */}
      <span aria-hidden className="absolute -top-24 -right-24 size-80 rounded-full bg-brand/90" />
      <span aria-hidden className="absolute bottom-16 left-12 size-6 rounded-full bg-brand" />
      <div className="relative flex w-full max-w-md flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <p>
            <span className="sr-only">{t('app.name')}</span>
            <ZitasLogo onDark />
          </p>
          <div className="text-foreground">
            <div className="flex items-center gap-2">
              <ThemeMenu />
              <LanguagePicker onChange={setLoginLanguage} label={t('nav.language')} />
            </div>
          </div>
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
          className="text-center text-sm text-chrome-foreground/70 underline-offset-4 hover:underline"
        >
          {t('auth.backofficeLink')}
        </Link>
      </div>
    </main>
  );
}
