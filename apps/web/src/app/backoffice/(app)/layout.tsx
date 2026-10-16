import { locations, platform } from '@pos/api';
import { asCurrency } from '@pos/core';
import { Alert } from '@pos/ui/alert';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { auth } from '@/auth';
import { BackofficeNav } from '@/components/backoffice/nav';
import { MoneyProvider } from '@/components/money';
import { TopBar } from '@/components/backoffice/top-bar';
import { currentActor, deps } from '@/server/actor';

/** Backoffice shell (RF-F21): navigation by permission, location switch, language and account. */
export default async function BackofficeAppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (session?.user?.mustChangePassword) redirect('/backoffice/password');
  const actor = await currentActor();
  const t = await getTranslations();
  const allLocations = await locations.listLocations(deps(), actor);
  // Amounts on screen in the current location's currency (DEC-047).
  const currency = asCurrency(
    allLocations.find((location) => location.id === actor.locationId)?.currency,
  );
  const permissions = [...actor.permissions];
  // A late payment or a suspended subscription, for whoever manages the location (DEC-045).
  const subscription = actor.permissions.has('location.manage')
    ? await platform.subscriptionStatusOf(deps().db, actor.organizationId)
    : 'active';

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r bg-card p-4 lg:flex print:hidden">
        <Link href="/backoffice" className="px-3 text-lg font-semibold">
          {t('app.name')}
        </Link>
        <BackofficeNav permissions={permissions} />
        <p className="mt-auto px-3 text-xs text-muted-foreground">
          v{process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev'}
        </p>
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
        {subscription !== 'active' ? (
          <Alert
            variant={subscription === 'suspended' ? 'destructive' : 'warning'}
            className="rounded-none border-x-0 border-t-0 print:hidden"
          >
            <Link href="/backoffice/plan" className="underline-offset-4 hover:underline">
              {t(`myPlan.statusNotice.${subscription}`)}
            </Link>
          </Alert>
        ) : null}
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">
          <MoneyProvider currency={currency}>{children}</MoneyProvider>
        </main>
      </div>
    </div>
  );
}
