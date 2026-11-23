import { admin } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { CustomerList } from './customer-list';

export const metadata: Metadata = { title: 'Gäste' };

const LIMIT = 50;

/** Guests with consent (RF-E14…RF-E16): quick search by name, phone or email. */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor();
  const t = await getTranslations('customers');
  if (!actor.permissions.has('customer.manage')) {
    return (
      <>
        <PageHeader nav="customers" title={t('title')} />
        <Alert variant="warning">{t('noPermission')}</Alert>
      </>
    );
  }
  const { q } = await searchParams;
  const search = typeof q === 'string' ? q.trim().slice(0, 100) : '';
  const customers = await admin.listCustomers(deps(), actor, {
    search: search || undefined,
    limit: LIMIT,
  });
  return (
    <>
      <PageHeader nav="customers" title={t('title')} description={t('description')} />
      <CustomerList key={search} customers={customers} search={search} limit={LIMIT} />
    </>
  );
}
