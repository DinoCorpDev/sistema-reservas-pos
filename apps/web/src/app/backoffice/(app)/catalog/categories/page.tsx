import { catalog, locations } from '@pos/api';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/backoffice/page-header';
import { currentActor, deps } from '@/server/actor';
import { CategoriesManager } from './categories-manager';

export const metadata: Metadata = { title: 'Kategorien' };

/** Categories of the master catalog with subcategories and translations (RF-B02, RF-B07). */
export default async function CategoriesPage() {
  const actor = await currentActor();
  const t = await getTranslations('categories');
  const [categories, products, allLocations] = await Promise.all([
    catalog.listCategories(deps(), actor),
    catalog.listProducts(deps(), actor, { includeInactive: 'true' }),
    locations.listLocations(deps(), actor),
  ]);
  const location = allLocations.find((l) => l.id === actor.locationId) ?? null;
  const productCounts: Record<string, number> = {};
  for (const product of products) {
    productCounts[product.categoryId] = (productCounts[product.categoryId] ?? 0) + 1;
  }

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <CategoriesManager
        categories={categories}
        productCounts={productCounts}
        locationLanguages={location?.languages ?? []}
        defaultLanguage={location?.defaultLanguage}
        canEdit={actor.permissions.has('catalog.manage')}
      />
    </>
  );
}
