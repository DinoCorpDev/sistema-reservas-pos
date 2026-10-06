import { type Actor, admin, catalog } from '@pos/api';
import { listProductsQuerySchema } from '@pos/core';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { NewProductDialog } from './new-product-dialog';
import { ProductsList } from './products-list';

export const metadata: Metadata = { title: 'Produkte' };

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

/** Products of the master catalog (RF-B01, RF-B15): one sheet feeds POS, QR menu and web. */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: Param; q?: Param; inactive?: Param }>;
}) {
  const actor = await currentActor();
  const t = await getTranslations('products');
  const params = await searchParams;
  const filters = {
    categoryId: first(params.category) ?? '',
    search: first(params.q) ?? '',
    includeInactive: first(params.inactive) === '1',
  };
  const query = listProductsQuerySchema.safeParse({
    categoryId: filters.categoryId || undefined,
    search: filters.search || undefined,
    includeInactive: filters.includeInactive ? 'true' : undefined,
  });

  const [products, categories, tax, atLocation] = await Promise.all([
    catalog.listProducts(deps(), actor, query.success ? query.data : {}),
    catalog.listCategories(deps(), actor),
    admin.getTaxOverview(deps(), actor),
    locationState(actor),
  ]);
  const canManage = actor.permissions.has('catalog.manage');

  return (
    <>
      <PageHeader
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
        canManage={canManage}
        canSoldOut={actor.permissions.has('catalog.sold_out')}
      />
    </>
  );
}
