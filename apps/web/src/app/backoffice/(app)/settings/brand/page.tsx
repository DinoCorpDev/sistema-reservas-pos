import { appearance, locations } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { BrandForm } from './brand-form';

export const metadata: Metadata = { title: 'Marke' };

/** The restaurant's colours, fonts and logo on its screens (DEC-058). */
export default async function BrandPage() {
  const actor = await currentActor();
  const t = await getTranslations('brand');
  if (!actor.permissions.has('location.manage')) {
    return (
      <>
        <PageHeader nav="brand" title={t('title')} />
        <Alert variant="warning">{t('noPermission')}</Alert>
      </>
    );
  }
  const [brand, all] = await Promise.all([
    appearance.getAppearance(deps(), actor),
    locations.listLocations(deps(), actor),
  ]);
  const name = all.find((location) => location.id === actor.locationId)?.name ?? '';
  return (
    <>
      <PageHeader nav="brand" title={t('title')} description={t('description')} />
      <BrandForm appearance={brand} name={name} />
    </>
  );
}
