import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { asCurrency, parseMoney, type TaxCategoryKey } from '@pos/core';
import { createDb, inOrg, notDeleted, schema as s } from '@pos/db';
import { eq } from 'drizzle-orm';
import type { Actor } from '../actor';
import { loadUserPermissions } from '../auth/permissions';
import * as catalog from '../services/catalog';
import * as people from '../services/people';

/**
 * Loads a restaurant menu (categories, products, variants, translations, station routing) into
 * an organization through the same use cases as the backoffice: validated, audited and with the
 * catalog events. Development tool for demos; a step towards RF-B14 (import with preview).
 *
 *   pnpm --filter @pos/api menu:import <menu.json> [--org=<slug>] [--replace]
 *
 * Products are matched by SKU, so running it again updates instead of duplicating. With
 * `--replace`, every other active category and product of the organization is deactivated
 * (never deleted, RF-A12): the imported menu becomes the only one on the POS.
 */

interface MenuFile {
  source: string;
  stations: Record<string, string>;
  categories: {
    name: string;
    en: string | null;
    station: string;
    course: number;
    products: {
      sku: string;
      name: string;
      description: string | null;
      en: { name: string; description: string | null };
      /** In the location's currency (`price`), or CHF for the older files (`priceChf`). */
      price?: string;
      priceChf?: string;
      taxCategory: TaxCategoryKey;
      variants?: { name: string; en: string; price?: string; priceChf?: string }[];
    }[];
  }[];
}

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith('--'));
const orgSlug = args.find((arg) => arg.startsWith('--org='))?.slice(6) ?? 'demo-gastro';
const replace = args.includes('--replace');
if (!file) {
  console.error('Usage: menu:import <menu.json> [--org=<slug>] [--replace]');
  process.exit(1);
}

// In development the monorepo root .env is used.
const rootEnv = resolve(import.meta.dirname, '../../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const menu = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8')) as MenuFile;
const { db, pool } = createDb(process.env.DATABASE_URL!, { connectionLimit: 2 });
const deps = { db };

try {
  // ── Who imports: an administrator of the organization, at its first location ──
  const [org] = await db.select().from(s.organizations).where(eq(s.organizations.slug, orgSlug));
  if (!org) throw new Error(`Organization ${orgSlug} not found`);
  const tenant = { organizationId: org.id };
  const [location] = await db
    .select()
    .from(s.locations)
    .where(inOrg(s.locations, tenant, notDeleted(s.locations)))
    .limit(1);
  const [admin] = await db
    .select({ id: s.users.id })
    .from(s.users)
    .innerJoin(s.userRoles, eq(s.userRoles.userId, s.users.id))
    .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
    .where(inOrg(s.users, tenant, eq(s.roles.key, 'admin'), eq(s.users.isActive, true)))
    .limit(1);
  if (!location || !admin) throw new Error('The organization needs a location and an admin');
  // Prices are read in the location's currency: CHF or pesos (DEC-047).
  const priceOf = (entry: { price?: string; priceChf?: string }) =>
    parseMoney(entry.price ?? entry.priceChf ?? '', asCurrency(location.currency));
  const actor: Actor = {
    kind: 'user',
    organizationId: org.id,
    locationId: location.id,
    userId: admin.id,
    permissions: await loadUserPermissions(db, {
      organizationId: org.id,
      userId: admin.id,
      locationId: location.id,
    }),
    requestId: null,
  };

  // ── References: tax categories by key, kitchen stations by name ──
  const taxRows = await db
    .select({ id: s.taxCategories.id, key: s.taxCategories.key })
    .from(s.taxCategories)
    .where(inOrg(s.taxCategories, tenant, notDeleted(s.taxCategories)));
  const taxId = (key: string) => {
    const row = taxRows.find((tax) => tax.key === key);
    if (!row) throw new Error(`Tax category ${key} not found`);
    return row.id;
  };
  const stations = await people.listKitchenStations(deps, actor);
  const stationId = (key: string) => {
    const name = menu.stations[key] ?? key;
    const station = stations.find((entry) => entry.name === name && entry.isActive);
    if (!station) throw new Error(`Kitchen station ${name} not found`);
    return station.id;
  };

  const existingCategories = await catalog.listCategories(deps, actor);
  const existingProducts = await catalog.listProducts(deps, actor, { includeInactive: 'true' });
  const keptCategories = new Set<string>();
  const keptProducts = new Set<string>();
  let created = 0;
  let updated = 0;

  for (const [categoryIndex, entry] of menu.categories.entries()) {
    const current = existingCategories.find((category) => category.name === entry.name);
    const category = current
      ? await catalog.updateCategory(deps, actor, current.id, {
          sortOrder: categoryIndex,
          isActive: true,
        })
      : await catalog.createCategory(deps, actor, {
          name: entry.name,
          description: null,
          parentId: null,
          imageUrl: null,
          sortOrder: categoryIndex,
          isActive: true,
        });
    keptCategories.add(category.id);
    if (entry.en) {
      await catalog.replaceCategoryTranslations(deps, actor, category.id, {
        en: { name: entry.en },
      });
    }

    for (const [productIndex, item] of entry.products.entries()) {
      const fields = {
        categoryId: category.id,
        taxCategoryId: taxId(item.taxCategory),
        sku: item.sku,
        name: item.name,
        description: item.description,
        basePriceRappen: priceOf(item),
        defaultCourse: entry.course,
        sortOrder: productIndex,
        isActive: true,
      };
      const known = existingProducts.find((product) => product.sku === item.sku);
      const product = known
        ? await catalog.updateProduct(deps, actor, known.id, fields)
        : await catalog.createProduct(deps, actor, {
            ...fields,
            imageUrl: null,
            requiresOrigin: false,
            publishQr: false,
            publishWeb: false,
          });
      if (known) updated += 1;
      else created += 1;
      keptProducts.add(product.id);
      await catalog.replaceProductTranslations(deps, actor, product.id, {
        en: { name: item.en.name, description: item.en.description },
      });
      await catalog.replaceVariants(deps, actor, product.id, {
        variants: (item.variants ?? []).map((variant, index) => ({
          name: variant.name,
          priceRappen: priceOf(variant),
          isDefault: index === 0,
          sortOrder: index,
          isActive: true,
          translations: { en: variant.en },
        })),
      });
      await catalog.replaceProductStations(deps, actor, product.id, {
        stationIds: [stationId(entry.station)],
      });
    }
    console.log(`✓ ${entry.name}: ${entry.products.length}`);
  }

  let deactivated = 0;
  if (replace) {
    for (const product of existingProducts) {
      if (product.isActive && !keptProducts.has(product.id)) {
        await catalog.updateProduct(deps, actor, product.id, { isActive: false });
        deactivated += 1;
      }
    }
    for (const category of existingCategories) {
      if (category.isActive && !keptCategories.has(category.id)) {
        await catalog.updateCategory(deps, actor, category.id, { isActive: false });
      }
    }
  }
  console.log(
    `Menu from ${menu.source}: ${created} created, ${updated} updated` +
      (replace ? `, ${deactivated} other products deactivated.` : '.'),
  );
} finally {
  await pool.end();
}
