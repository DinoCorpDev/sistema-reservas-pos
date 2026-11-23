import { inventory } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { InventoryTabs } from '@/components/backoffice/inventory/inventory-tabs';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { InventoryManager } from './inventory-manager';

export const metadata: Metadata = { title: 'Inventar' };

/** Which dishes and options use each raw material, in menu order and without repeats. */
function usedIn(recipes: inventory.RecipesDto): Record<string, string[]> {
  const names = new Map<string, Set<string>>();
  const add = (ingredientId: string, name: string) => {
    const set = names.get(ingredientId) ?? new Set<string>();
    set.add(name);
    names.set(ingredientId, set);
  };
  for (const product of recipes.products) {
    for (const line of product.lines) add(line.ingredientId, product.name);
    for (const variant of product.variants) {
      for (const line of variant.lines) add(line.ingredientId, product.name);
    }
  }
  for (const modifier of recipes.modifiers) {
    for (const line of modifier.lines) add(line.ingredientId, modifier.name);
  }
  return Object.fromEntries([...names].map(([id, set]) => [id, [...set]]));
}

/** Raw materials with their stock, the ones running low first, and where each is used (DEC-051). */
export default async function InventoryPage() {
  const actor = await currentActor();
  const t = await getTranslations('inventory');
  const [ingredients, recipes] = await Promise.all([
    inventory.listIngredients(deps(), actor),
    inventory.listRecipes(deps(), actor),
  ]);
  return (
    <>
      <PageHeader nav="inventory" title={t('title')} description={t('description')} />
      <InventoryTabs current="ingredients" />
      {actor.locationId ? null : (
        <Alert variant="info" className="mb-4">
          {t('noLocation')}
        </Alert>
      )}
      <InventoryManager
        ingredients={ingredients}
        usedIn={usedIn(recipes)}
        hasLocation={!!actor.locationId}
      />
    </>
  );
}
