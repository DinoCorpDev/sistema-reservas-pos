import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';

export const metadata: Metadata = { title: 'Übersicht' };

// Placeholder until the setup checklist (RF-A11) lands from the admin module.
export default async function OverviewPage() {
  const t = await getTranslations('checklist');
  return <PageHeader title={t('title')} description={t('subtitle')} />;
}
