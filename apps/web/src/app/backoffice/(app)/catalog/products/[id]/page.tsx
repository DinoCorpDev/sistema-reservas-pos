import { admin, ApiError, catalog, locations, people } from '@pos/api';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { currentActor, deps } from '@/server/actor';
import { EDITOR_TABS } from './editor-shared';
import { ProductEditor } from './product-editor';

export const metadata: Metadata = { title: 'Produkt bearbeiten' };

async function loadProduct(...args: Parameters<typeof catalog.getProduct>) {
  try {
    return await catalog.getProduct(...args);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
}

/** Product sheet (RF-B01…RF-B11, RF-B15, RN-17, RN-18): one sheet for POS, QR menu and web. */
export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = await currentActor();
  const [product, categories, tax, modifierGroups, allLocations, stations] = await Promise.all([
    loadProduct(deps(), actor, id),
    catalog.listCategories(deps(), actor),
    admin.getTaxOverview(deps(), actor),
    catalog.listModifierGroups(deps(), actor),
    locations.listLocations(deps(), actor),
    actor.locationId ? people.listKitchenStations(deps(), actor) : Promise.resolve(null),
  ]);
  const { tab } = await searchParams;
  const initialTab = EDITOR_TABS.find((value) => value === tab) ?? 'basics';
  const location = allLocations.find((l) => l.id === actor.locationId) ?? null;

  return (
    <ProductEditor
      key={product.id}
      product={product}
      initialTab={initialTab}
      categories={categories}
      taxCategories={tax.categories}
      modifierGroups={modifierGroups}
      locations={allLocations.map((l) => ({ id: l.id, name: l.name }))}
      location={
        location
          ? {
              id: location.id,
              name: location.name,
              defaultLanguage: location.defaultLanguage,
              languages: location.languages,
            }
          : null
      }
      stations={stations}
      permissions={{
        manage: actor.permissions.has('catalog.manage'),
        priceChange: actor.permissions.has('catalog.price_change'),
        soldOut: actor.permissions.has('catalog.sold_out'),
      }}
    />
  );
}
