import { type Actor, admin, catalog, inventory } from '@pos/api';
import { listProductsQuerySchema } from '@pos/core';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { recipeStates } from '@/components/backoffice/inventory/recipe-state';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { NewProductDialog } from './new-product-dialog';
import { ProductsList } from './products-list';

export const metadata: Metadata = { title: 'Speisekarte' };

type Param = string | string[] | undefined;
const first = (value: Param) => (Array.isArray(value) ? value[0] : value)?.trim() || undefined;

/**
 * State of each product at the current location, read from the table menu (RN-17): which
 * products are listed there and which are sold out ("86"). Null without a location.
 */
async function locationState(actor: Actor) {
  if (!actor.locationId) return null;
  const menu = await catalog.getMenu(deps(), actor, { channel: 'table' });
  const products = menu.categories.flatMap((category) => category.products);
  return {
    listed: products.map((product) => product.id),
    soldOut: products.filter((product) => product.reason === 'sold_out').map((p) => p.id),
  };
}

/** Where each dish stands with its recipe; null without the inventory permission (DEC-051). */
async function recipeState(actor: Actor) {
  if (!actor.permissions.has('inventory.manage')) return null;
  const [recipes, ingredients] = await Promise.all([
    inventory.listRecipes(deps(), actor),
    inventory.listIngredients(deps(), actor),
  ]);
  return recipeStates(recipes, ingredients);
}

/**
 * The menu ("Carta") of the master catalog (RF-B01, RF-B15): one sheet feeds POS, QR menu and
 * web, and each dish carries its recipe.
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: Param; q?: Param; inactive?: Param; recipe?: Param }>;
}) {
  const actor = await currentActor();
  const t = await getTranslations('products');
  const params = await searchParams;
  const filters = {
    categoryId: first(params.category) ?? '',
    search: first(params.q) ?? '',
    includeInactive: first(params.inactive) === '1',
    withoutRecipe: first(params.recipe) === 'none',
  };
  const query = listProductsQuerySchema.safeParse({
    categoryId: filters.categoryId || undefined,
    search: filters.search || undefined,
    includeInactive: filters.includeInactive ? 'true' : undefined,
  });

  const [listed, categories, tax, atLocation, recipes] = await Promise.all([
    catalog.listProducts(deps(), actor, query.success ? query.data : {}),
    catalog.listCategories(deps(), actor),
    admin.getTaxOverview(deps(), actor),
    locationState(actor),
    recipeState(actor),
  ]);
  const products =
    recipes && filters.withoutRecipe
      ? listed.filter((product) => (recipes[product.id] ?? 'without') === 'without')
      : listed;
  const canManage = actor.permissions.has('catalog.manage');

  return (
    <>
      <PageHeader
        nav="products"
        title={t('title')}
        description={t('description')}
        actions={
          canManage ? (
            <NewProductDialog categories={categories} taxCategories={tax.categories} />
          ) : null
        }
      />
      <ProductsList
        products={products}
        categories={categories}
        filters={filters}
        atLocation={atLocation}
        recipes={recipes}
        canManage={canManage}
        canSoldOut={actor.permissions.has('catalog.sold_out')}
      />
    </>
  );
}
