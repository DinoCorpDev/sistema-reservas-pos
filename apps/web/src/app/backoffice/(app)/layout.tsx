import { locations } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { auth } from '@/auth';
import { BackofficeNav } from '@/components/backoffice/nav';
import { TopBar } from '@/components/backoffice/top-bar';
import { currentActor, deps } from '@/server/actor';

/** Backoffice shell (RF-F21): navigation by permission, location switch, language and account. */
export default async function BackofficeAppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (session?.user?.mustChangePassword) redirect('/backoffice/password');
  const actor = await currentActor();
  const t = await getTranslations();
  const allLocations = await locations.listLocations(deps(), actor);
  const permissions = [...actor.permissions];

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r bg-card p-4 lg:flex print:hidden">
        <Link href="/backoffice" className="px-3 text-lg font-semibold">
          {t('app.name')}
        </Link>
        <BackofficeNav permissions={permissions} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          locations={allLocations.map((l) => ({ id: l.id, name: l.name }))}
          locationId={actor.locationId ?? null}
          userName={session?.user?.name ?? ''}
          permissions={permissions}
          isSupport={actor.kind === 'support'}
        />
        {actor.kind === 'support' ? (
          <Alert variant="warning" className="rounded-none border-x-0 border-t-0">
            {t('nav.support_banner')}
          </Alert>
        ) : null}
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
