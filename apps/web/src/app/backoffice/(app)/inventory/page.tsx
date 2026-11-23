import { inventory } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import { Button } from '@pos/ui/button';
import { BookOpenTextIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { InventoryManager } from './inventory-manager';

export const metadata: Metadata = { title: 'Inventar' };

/** Raw materials with their stock, the ones running low first (DEC-051). */
export default async function InventoryPage() {
  const actor = await currentActor();
  const t = await getTranslations('inventory');
  const ingredients = await inventory.listIngredients(deps(), actor);
  return (
    <>
      <PageHeader
        nav="inventory"
        title={t('title')}
        description={t('description')}
        actions={
          <Button asChild variant="outline">
            <Link href="/backoffice/inventory/recipes">
              <BookOpenTextIcon /> {t('recipes')}
            </Link>
          </Button>
        }
      />
      {actor.locationId ? null : (
        <Alert variant="info" className="mb-4">
          {t('noLocation')}
        </Alert>
      )}
      <InventoryManager ingredients={ingredients} hasLocation={!!actor.locationId} />
    </>
  );
}
