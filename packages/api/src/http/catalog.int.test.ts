import { newId, nextLocalTime } from '@pos/core';
import { schema as s } from '@pos/db';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateApiKey } from '../auth/api-keys';
import { createOtherOrganization, createTestApi, type DemoContext, demoSession, loadDemo } from '../testing';

const api = createTestApi();
let demo: DemoContext;
let admin: Record<string, string>;
let manager: Record<string, string>;
let waiter: Record<string, string>;
let kitchen: Record<string, string>;
/** A user whose role has catalog.manage but not catalog.price_change. */
let editor: Record<string, string>;
let editorId: string;
let other: Awaited<ReturnType<typeof createOtherOrganization>>;
let otherAdmin: Record<string, string>;

const products = new Map<string, string>();
const categories = new Map<string, string>();
const stations = new Map<string, string>();
const modifierGroups = new Map<string, string>();
const taxCategories = new Map<string, string>();
const id = (map: Map<string, string>, key: string) => {
  const value = map.get(key);
  if (!value) throw new Error(`Seed record ${key} missing`);
  return value;
};

interface Product {
  id: string;
  name: string;
  sku: string | null;
  isActive: boolean;
  basePriceRappen: number;
  allergensComplete: boolean;
  publishQr: boolean;
  variants: { id: string; name: string; priceRappen: number; isDefault: boolean; translations: Record<string, string> }[];
  modifierGroupIds: string[];
  allergens: { allergen: string; presence: string }[];
  origins: { kind: string; species: string | null; country: string }[];
  translations: Record<string, { name?: string; description?: string }>;
  availability: { channel: string | null; daysOfWeek: number; startTime: string | null; endTime: string | null }[];
  channelPrices: { channel: string; variantId: string | null; priceRappen: number }[];
  locationSettings: {
    isActive: boolean;
    priceRappen: number | null;
    soldOutUntil: string | null;
    isSoldOut: boolean;
  } | null;
  stationIds: string[];
  publication: { publishable: boolean; issues: string[] };
}

interface MenuProduct {
  id: string;
  name: string;
  description: string | null;
  priceRappen: number;
  variants: { name: string; priceRappen: number; isDefault: boolean }[];
  modifierGroups: { name: string; modifiers: { name: string; priceDeltaRappen: number }[] }[];
  orderable: boolean;
  reason: string | null;
}
interface Menu {
  categories: { id: string; name: string; products: MenuProduct[] }[];
}

async function call<T = Record<string, unknown>>(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const response = await api.request(method, path, { headers, body });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}

const getProduct = async (productId: string, headers = admin) =>
  (await call<Product>('GET', `/catalog/products/${productId}`, headers)).body;

async function getMenu(query: string, headers = admin): Promise<Menu> {
  const response = await call<Menu>('GET', `/catalog/menu?${query}`, headers);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body;
}
const menuProduct = (menu: Menu, productId: string) =>
  menu.categories.flatMap((c) => c.products).find((p) => p.id === productId);

async function createProduct(body: Record<string, unknown>) {
  const response = await call<Product>('POST', '/catalog/products', admin, {
    categoryId: id(categories, 'Hauptgerichte'),
    taxCategoryId: id(taxCategories, 'food'),
    basePriceRappen: 2000,
    ...body,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body;
}

const auditsOf = (entityId: string, action: string) =>
  api.db
    .select()
    .from(s.auditEvents)
    .where(and(eq(s.auditEvents.entityId, entityId), eq(s.auditEvents.action, action)))
    .orderBy(desc(s.auditEvents.recordedAt));

const eventsOf = (aggregateId: string, type: string) =>
  api.db
    .select()
    .from(s.outboxEvents)
    .where(and(eq(s.outboxEvents.aggregateId, aggregateId), eq(s.outboxEvents.type, type)));

beforeAll(async () => {
  demo = await loadDemo(api.db);
  admin = api.as(demoSession(demo, 'admin'));
  manager = api.as(demoSession(demo, 'manager'));
  waiter = api.as(demoSession(demo, 'waiter'));
  kitchen = api.as(demoSession(demo, 'kitchen'));
  other = await createOtherOrganization(api.db, 'Other Catalog Gastro');
  otherAdmin = api.as(other.session);

  const org = eq(s.products.organizationId, demo.organizationId);
  for (const row of await api.db.select().from(s.products).where(org)) products.set(row.name, row.id);
  for (const row of await api.db
    .select()
    .from(s.categories)
    .where(eq(s.categories.organizationId, demo.organizationId))) {
    categories.set(row.name, row.id);
  }
  for (const row of await api.db
    .select()
    .from(s.kitchenStations)
    .where(eq(s.kitchenStations.locationId, demo.locationId))) {
    stations.set(row.name, row.id);
  }
  for (const row of await api.db
    .select()
    .from(s.modifierGroups)
    .where(eq(s.modifierGroups.organizationId, demo.organizationId))) {
    modifierGroups.set(row.name, row.id);
  }
  for (const row of await api.db
    .select()
    .from(s.taxCategories)
    .where(eq(s.taxCategories.organizationId, demo.organizationId))) {
    taxCategories.set(row.key, row.id);
  }

  // Custom role: may edit the catalog but not change prices.
  const roleId = newId();
  editorId = newId();
  const organizationId = demo.organizationId;
  await api.db.insert(s.roles).values({ id: roleId, organizationId, key: 'catalog_editor', name: 'Catalog editor' });
  await api.db.insert(s.rolePermissions).values({ organizationId, roleId, permission: 'catalog.manage' });
  await api.db.insert(s.users).values({ id: editorId, organizationId, displayName: 'Catalog Editor' });
  await api.db.insert(s.userLocations).values({ organizationId, userId: editorId, locationId: demo.locationId });
  await api.db.insert(s.userRoles).values({ organizationId, userId: editorId, roleId });
  editor = api.as({ kind: 'user', userId: editorId, organizationId, locationId: demo.locationId });
});

afterAll(async () => {
  await api.close();
});

describe('catalog API documentation', () => {
  it('publishes the catalog routes in the OpenAPI document', async () => {
    const response = await api.request('GET', '/openapi.json');
    expect(response.status).toBe(200);
    const doc = (await response.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/catalog/menu',
        '/api/v1/catalog/products/{id}',
        '/api/v1/catalog/products/{id}/variants',
        '/api/v1/catalog/products/{id}/sold-out',
        '/api/v1/catalog/modifier-groups/{id}/modifiers',
      ]),
    );
  });
});

describe('categories (RF-B02, RF-B07)', () => {
  it('lists the seeded categories with their translations', async () => {
    const response = await call<{ name: string; translations: Product['translations'] }[]>(
      'GET',
      '/catalog/categories',
      waiter,
    );
    expect(response.status).toBe(200);
    expect(response.body.find((c) => c.name === 'Hauptgerichte')?.translations).toMatchObject({
      fr: { name: 'Plats principaux' },
      it: { name: 'Piatti principali' },
    });
  });

  it('runs the lifecycle of a category', async () => {
    const created = await call<{ id: string; isActive: boolean }>('POST', '/catalog/categories', admin, {
      name: 'Saisonales',
      sortOrder: 9,
    });
    expect(created.status).toBe(201);
    const categoryId = created.body.id;

    const translated = await call('PUT', `/catalog/categories/${categoryId}/translations`, admin, {
      fr: { name: 'De saison' },
      en: { name: 'Seasonal', description: 'From the market' },
    });
    expect(translated.body).toMatchObject({
      translations: { fr: { name: 'De saison' }, en: { name: 'Seasonal', description: 'From the market' } },
    });
    const retranslated = await call('PUT', `/catalog/categories/${categoryId}/translations`, admin, {
      fr: { name: 'Saison' },
    });
    expect(retranslated.body.translations).toEqual({ fr: { name: 'Saison' } });

    const deactivated = await call('PATCH', `/catalog/categories/${categoryId}`, admin, { isActive: false });
    expect(deactivated.body).toMatchObject({ isActive: false, name: 'Saisonales', sortOrder: 9 });
    expect((await auditsOf(categoryId, 'catalog.availability_changed'))[0]).toMatchObject({
      before: { isActive: true },
      after: { isActive: false },
    });

    const product = await createProduct({ name: 'Kürbissuppe', categoryId });
    expect((await call('DELETE', `/catalog/categories/${categoryId}`, admin)).status).toBe(409);
    expect((await call('DELETE', `/catalog/products/${product.id}`, admin)).status).toBe(204);
    expect((await call('DELETE', `/catalog/categories/${categoryId}`, admin)).status).toBe(204);
    const listed = await call<{ id: string }[]>('GET', '/catalog/categories', admin);
    expect(listed.body.some((c) => c.id === categoryId)).toBe(false);
  });

  it('refuses a category inside itself', async () => {
    const parent = await call<{ id: string }>('POST', '/catalog/categories', admin, { name: 'Getränke' });
    const child = await call<{ id: string }>('POST', '/catalog/categories', admin, {
      name: 'Säfte',
      parentId: parent.body.id,
    });
    expect(child.status).toBe(201);
    const loop = await call('PATCH', `/catalog/categories/${parent.body.id}`, admin, { parentId: child.body.id });
    expect(loop.status).toBe(422);
  });
});

describe('products (RF-B01, RF-B02, RF-B05…RF-B08, RF-B11)', () => {
  it('returns the full aggregate of a seeded product', async () => {
    const tagesmenu = await getProduct(id(products, 'Tagesmenü'), waiter);
    expect(tagesmenu).toMatchObject({
      name: 'Tagesmenü',
      basePriceRappen: 2450,
      allergensComplete: true,
      requiresOrigin: true,
      variants: [],
      origins: [{ kind: 'meat', species: 'Rind', country: 'CH' }],
      translations: {
        fr: { name: 'Menu du jour', description: 'Soupe, plat et dessert du jour' },
        en: { name: 'Daily menu' },
      },
      availability: [{ channel: null, daysOfWeek: 31, startTime: '11:30:00', endTime: '14:00:00' }],
      channelPrices: [{ channel: 'takeaway', variantId: null, priceRappen: 1950 }],
      locationSettings: { isActive: true, priceRappen: null, isSoldOut: false },
      publication: { publishable: true, issues: [] },
    });
    expect(tagesmenu.allergens.map((a) => a.allergen)).toEqual(['gluten', 'eggs', 'milk', 'celery']);
    expect(tagesmenu.stationIds.sort()).toEqual([id(stations, 'Küche'), id(stations, 'Patisserie')].sort());

    const water = await getProduct(id(products, 'Mineralwasser'));
    expect(water.variants).toMatchObject([
      { name: '3 dl', priceRappen: 450, isDefault: true, translations: { fr: '3 dl' } },
      { name: '5 dl', priceRappen: 650, isDefault: false },
    ]);
    const fillet = await getProduct(id(products, 'Rindsfilet mit Kräuterbutter'));
    expect(fillet.modifierGroupIds).toEqual([id(modifierGroups, 'Garstufe'), id(modifierGroups, 'Beilage')]);
    const coupe = await getProduct(id(products, 'Coupe Dänemark'));
    expect(coupe.allergens).toEqual([
      { allergen: 'peanuts', presence: 'may_contain' },
      { allergen: 'milk', presence: 'contains' },
      { allergen: 'tree_nuts', presence: 'may_contain' },
    ]);
  });

  it('lists and filters products', async () => {
    const search = await call<Product[]>('GET', '/catalog/products?search=schnitzel', waiter);
    expect(search.body.map((p) => p.name)).toEqual(['Wiener Schnitzel mit Pommes frites']);
    const desserts = await call<Product[]>(
      'GET',
      `/catalog/products?categoryId=${id(categories, 'Desserts')}`,
      waiter,
    );
    expect(desserts.body).toHaveLength(4);
    expect(desserts.body[0]).toMatchObject({ publication: { publishable: true } });
    expect((await call('GET', '/catalog/products?includeInactive=maybe', waiter)).status).toBe(422);
  });

  it('creates a product and replaces each of its collections', async () => {
    const created = await createProduct({ name: 'Cordon bleu', basePriceRappen: 3450, requiresOrigin: true });
    expect(created).toMatchObject({
      isActive: true,
      publishQr: false,
      allergensComplete: false,
      publication: { publishable: false, issues: ['allergens_missing', 'origin_missing'] },
    });
    const productId = created.id;
    const put = async (collection: string, body: unknown) => {
      const response = await call<Product>('PUT', `/catalog/products/${productId}/${collection}`, admin, body);
      expect(response.status, `${collection}: ${JSON.stringify(response.body)}`).toBe(200);
      return response.body;
    };

    const withVariants = await put('variants', {
      variants: [
        { name: 'Normal', priceRappen: 3450, translations: { fr: 'Normal' } },
        { name: 'Gross', priceRappen: 3950, translations: { fr: 'Grand' } },
      ],
    });
    expect(withVariants.variants).toMatchObject([
      { name: 'Normal', isDefault: true, translations: { fr: 'Normal' } },
      { name: 'Gross', isDefault: false, translations: { fr: 'Grand' } },
    ]);
    const large = withVariants.variants[1]!;

    await put('allergens', {
      allergens: [{ allergen: 'milk' }, { allergen: 'gluten' }, { allergen: 'eggs', presence: 'may_contain' }],
      confirmed: true,
    });
    await put('origins', { origins: [{ kind: 'meat', species: 'Schwein', country: 'ch' }] });
    await put('translations', { fr: { name: 'Cordon bleu', description: 'Porc pané' }, en: { name: 'Cordon bleu' } });
    await put('modifier-groups', { modifierGroupIds: [id(modifierGroups, 'Extras'), id(modifierGroups, 'Beilage')] });
    await put('availability', { rules: [{ daysOfWeek: 96, startTime: '17:30', endTime: '22:00' }] });
    await put('channel-prices', { prices: [{ channel: 'takeaway', variantId: large.id, priceRappen: 3500 }] });
    await put('stations', { stationIds: [id(stations, 'Küche')] });
    await put('location-settings', { isActive: true, priceRappen: 3300 });

    const full = await getProduct(productId);
    expect(full).toMatchObject({
      allergensComplete: true,
      allergens: [
        { allergen: 'gluten', presence: 'contains' },
        { allergen: 'eggs', presence: 'may_contain' },
        { allergen: 'milk', presence: 'contains' },
      ],
      origins: [{ kind: 'meat', species: 'Schwein', country: 'CH' }],
      translations: { fr: { name: 'Cordon bleu', description: 'Porc pané' }, en: { name: 'Cordon bleu' } },
      modifierGroupIds: [id(modifierGroups, 'Extras'), id(modifierGroups, 'Beilage')],
      availability: [{ channel: null, daysOfWeek: 96, startTime: '17:30:00', endTime: '22:00:00' }],
      channelPrices: [{ channel: 'takeaway', variantId: large.id, priceRappen: 3500 }],
      stationIds: [id(stations, 'Küche')],
      locationSettings: { isActive: true, priceRappen: 3300, isSoldOut: false },
      publication: { publishable: true, issues: [] },
    });

    // Removing rows soft-deletes them (PA-06); the remaining variant becomes the default.
    const reduced = await put('variants', { variants: [{ id: large.id, name: 'Gross', priceRappen: 3950 }] });
    expect(reduced).toMatchObject({ basePriceRappen: 3950, variants: [{ id: large.id, isDefault: true }] });
    const variantRows = await api.db
      .select()
      .from(s.productVariants)
      .where(eq(s.productVariants.productId, productId));
    expect(variantRows).toHaveLength(2);
    expect(variantRows.find((v) => v.name === 'Normal')?.deletedAt).toBeInstanceOf(Date);
    expect(reduced.channelPrices).toHaveLength(1);

    // A removed allergen comes back on the same row (unique index), not as a duplicate.
    await put('allergens', { allergens: [{ allergen: 'gluten' }], confirmed: true });
    const readded = await put('allergens', { allergens: [{ allergen: 'gluten' }, { allergen: 'milk' }], confirmed: true });
    expect(readded.allergens.map((a) => a.allergen)).toEqual(['gluten', 'milk']);
    const allergenRows = await api.db
      .select()
      .from(s.productAllergens)
      .where(eq(s.productAllergens.productId, productId));
    expect(allergenRows.filter((a) => a.allergen === 'milk')).toHaveLength(1);
    expect(allergenRows.find((a) => a.allergen === 'eggs')?.deletedAt).toBeInstanceOf(Date);

    const events = await eventsOf(productId, 'catalog.product_updated');
    expect(events.length).toBeGreaterThanOrEqual(10);
  });

  it('validates input and references', async () => {
    const badPrice = await call('POST', '/catalog/products', admin, {
      categoryId: id(categories, 'Desserts'),
      taxCategoryId: id(taxCategories, 'food'),
      name: 'Negativ',
      basePriceRappen: -100,
    });
    expect(badPrice.status).toBe(422);
    const unknownCategory = await call('POST', '/catalog/products', admin, {
      categoryId: newId(),
      taxCategoryId: id(taxCategories, 'food'),
      name: 'Waise',
      basePriceRappen: 100,
    });
    expect(unknownCategory.status).toBe(404);
    const productId = id(products, 'Käsespätzle');
    const halfWindow = await call('PUT', `/catalog/products/${productId}/availability`, admin, {
      rules: [{ startTime: '11:00' }],
    });
    expect(halfWindow.status).toBe(422);
    const unknownStation = await call('PUT', `/catalog/products/${productId}/stations`, admin, {
      stationIds: [newId()],
    });
    expect(unknownStation.status).toBe(404);
    const twoDefaults = await call('PUT', `/catalog/products/${productId}/variants`, admin, {
      variants: [
        { name: 'A', priceRappen: 100, isDefault: true },
        { name: 'B', priceRappen: 200, isDefault: true },
      ],
    });
    expect(twoDefaults.status).toBe(422);
  });

  it('duplicates a product with its collections (RF-B18)', async () => {
    const sourceId = id(products, 'Tagesmenü');
    const response = await call<Product>('POST', `/catalog/products/${sourceId}/duplicate`, admin);
    expect(response.status).toBe(201);
    const source = await getProduct(sourceId);
    const copy = response.body;
    expect(copy.id).not.toBe(sourceId);
    expect(copy).toMatchObject({
      name: 'Tagesmenü (Kopie)',
      sku: null,
      isActive: false,
      basePriceRappen: source.basePriceRappen,
      allergens: source.allergens,
      origins: source.origins.map(({ kind, species, country }) => ({ kind, species, country })),
      translations: source.translations,
      availability: source.availability.map(({ channel, daysOfWeek, startTime, endTime }) => ({
        channel,
        daysOfWeek,
        startTime,
        endTime,
      })),
      channelPrices: [{ channel: 'takeaway', priceRappen: 1950 }],
    });
    expect(copy.stationIds.sort()).toEqual(source.stationIds.sort());

    const water = await call<Product>('POST', `/catalog/products/${id(products, 'Mineralwasser')}/duplicate`, admin);
    expect(water.body.variants.map((v) => [v.name, v.priceRappen, v.translations.fr])).toEqual([
      ['3 dl', 450, '3 dl'],
      ['5 dl', 650, '5 dl'],
    ]);
    const originalVariantIds = (await getProduct(id(products, 'Mineralwasser'))).variants.map((v) => v.id);
    expect(water.body.variants.some((v) => originalVariantIds.includes(v.id))).toBe(false);
  });

  it('soft-deletes a product', async () => {
    const product = await createProduct({ name: 'Wegwerfgericht' });
    expect((await call('DELETE', `/catalog/products/${product.id}`, admin)).status).toBe(204);
    expect((await call('GET', `/catalog/products/${product.id}`, admin)).status).toBe(404);
    const [row] = await api.db.select().from(s.products).where(eq(s.products.id, product.id));
    expect(row).toMatchObject({ isActive: false });
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });
});

describe('RF-B17 · price, tax and availability changes are audited', () => {
  it('records who changed a price, with before and after', async () => {
    const productId = id(products, 'Wiener Schnitzel mit Pommes frites');
    const response = await call<Product>('PATCH', `/catalog/products/${productId}`, admin, {
      basePriceRappen: 3700,
    });
    expect(response.status).toBe(200);
    expect(response.body.basePriceRappen).toBe(3700);
    const [audit] = await auditsOf(productId, 'catalog.price_changed');
    expect(audit).toMatchObject({
      userId: demo.users.admin.id,
      locationId: null,
      entityType: 'product',
      before: { basePriceRappen: 3600 },
      after: { basePriceRappen: 3700 },
    });
    expect(await eventsOf(productId, 'catalog.product_updated')).toHaveLength(1);
  });

  it('records tax category changes (RF-B12)', async () => {
    const productId = id(products, 'Hausgemachter Eistee');
    const response = await call('PATCH', `/catalog/products/${productId}`, admin, {
      taxCategoryId: id(taxCategories, 'other'),
    });
    expect(response.status).toBe(200);
    expect((await auditsOf(productId, 'catalog.product_updated'))[0]).toMatchObject({
      before: { taxCategoryId: id(taxCategories, 'non_alcoholic_beverage') },
      after: { taxCategoryId: id(taxCategories, 'other') },
    });
    await call('PATCH', `/catalog/products/${productId}`, admin, {
      taxCategoryId: id(taxCategories, 'non_alcoholic_beverage'),
    });
  });

  it('forbids price changes without catalog.price_change', async () => {
    const productId = id(products, 'Käsespätzle');
    const renamed = await call('PATCH', `/catalog/products/${productId}`, editor, { name: 'Chässpätzli' });
    expect(renamed.status).toBe(200);
    const [renameAudit] = await auditsOf(productId, 'catalog.product_updated');
    expect(renameAudit).toMatchObject({
      userId: editorId,
      before: { name: 'Käsespätzle' },
      after: { name: 'Chässpätzli' },
    });

    for (const [method, path, body] of [
      ['PATCH', `/catalog/products/${productId}`, { basePriceRappen: 100 }],
      ['PUT', `/catalog/products/${productId}/channel-prices`, { prices: [] }],
      ['PUT', `/catalog/products/${productId}/location-settings`, { isActive: true, priceRappen: 100 }],
      ['PUT', `/catalog/products/${productId}/variants`, { variants: [{ name: 'Klein', priceRappen: 100 }] }],
    ] as const) {
      const response = await call<{ error: { code: string; details: { missing: string[] } } }>(
        method,
        path,
        editor,
        body,
      );
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(response.body.error.details.missing).toEqual(['catalog.price_change']);
    }
    const unchanged = await getProduct(productId);
    expect(unchanged).toMatchObject({ basePriceRappen: 2750, variants: [], channelPrices: [{ priceRappen: 2400 }] });

    // Without a price change, the editor may deactivate the product at the location.
    const deactivated = await call<Product>('PUT', `/catalog/products/${productId}/location-settings`, editor, {
      isActive: false,
      priceRappen: null,
    });
    expect(deactivated.body.locationSettings).toMatchObject({ isActive: false, priceRappen: null });
    expect((await auditsOf(productId, 'catalog.availability_changed'))[0]).toMatchObject({
      locationId: demo.locationId,
      before: { isActive: true },
      after: { isActive: false },
    });
    await call('PUT', `/catalog/products/${productId}/location-settings`, admin, { isActive: true, priceRappen: null });
  });

  it('audits channel price changes', async () => {
    const productId = id(products, 'Zürcher Geschnetzeltes mit Rösti');
    const response = await call<Product>('PUT', `/catalog/products/${productId}/channel-prices`, admin, {
      prices: [
        { channel: 'takeaway', priceRappen: 3400 },
        { channel: 'web', priceRappen: 3600 },
      ],
    });
    expect(response.body.channelPrices).toHaveLength(2);
    expect((await auditsOf(productId, 'catalog.price_changed'))[0]).toMatchObject({
      before: { channelPrices: [{ channel: 'takeaway', priceRappen: 3400 }] },
      after: {
        channelPrices: [
          { channel: 'takeaway', priceRappen: 3400 },
          { channel: 'web', priceRappen: 3600 },
        ],
      },
    });
  });

  it('forbids catalog edits to staff without catalog.manage', async () => {
    const productId = id(products, 'Cappuccino');
    for (const headers of [manager, waiter, kitchen]) {
      const response = await call('PATCH', `/catalog/products/${productId}`, headers, { name: 'Hacked' });
      expect(response.status).toBe(403);
    }
    expect((await call('PUT', `/catalog/products/${productId}/allergens`, waiter, { allergens: [], confirmed: true })).status).toBe(403);
    expect((await getProduct(productId)).name).toBe('Cappuccino');
  });
});

describe('RN-18 · no publication to QR or web without allergens and origin', () => {
  it('blocks publishing while allergens or origin are missing', async () => {
    const product = await createProduct({ name: 'Lammrack', requiresOrigin: true });
    const blocked = await call<{ error: { code: string; details: unknown } }>(
      'PATCH',
      `/catalog/products/${product.id}`,
      admin,
      { publishQr: true },
    );
    expect(blocked.status).toBe(422);
    expect(blocked.body.error).toMatchObject({
      code: 'RULE_VIOLATION',
      details: { rule: 'RN-18', issues: ['allergens_missing', 'origin_missing'] },
    });
    const created = await call('POST', '/catalog/products', admin, {
      categoryId: id(categories, 'Hauptgerichte'),
      taxCategoryId: id(taxCategories, 'food'),
      name: 'Sofort online',
      basePriceRappen: 1000,
      publishWeb: true,
    });
    expect(created.status).toBe(422);

    await call('PUT', `/catalog/products/${product.id}/allergens`, admin, { allergens: [], confirmed: true });
    await call('PUT', `/catalog/products/${product.id}/origins`, admin, {
      origins: [{ kind: 'meat', species: 'Lamm', country: 'NZ' }],
    });
    const published = await call<Product>('PATCH', `/catalog/products/${product.id}`, admin, {
      publishQr: true,
      publishWeb: true,
    });
    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({ publishQr: true, publication: { publishable: true } });
  });

  it('keeps unpublishable products off the QR and web menus', async () => {
    const beerId = id(products, 'Amber Bier 3.3 dl');
    await call('PUT', `/catalog/products/${beerId}/allergens`, admin, {
      allergens: [{ allergen: 'gluten' }],
      confirmed: false,
    });
    expect(menuProduct(await getMenu('channel=table'), beerId)).toBeDefined();
    expect(menuProduct(await getMenu('channel=qr'), beerId)).toBeUndefined();
    expect(menuProduct(await getMenu('channel=web'), beerId)).toBeUndefined();
    await call('PUT', `/catalog/products/${beerId}/allergens`, admin, {
      allergens: [{ allergen: 'gluten' }],
      confirmed: true,
    });
    expect(menuProduct(await getMenu('channel=qr'), beerId)).toBeDefined();

    const proseccoId = id(products, 'Prosecco 1 dl');
    await call('PATCH', `/catalog/products/${proseccoId}`, admin, { publishWeb: false });
    expect(menuProduct(await getMenu('channel=web'), proseccoId)).toBeUndefined();
    expect(menuProduct(await getMenu('channel=qr'), proseccoId)).toBeDefined();
  });
});

describe('RF-B09 · sold out ("86")', () => {
  it('lets a waiter 86 a product until the next business day and restore it', async () => {
    const productId = id(products, 'Rivella Rot 3.3 dl');
    const expectedUntil = nextLocalTime(new Date(), 'Europe/Zurich', '04:00');
    const response = await call<Product>('POST', `/catalog/products/${productId}/sold-out`, waiter, {
      nextBusinessDay: true,
    });
    expect(response.status).toBe(200);
    expect(response.body.locationSettings).toMatchObject({
      isSoldOut: true,
      soldOutUntil: expectedUntil.toISOString(),
    });
    expect(await eventsOf(productId, 'catalog.product_sold_out')).toMatchObject([
      { locationId: demo.locationId, userId: demo.users.waiter.id, payload: { until: expectedUntil.toISOString() } },
    ]);
    expect((await auditsOf(productId, 'catalog.availability_changed'))[0]).toMatchObject({
      locationId: demo.locationId,
      userId: demo.users.waiter.id,
      after: { soldOutUntil: expectedUntil.toISOString() },
    });

    expect(menuProduct(await getMenu('channel=table'), productId)).toMatchObject({
      orderable: false,
      reason: 'sold_out',
    });
    // Automatic return: after `until` it can be ordered again without anyone touching it.
    const afterReturn = new Date(expectedUntil.getTime() + 60_000).toISOString();
    expect(menuProduct(await getMenu(`channel=qr&at=${afterReturn}`), productId)).toMatchObject({
      orderable: true,
      reason: null,
    });

    const restored = await call<Product>('DELETE', `/catalog/products/${productId}/sold-out`, waiter);
    expect(restored.status).toBe(200);
    expect(restored.body.locationSettings).toMatchObject({ isSoldOut: false, soldOutUntil: null });
    expect(await eventsOf(productId, 'catalog.product_available')).toHaveLength(1);
    expect(menuProduct(await getMenu('channel=table'), productId)).toMatchObject({ orderable: true });
  });

  it('lets the kitchen 86 a product until a given time', async () => {
    const productId = id(products, 'Meringue mit Doppelrahm');
    const until = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const response = await call<Product>('POST', `/catalog/products/${productId}/sold-out`, kitchen, { until });
    expect(response.body.locationSettings).toMatchObject({ isSoldOut: true, soldOutUntil: until });

    const past = await call('POST', `/catalog/products/${productId}/sold-out`, kitchen, {
      until: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(past.status).toBe(422);
    const both = await call('POST', `/catalog/products/${productId}/sold-out`, kitchen, {
      until,
      nextBusinessDay: true,
    });
    expect(both.status).toBe(422);

    const untilRestored = await call<Product>('POST', `/catalog/products/${productId}/sold-out`, kitchen, {});
    expect(untilRestored.body.locationSettings).toMatchObject({ isSoldOut: true, soldOutUntil: null });
    expect((await call('DELETE', `/catalog/products/${productId}/sold-out`, kitchen)).status).toBe(200);
  });

  it('lets a waiter 86 but not edit the catalog', async () => {
    const juiceId = id(products, 'Frisch gepresster Orangensaft');
    expect((await call('POST', `/catalog/products/${juiceId}/sold-out`, waiter, {})).status).toBe(200);
    expect((await call('PATCH', `/catalog/products/${juiceId}`, waiter, { isActive: false })).status).toBe(403);
    expect(
      (await call('PUT', `/catalog/products/${juiceId}/location-settings`, waiter, { isActive: false, priceRappen: null }))
        .status,
    ).toBe(403);
    expect((await call('DELETE', `/catalog/products/${juiceId}/sold-out`, waiter)).status).toBe(200);
  });
});

describe('menu (RF-B15, RF-E06, RN-17)', () => {
  // Tuesday 2026-10-06, 12:15 in Zürich: inside the Tagesmenü lunch window.
  const tuesdayLunch = '2026-10-06T10:15:00Z';

  it('translates texts and resolves the price of each channel', async () => {
    const takeaway = await getMenu(`channel=takeaway&language=fr&at=${tuesdayLunch}`);
    const mains = takeaway.categories.find((c) => c.id === id(categories, 'Hauptgerichte'));
    expect(mains?.name).toBe('Plats principaux');
    expect(menuProduct(takeaway, id(products, 'Tagesmenü'))).toMatchObject({
      name: 'Menu du jour',
      description: 'Soupe, plat et dessert du jour',
      priceRappen: 1950,
      orderable: true,
      reason: null,
    });
    expect(menuProduct(takeaway, id(products, 'Zürcher Geschnetzeltes mit Rösti'))?.priceRappen).toBe(3400);

    const table = await getMenu(`channel=table&language=fr&at=${tuesdayLunch}`);
    expect(menuProduct(table, id(products, 'Tagesmenü'))?.priceRappen).toBe(2450);
    expect(menuProduct(table, id(products, 'Mineralwasser'))).toMatchObject({
      name: 'Eau minérale',
      priceRappen: 450,
      variants: [
        { name: '3 dl', priceRappen: 450, isDefault: true },
        { name: '5 dl', priceRappen: 650, isDefault: false },
      ],
    });
    const fillet = menuProduct(table, id(products, 'Rindsfilet mit Kräuterbutter'));
    expect(fillet?.modifierGroups.map((g) => g.name)).toEqual(['Cuisson', 'Accompagnement']);
    expect(fillet?.modifierGroups[1]?.modifiers).toContainEqual(
      expect.objectContaining({ name: 'Rösti', priceDeltaRappen: 300 }),
    );
    // Inactive copies (RF-B18) never reach the menu.
    expect(table.categories.flatMap((c) => c.products).some((p) => p.name.endsWith('(Kopie)'))).toBe(false);
  });

  it('falls back to the location language, then to the catalog text (RF-B07)', async () => {
    const product = await createProduct({ name: 'Hausburger' });
    await call('PUT', `/catalog/products/${product.id}/translations`, admin, { fr: { name: 'Burger maison' } });
    expect(menuProduct(await getMenu('language=fr'), product.id)?.name).toBe('Burger maison');
    expect(menuProduct(await getMenu('language=it'), product.id)?.name).toBe('Hausburger');
    expect(menuProduct(await getMenu('language=en'), product.id)).toMatchObject({
      name: 'Hausburger',
      description: null,
    });
  });

  it('explains why a product cannot be ordered now (RN-17)', async () => {
    const tagesmenu = id(products, 'Tagesmenü');
    expect(menuProduct(await getMenu('at=2026-10-06T18:00:00Z'), tagesmenu)).toMatchObject({
      orderable: false,
      reason: 'not_available_now',
    });
    expect(menuProduct(await getMenu('at=2026-10-10T10:15:00Z'), tagesmenu)?.reason).toBe('not_available_now');

    const product = await createProduct({ name: 'Mittagsteller' });
    await call('PUT', `/catalog/products/${product.id}/availability`, admin, {
      rules: [{ channel: 'table', daysOfWeek: 127, startTime: '11:00', endTime: '14:00' }],
    });
    expect(menuProduct(await getMenu(`channel=table&at=${tuesdayLunch}`), product.id)?.orderable).toBe(true);
    expect(menuProduct(await getMenu(`channel=takeaway&at=${tuesdayLunch}`), product.id)).toMatchObject({
      orderable: false,
      reason: 'not_available_on_channel',
    });
  });

  it('hides products that are inactive at the location', async () => {
    const productId = id(products, 'Apfelschorle');
    await call('PUT', `/catalog/products/${productId}/location-settings`, admin, {
      isActive: false,
      priceRappen: null,
    });
    expect(menuProduct(await getMenu('channel=table'), productId)).toBeUndefined();
    await call('PUT', `/catalog/products/${productId}/location-settings`, admin, {
      isActive: true,
      priceRappen: null,
    });
    expect(menuProduct(await getMenu('channel=table'), productId)).toBeDefined();
  });

  it('lets an API key with catalog:read read the menu, but not write (RF-F14)', async () => {
    const insertKey = async (scopes: string[]) => {
      const { key, prefix, hash } = generateApiKey();
      await api.db.insert(s.apiKeys).values({
        organizationId: demo.organizationId,
        name: `Website ${scopes.join(',') || 'none'}`,
        keyPrefix: prefix,
        keyHash: hash,
        scopes,
      });
      return { authorization: `Bearer ${key}`, 'x-location-id': demo.locationId };
    };
    const reader = await insertKey(['catalog:read']);
    const menu = await getMenu('channel=web&language=en', reader);
    expect(menu.categories.length).toBeGreaterThan(0);
    expect((await call('GET', '/catalog/products', reader)).status).toBe(200);

    const productId = id(products, 'Cappuccino');
    expect((await call('PATCH', `/catalog/products/${productId}`, reader, { name: 'x' })).status).toBe(403);
    expect((await call('POST', `/catalog/products/${productId}/sold-out`, reader, {})).status).toBe(403);
    expect((await call('POST', '/catalog/categories', reader, { name: 'x' })).status).toBe(403);

    const unscoped = await insertKey([]);
    expect((await call('GET', '/catalog/menu', unscoped)).status).toBe(403);
    const { 'x-location-id': _, ...withoutLocation } = reader;
    expect((await call('GET', '/catalog/menu', withoutLocation)).status).toBe(400);
  });
});

describe('modifier groups (RF-B02, RF-B05)', () => {
  it('runs the lifecycle of a group and its modifiers', async () => {
    const created = await call<{ id: string }>('POST', '/catalog/modifier-groups', admin, {
      name: 'Sauce',
      maxSelect: 2,
    });
    expect(created.status).toBe(201);
    const groupId = created.body.id;

    const withModifiers = await call<{
      modifiers: { id: string; name: string; priceDeltaRappen: number; allergens: unknown[]; translations: unknown }[];
    }>('PUT', `/catalog/modifier-groups/${groupId}/modifiers`, admin, {
      modifiers: [
        {
          name: 'Pfeffersauce',
          priceDeltaRappen: 350,
          allergens: [{ allergen: 'milk' }],
          translations: { fr: 'Sauce au poivre' },
        },
        { name: 'Ohne Sauce' },
      ],
    });
    expect(withModifiers.status).toBe(200);
    expect(withModifiers.body.modifiers).toMatchObject([
      {
        name: 'Pfeffersauce',
        priceDeltaRappen: 350,
        allergens: [{ allergen: 'milk', presence: 'contains' }],
        translations: { fr: 'Sauce au poivre' },
      },
      { name: 'Ohne Sauce', priceDeltaRappen: 0, allergens: [] },
    ]);
    const pepper = withModifiers.body.modifiers[0]!;

    // A changed surcharge is a price change.
    const editorChange = await call('PUT', `/catalog/modifier-groups/${groupId}/modifiers`, editor, {
      modifiers: [{ id: pepper.id, name: 'Pfeffersauce', priceDeltaRappen: 1 }],
    });
    expect(editorChange.status).toBe(403);
    await call('PUT', `/catalog/modifier-groups/${groupId}/modifiers`, admin, {
      modifiers: [{ id: pepper.id, name: 'Pfeffersauce', priceDeltaRappen: 400, allergens: [{ allergen: 'milk' }] }],
    });
    expect((await auditsOf(groupId, 'catalog.price_changed'))[0]).toMatchObject({
      before: { modifiers: [{ name: 'Pfeffersauce', priceDeltaRappen: 350 }, { name: 'Ohne Sauce' }] },
      after: { modifiers: [{ name: 'Pfeffersauce', priceDeltaRappen: 400 }] },
    });

    const translated = await call('PUT', `/catalog/modifier-groups/${groupId}/translations`, admin, {
      fr: { name: 'Sauce' },
      it: { name: 'Salsa' },
    });
    expect(translated.body).toMatchObject({ translations: { fr: { name: 'Sauce' }, it: { name: 'Salsa' } } });

    expect((await call('PATCH', `/catalog/modifier-groups/${groupId}`, admin, { minSelect: 3 })).status).toBe(422);
    expect(
      (await call('POST', '/catalog/modifier-groups', admin, { name: 'Falsch', minSelect: 2, maxSelect: 1 })).status,
    ).toBe(422);

    const productId = id(products, 'Rindsfilet mit Kräuterbutter');
    const links = [id(modifierGroups, 'Garstufe'), id(modifierGroups, 'Beilage')];
    await call('PUT', `/catalog/products/${productId}/modifier-groups`, admin, { modifierGroupIds: [...links, groupId] });
    expect((await call('DELETE', `/catalog/modifier-groups/${groupId}`, admin)).status).toBe(409);
    await call('PUT', `/catalog/products/${productId}/modifier-groups`, admin, { modifierGroupIds: links });
    expect((await call('DELETE', `/catalog/modifier-groups/${groupId}`, admin)).status).toBe(204);
    expect((await call('GET', `/catalog/modifier-groups/${groupId}`, admin)).status).toBe(404);

    const listed = await call<{ name: string; modifiers: unknown[] }[]>('GET', '/catalog/modifier-groups', waiter);
    expect(listed.body.find((g) => g.name === 'Garstufe')?.modifiers).toHaveLength(3);
  });
});

describe('RNF-12 · another organization sees nothing of our catalog', () => {
  it('answers 404 for our records, even with their ids', async () => {
    const productId = id(products, 'Rindstatar');
    const groupId = id(modifierGroups, 'Extras');
    const categoryId = id(categories, 'Vorspeisen');
    for (const [method, path, body] of [
      ['GET', `/catalog/products/${productId}`, undefined],
      ['PATCH', `/catalog/products/${productId}`, { name: 'x' }],
      ['DELETE', `/catalog/products/${productId}`, undefined],
      ['POST', `/catalog/products/${productId}/duplicate`, undefined],
      ['PUT', `/catalog/products/${productId}/variants`, { variants: [] }],
      ['PUT', `/catalog/products/${productId}/allergens`, { allergens: [], confirmed: true }],
      ['PUT', `/catalog/products/${productId}/location-settings`, { isActive: false, priceRappen: null }],
      ['POST', `/catalog/products/${productId}/sold-out`, {}],
      ['DELETE', `/catalog/products/${productId}/sold-out`, undefined],
      ['PATCH', `/catalog/categories/${categoryId}`, { name: 'x' }],
      ['DELETE', `/catalog/categories/${categoryId}`, undefined],
      ['GET', `/catalog/modifier-groups/${groupId}`, undefined],
      ['PUT', `/catalog/modifier-groups/${groupId}/modifiers`, { modifiers: [] }],
      ['POST', '/catalog/products', { categoryId, taxCategoryId: id(taxCategories, 'food'), name: 'x', basePriceRappen: 1 }],
    ] as const) {
      const response = await call(method, path, otherAdmin, body);
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    const product = await getProduct(productId);
    expect(product).toMatchObject({ name: 'Rindstatar', isActive: true, locationSettings: { isActive: true } });
  });

  it('sees an empty catalog and menu', async () => {
    expect((await call('GET', '/catalog/products', otherAdmin)).body).toEqual([]);
    expect((await call('GET', '/catalog/categories', otherAdmin)).body).toEqual([]);
    expect((await call('GET', '/catalog/modifier-groups', otherAdmin)).body).toEqual([]);
    expect((await getMenu('channel=table', otherAdmin)).categories).toEqual([]);
  });

  it('cannot reference its own records from our catalog', async () => {
    const theirs = await call<{ id: string }>('POST', '/catalog/categories', otherAdmin, { name: 'Fremd' });
    expect(theirs.status).toBe(201);
    const response = await call('PATCH', `/catalog/products/${id(products, 'Tomatensuppe')}`, admin, {
      categoryId: theirs.body.id,
    });
    expect(response.status).toBe(404);
  });
});
