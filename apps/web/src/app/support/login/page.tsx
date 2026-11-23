import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { AuthShell } from '@/components/auth-shell';
import { LoginForm } from '@/components/login-form';
import { loginStaff, setLoginLanguage } from '../../login/actions';

export const metadata: Metadata = { title: 'Support' };

export default async function SupportLoginPage() {
  const session = await auth();
  if (session?.user?.kind === 'support') redirect('/support');
  const t = await getTranslations();
  return (
    <AuthShell
      title={t('auth.supportTitle')}
      subtitle={t('auth.supportSubtitle')}
      footer={{ href: '/login', label: t('auth.backofficeLink') }}
      onLanguageChange={setLoginLanguage}
    >
      <LoginForm action={loginStaff} />
    </AuthShell>
  );
}
