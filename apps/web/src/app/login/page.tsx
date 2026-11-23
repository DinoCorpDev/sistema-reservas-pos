import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { AuthShell } from '@/components/auth-shell';
import { LoginForm } from '@/components/login-form';
import { loginUser, setLoginLanguage } from './actions';

export const metadata: Metadata = { title: 'Login' };

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.kind === 'user') redirect('/backoffice');
  const t = await getTranslations();
  return (
    <AuthShell
      title={t('auth.title')}
      subtitle={t('auth.subtitle')}
      footer={{ href: '/support/login', label: t('auth.supportLink') }}
      onLanguageChange={setLoginLanguage}
    >
      <LoginForm action={loginUser} />
    </AuthShell>
  );
}
