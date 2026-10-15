import { admin, ApiError, platform } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { PageHeader } from '@/components/backoffice/page-header';
import { deps } from '@/server/actor';
import { InsideOrganization } from './inside-organization';
import { OnboardingWizard } from './onboarding-wizard';
import { OrganizationList } from './organization-list';

export const metadata: Metadata = { title: 'Support' };

/** Platform console of DINOLABS support: organizations, onboarding and entering with a grant. */
export default async function SupportConsolePage() {
  const session = await auth();
  if (session?.user?.kind !== 'support' || !session.user.id) redirect('/support/login');
  const t = await getTranslations('supportConsole');

  const organizations = await admin
    .listPlatformOrganizations(deps(), { staffId: session.user.id })
    .catch((error: unknown) => {
      if (error instanceof ApiError && error.code === 'FORBIDDEN') return null;
      throw error;
    });
  const catalog = organizations
    ? await platform.getPlanCatalog(deps(), { staffId: session.user.id })
    : { plans: [], addons: [], prices: [] };
  const currentId = session.user.organizationId;
  const current = currentId ? organizations?.find((org) => org.id === currentId) : undefined;

  return (
    <>
      <PageHeader
        title={t('organizations')}
        description={t('description')}
        actions={organizations ? <OnboardingWizard /> : null}
      />
      <div className="grid gap-6">
        {currentId ? <InsideOrganization name={current?.name ?? null} /> : null}
        {organizations ? (
          <OrganizationList
            organizations={organizations}
            currentId={currentId}
            catalog={{
              plans: catalog.plans.filter((plan) => plan.isActive),
              addons: catalog.addons.filter((addon) => addon.isActive),
            }}
          />
        ) : (
          <Alert variant="destructive">{t('staffError')}</Alert>
        )}
      </div>
    </>
  );
}
