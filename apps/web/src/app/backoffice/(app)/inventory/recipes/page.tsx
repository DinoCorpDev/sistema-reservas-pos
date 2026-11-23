import { inventory } from '@pos/api';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { InventoryTabs } from '@/components/backoffice/inventory/inventory-tabs';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { RecipesManager } from './recipes-manager';

export const metadata: Metadata = { title: 'Rezepte' };

/**
 * Every recipe at a glance, a tab of the inventory (DEC-051, DEC-053): the dishes (also edited in
 * the menu, "Recipe" tab) and the modifier options, which are only edited here.
 */
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
      <PageHeader nav="inventory" title={tInventory('title')} description={t('description')} />
      <InventoryTabs current="recipes" />
      <RecipesManager recipes={recipes} ingredients={ingredients} />
    </>
  );
}
