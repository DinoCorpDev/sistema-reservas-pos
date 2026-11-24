import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/components/auth-shell';
import { setLoginLanguage } from '../login/actions';
import { JoinForm } from './join-form';

export const metadata: Metadata = { title: 'Team' };

/**
 * A new waiter joins from their own phone (DEC-055): the QR of the backoffice opens this page with
 * the code; name, PIN and language, and the manager approves. No account, no session.
 */
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const t = await getTranslations('join');
  const { code } = await searchParams;
  return (
    <AuthShell
      title={t('title')}
      subtitle={t('subtitle')}
      footer={{ href: '/', label: t('home') }}
      onLanguageChange={setLoginLanguage}
    >
      <JoinForm initialCode={(Array.isArray(code) ? code[0] : code) ?? ''} />
    </AuthShell>
  );
}
