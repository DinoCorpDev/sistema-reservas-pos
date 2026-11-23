import { inventory } from '@pos/api';
import { Button } from '@pos/ui/button';
import { PackageIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { RecipesManager } from './recipes-manager';

export const metadata: Metadata = { title: 'Rezepte' };

/** What each product, variant and modifier option uses of each raw material (DEC-051). */
export default async function RecipesPage() {
  const actor = await currentActor();
  const t = await getTranslations('recipes');
  const tInventory = await getTranslations('inventory');
  const [recipes, ingredients] = await Promise.all([
    inventory.listRecipes(deps(), actor),
    inventory.listIngredients(deps(), actor),
  ]);
  return (
    <>
      <PageHeader
        nav="recipes"
        title={t('title')}
        description={t('description')}
        actions={
          <Button asChild variant="outline">
            <Link href="/backoffice/inventory">
              <PackageIcon /> {tInventory('title')}
            </Link>
          </Button>
        }
      />
      <RecipesManager recipes={recipes} ingredients={ingredients} />
    </>
  );
}
