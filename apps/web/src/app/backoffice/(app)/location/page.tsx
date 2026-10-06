import { locations } from '@pos/api';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { LocationForm } from './location-form';
import { SettingsForm } from './settings-form';

export const metadata: Metadata = { title: 'Standort' };

export default async function LocationPage() {
  const actor = await currentActor();
  const t = await getTranslations('location');
  const list = await locations.listLocations(deps(), actor);
  const location = list.find((l) => l.id === actor.locationId) ?? list[0];
  if (!location) return <PageHeader title={t('title')} />;
  const canEdit = actor.permissions.has('location.manage');

  return (
    <>
      <PageHeader title={t('title')} description={location.name} />
      <div className="grid gap-6">
        <LocationForm location={location} canEdit={canEdit} />
        <SettingsForm locationId={location.id} settings={location.settings} canEdit={canEdit} />
      </div>
    </>
  );
}
