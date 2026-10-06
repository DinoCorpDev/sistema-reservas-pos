import { admin, ApiError } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { ArrowLeftIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { customerName, formatDate, UUID_PATTERN } from '@/components/backoffice/admin/format';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { CustomerDetail } from './customer-detail';

export const metadata: Metadata = { title: 'Gast' };

/** One guest: data, consents, export and anonymization (RF-E15, RF-E16, RN-23). */
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  const t = await getTranslations('customers');
  if (!actor.permissions.has('customer.manage')) {
    return (
      <>
        <PageHeader title={t('title')} />
        <Alert variant="warning">{t('noPermission')}</Alert>
      </>
    );
  }
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const customer = await admin.getCustomer(deps(), actor, id).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') notFound();
    throw error;
  });

  const title = customer.anonymizedAt ? t('anonymousName') : customerName(customer, t('noName'));
  return (
    <>
      <Button asChild variant="ghost" className="mb-2 -ml-3">
        <Link href="/backoffice/customers">
          <ArrowLeftIcon /> {t('backToList')}
        </Link>
      </Button>
      <PageHeader
        title={title}
        description={`${t('createdAt')} ${formatDate(customer.createdAt)}`}
        actions={
          customer.anonymizedAt ? <Badge variant="secondary">{t('anonymizedBadge')}</Badge> : null
        }
      />
      <CustomerDetail
        key={`${customer.updatedAt}:${customer.anonymizedAt ?? ''}`}
        customer={customer}
        canAnonymize={actor.permissions.has('customer.anonymize')}
      />
    </>
  );
}
