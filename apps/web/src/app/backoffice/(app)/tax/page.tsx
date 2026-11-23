import { admin } from '@pos/api';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { isIsoDate, todayInZurich } from '@/components/backoffice/admin/format';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { TaxManager } from './tax-manager';

export const metadata: Metadata = { title: 'MWST' };

/** MWST categories, rates and rules with their validity (RF-B12, RF-B13, RN-02, RN-03). */
export default async function TaxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await currentActor();
  const t = await getTranslations('tax');
  const { date } = await searchParams;
  const overview = await admin.getTaxOverview(deps(), actor, {
    date: isIsoDate(date) ? date : undefined,
  });
  return (
    <>
      <PageHeader nav="tax" title={t('title')} description={t('description')} />
      <TaxManager
        overview={overview}
        today={todayInZurich()}
        canEdit={actor.permissions.has('tax.manage')}
      />
    </>
  );
}
