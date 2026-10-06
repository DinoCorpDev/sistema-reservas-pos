import { locations, people } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@pos/ui/tabs';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { RolesManager } from './roles-manager';
import { UsersManager } from './users-manager';

export const metadata: Metadata = { title: 'Mitarbeitende' };

/** Users with roles, locations, PIN and password, and the permissions of each role (RF-A04…A08). */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const actor = await currentActor();
  const t = await getTranslations('users');
  // Listing users and roles already needs `user.manage` on the server; without it, say so.
  if (!actor.permissions.has('user.manage')) {
    const te = await getTranslations('errors');
    return (
      <>
        <PageHeader title={t('title')} />
        <Alert variant="warning">{te('FORBIDDEN')}</Alert>
      </>
    );
  }
  const [users, roles, allLocations] = await Promise.all([
    people.listUsers(deps(), actor),
    people.listRoles(deps(), actor),
    locations.listLocations(deps(), actor),
  ]);
  const { tab } = await searchParams;
  const canEdit = actor.permissions.has('user.manage');

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <Tabs defaultValue={tab === 'roles' ? 'roles' : 'users'}>
        <TabsList>
          <TabsTrigger value="users">
            {t('tabUsers')}{' '}
            <span className="text-xs text-muted-foreground tabular-nums">{users.length}</span>
          </TabsTrigger>
          <TabsTrigger value="roles">{t('tabRoles')}</TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <UsersManager
            users={users}
            roles={roles}
            locations={allLocations.map((location) => ({ id: location.id, name: location.name }))}
            currentUserId={actor.userId ?? null}
            canEdit={canEdit}
          />
        </TabsContent>
        <TabsContent value="roles">
          <RolesManager roles={roles} canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </>
  );
}
