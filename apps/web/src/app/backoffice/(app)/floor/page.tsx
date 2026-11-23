import { locations } from '@pos/api';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { FloorManager } from './floor-manager';

export const metadata: Metadata = { title: 'Bereiche & Tische' };

export default async function FloorPage() {
  const actor = await currentActor();
  const t = await getTranslations('floor');
  const [areas, tables] = await Promise.all([
    locations.listAreas(deps(), actor),
    locations.listTables(deps(), actor),
  ]);
  return (
    <>
      <PageHeader nav="floor" title={t('title')} description={t('seasonal')} />
      <FloorManager
        areas={areas}
        tables={tables}
        canEdit={actor.permissions.has('location.manage')}
      />
    </>
  );
}
