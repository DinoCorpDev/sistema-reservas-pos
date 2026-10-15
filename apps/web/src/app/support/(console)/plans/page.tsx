import { platform } from '@pos/api';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { PageHeader } from '@/components/backoffice/page-header';
import { deps } from '@/server/actor';
import { CatalogEditor } from './catalog-editor';

export const metadata: Metadata = { title: 'Plans' };

/** The plans and add-ons DINOLABS sells, with their monthly prices per country (DEC-045). */
export default async function PlansPage() {
  const session = await auth();
  if (session?.user?.kind !== 'support' || !session.user.id) redirect('/support/login');
  const t = await getTranslations('supportConsole.catalog');
  const catalog = await platform.getPlanCatalog(deps(), { staffId: session.user.id });
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <CatalogEditor catalog={catalog} />
    </>
  );
}
