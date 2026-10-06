import { people } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { ApiKeysManager } from './api-keys-manager';

export const metadata: Metadata = { title: 'API-Schlüssel' };

/** The organization's API keys for the website and other apps (RF-F14). */
export default async function ApiKeysPage() {
  const actor = await currentActor();
  const t = await getTranslations('apiKeys');
  // Listing keys already needs `user.manage` on the server; without it, say so.
  if (!actor.permissions.has('user.manage')) {
    const te = await getTranslations('errors');
    return (
      <>
        <PageHeader title={t('title')} />
        <Alert variant="warning">{te('FORBIDDEN')}</Alert>
      </>
    );
  }
  const keys = await people.listApiKeys(deps(), actor);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <ApiKeysManager keys={keys} />
    </>
  );
}
