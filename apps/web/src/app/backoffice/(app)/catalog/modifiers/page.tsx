import { catalog } from '@pos/api';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { ModifierGroupsManager } from './modifier-groups-manager';

export const metadata: Metadata = { title: 'Zusatzoptionen' };

/** Modifier groups: required or optional, with min and max selection and surcharges (RF-B02). */
export default async function ModifiersPage() {
  const actor = await currentActor();
  const t = await getTranslations('modifiers');
  const groups = await catalog.listModifierGroups(deps(), actor);

  return (
    <>
      <PageHeader nav="modifiers" title={t('title')} description={t('description')} />
      <ModifierGroupsManager groups={groups} canEdit={actor.permissions.has('catalog.manage')} />
    </>
  );
}
