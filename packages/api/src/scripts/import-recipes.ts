import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createIngredientSchema, replaceRecipeSchema } from '@pos/core';
import { createDb, inOrg, notDeleted, schema as s } from '@pos/db';
import { eq, isNotNull } from 'drizzle-orm';
import type { Actor } from '../actor';
import { loadUserPermissions } from '../auth/permissions';
import * as inventory from '../services/inventory';

/**
 * Loads a recipe book (raw materials and what each dish uses) into an organization through the
 * same use cases as the backoffice: validated and audited (DEC-051). It leaves the stock at zero:
 * the restaurant enters what it has with "Registrar compra".
 *
 *   pnpm --filter @pos/api recipes:import <recipes.json> [--org=<slug>]
 *
 * Raw materials are matched by name and products by SKU, so running it again updates the
 * recipes instead of duplicating; a raw material that already exists keeps its unit and level.
 * A variant's recipe replaces the product's; a product with only variant recipes gets the first
 * one as its own, for a variant added later.
 */

interface RecipeFile {
  source: string;
  ingredients: { key: string; name: string; unit: 'g' | 'ml' | 'unit'; threshold: number | null }[];
  recipes: {
    sku: string;
    lines: Record<string, number>;
    variants?: Record<string, Record<string, number>>;
  }[];
}

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith('--'));
const orgSlug = args.find((arg) => arg.startsWith('--org='))?.slice(6) ?? 'demo-gastro';
if (!file) {
  console.error('Usage: recipes:import <recipes.json> [--org=<slug>]');
  process.exit(1);
}

const rootEnv = resolve(import.meta.dirname, '../../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const book = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8')) as RecipeFile;
const { db, pool } = createDb(process.env.DATABASE_URL!, { connectionLimit: 2 });
const deps = { db };

try {
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

  // ── Raw materials, by name ──
  const known = await inventory.listIngredients(deps, actor);
  const byName = new Map(known.map((ingredient) => [ingredient.name.toLowerCase(), ingredient.id]));
  const idOf = new Map<string, string>();
  let createdIngredients = 0;
  for (const entry of book.ingredients) {
    let id = byName.get(entry.name.toLowerCase());
    if (!id) {
      const input = createIngredientSchema.parse({
        name: entry.name,
        unit: entry.unit,
        lowStockThreshold: entry.threshold,
        isActive: true,
      });
      id = (await inventory.createIngredient(deps, actor, input)).id;
      createdIngredients += 1;
    }
    idOf.set(entry.key, id);
  }
  const linesOf = (lines: Record<string, number>, sku: string) =>
    replaceRecipeSchema.parse({
      lines: Object.entries(lines).map(([key, quantity]) => {
        const ingredientId = idOf.get(key);
        if (!ingredientId) throw new Error(`${sku}: unknown raw material ${key}`);
        return { ingredientId, quantity };
      }),
    });

  // ── Products by SKU, variants by name ──
  const products = await db
    .select({ id: s.products.id, sku: s.products.sku })
    .from(s.products)
    .where(inOrg(s.products, tenant, isNotNull(s.products.sku), notDeleted(s.products)));
  const productBySku = new Map(products.map((product) => [product.sku!, product.id]));
  const variants = await db
    .select({
      id: s.productVariants.id,
      productId: s.productVariants.productId,
      name: s.productVariants.name,
    })
    .from(s.productVariants)
    .where(inOrg(s.productVariants, tenant, notDeleted(s.productVariants)));

  let recipes = 0;
  const missing: string[] = [];
  for (const recipe of book.recipes) {
    const productId = productBySku.get(recipe.sku);
    if (!productId) {
      missing.push(recipe.sku);
      continue;
    }
    const ofVariants = Object.entries(recipe.variants ?? {});
    const own = Object.keys(recipe.lines).length > 0 ? recipe.lines : (ofVariants[0]?.[1] ?? {});
    await inventory.replaceRecipe(deps, actor, 'product', productId, linesOf(own, recipe.sku));
    recipes += 1;
    for (const [name, lines] of ofVariants) {
      const variant = variants.find((v) => v.productId === productId && v.name === name);
      if (!variant) {
        missing.push(`${recipe.sku} / ${name}`);
        continue;
      }
      await inventory.replaceRecipe(deps, actor, 'variant', variant.id, linesOf(lines, recipe.sku));
      recipes += 1;
    }
  }
  console.log(
    `${book.source}: ${createdIngredients} raw materials created ` +
      `(${book.ingredients.length - createdIngredients} already there), ${recipes} recipes saved.`,
  );
  if (missing.length > 0) console.warn(`Not found, skipped: ${missing.join(', ')}`);
} finally {
  await pool.end();
}
