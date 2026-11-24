import { locations } from '@pos/api';
import { Button } from '@pos/ui/button';
import { ArrowLeftIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { FloorEditor } from './floor-editor';

export const metadata: Metadata = { title: 'Tischplan' };

/**
 * The plan of one area (DEC-056): tables dragged on the grid the POS draws, or proposed by the AI
 * from a photo of the room and adjusted before saving.
 */
export default async function FloorPlanPage({ params }: { params: Promise<{ areaId: string }> }) {
  const actor = await currentActor();
  const t = await getTranslations('floor.plan');
  const { areaId } = await params;
  const [areas, tables] = await Promise.all([
    locations.listAreas(deps(), actor),
    locations.listTables(deps(), actor),
  ]);
  const area = areas.find((candidate) => candidate.id === areaId);
  if (!area) notFound();
  return (
    <>
      <Button asChild variant="ghost" className="mb-2 -ml-3 text-muted-foreground">
        <Link href="/backoffice/floor">
          <ArrowLeftIcon /> {t('back')}
        </Link>
      </Button>
      <PageHeader
        nav="floor"
        title={t('title', { area: area.name })}
        description={t('description')}
      />
      <FloorEditor
        areaId={area.id}
        tables={tables
          .filter((table) => table.areaId === area.id && table.isActive)
          .map((table) => ({
            id: table.id,
            label: table.label,
            capacity: table.capacity,
            shape: table.shape === 'round' ? 'round' : 'rect',
            posX: table.posX,
            posY: table.posY,
            width: table.width,
            height: table.height,
          }))}
        otherLabels={tables.filter((table) => table.areaId !== area.id).map((t) => t.label)}
        canEdit={actor.permissions.has('location.manage')}
        canReadPhotos={locations.canReadFloorPhotos()}
      />
    </>
  );
}
