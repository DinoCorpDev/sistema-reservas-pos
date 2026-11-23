import { locations, people } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@pos/ui/tabs';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { PhonesManager } from './phones-manager';
import { PrintersManager } from './printers-manager';
import { StationsManager } from './stations-manager';
import { TerminalsManager } from './terminals-manager';

export const metadata: Metadata = { title: 'Geräte & Stationen' };

const TABS = ['terminals', 'stations', 'printers'] as const;

/**
 * Terminals, waiters' own phones (DEC-036), kitchen stations and printers of the current location
 * (RF-A03, RF-A06, RF-F17).
 */
export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const actor = await currentActor();
  const t = await getTranslations('devices');
  if (!actor.locationId) {
    return (
      <>
        <PageHeader nav="devices" title={t('title')} />
        <Alert variant="warning">{t('noLocation')}</Alert>
      </>
    );
  }
  const [terminals, stations, printers, location] = await Promise.all([
    people.listTerminals(deps(), actor),
    people.listKitchenStations(deps(), actor),
    people.listPrinters(deps(), actor),
    locations.getLocation(deps(), actor, actor.locationId),
  ]);
  const { tab } = await searchParams;
  const initialTab = TABS.find((value) => value === tab) ?? 'terminals';
  const canEdit = actor.permissions.has('location.manage');

  return (
    <>
      <PageHeader nav="devices" title={t('title')} description={t('description')} />
      {canEdit ? null : (
        <Alert variant="info" className="mb-4">
          {t('readOnly')}
        </Alert>
      )}
      <Tabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="terminals">
            {t('tabTerminals')} <Count value={terminals.length} />
          </TabsTrigger>
          <TabsTrigger value="stations">
            {t('tabStations')} <Count value={stations.length} />
          </TabsTrigger>
          <TabsTrigger value="printers">
            {t('tabPrinters')} <Count value={printers.length} />
          </TabsTrigger>
        </TabsList>
        <TabsContent value="terminals">
          <TerminalsManager
            terminals={terminals.filter((terminal) => terminal.type !== 'phone')}
            stations={stations}
            printers={printers}
            canEdit={canEdit}
          />
          <PhonesManager
            phones={terminals.filter((terminal) => terminal.type === 'phone')}
            canEdit={canEdit}
          />
        </TabsContent>
        <TabsContent value="stations">
          <StationsManager
            stations={stations}
            printers={printers}
            terminals={terminals}
            defaults={{
              alertAfterMinutes: location.settings.kitchen.alertAfterMinutes,
              language: location.kitchenLanguage,
            }}
            canEdit={canEdit}
          />
        </TabsContent>
        <TabsContent value="printers">
          <PrintersManager printers={printers} canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function Count({ value }: { value: number }) {
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
      {value}
    </span>
  );
}
