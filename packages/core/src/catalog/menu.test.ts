import { describe, expect, it } from 'vitest';
import type { Channel } from '../shared/channels';
import type { ContentLanguage } from '../shared/languages';
import { buildMenu, type CatalogSnapshot, type Menu } from './menu';

type ProductRow = CatalogSnapshot['products'][number];

const product = (id: string, categoryId: string, fields: Partial<ProductRow> = {}): ProductRow => ({
  id,
  categoryId,
  taxCategoryId: 'tc-food',
  taxCategoryKey: 'food',
  sku: null,
  name: id,
  description: null,
  imageUrl: null,
  defaultCourse: 1,
  basePriceRappen: 1000,
  isActive: true,
  publishQr: false,
  publishWeb: false,
  allergensComplete: true,
  requiresOrigin: false,
  ...fields,
});

/** "Restaurant Demo Zürich": rows as the API reads them, already sorted for display. */
const SNAPSHOT: CatalogSnapshot = {
  locationId: 'loc-zh',
  timeZone: 'Europe/Zurich',
  locationLanguage: 'de',
  catalogLanguage: 'de',
  categories: [
    { id: 'cat-mains', parentId: null, name: 'Hauptgerichte', description: null, imageUrl: null },
    {
      id: 'cat-drinks',
      parentId: null,
      name: 'Getränke',
      description: 'Kalt und warm',
      imageUrl: '/img/drinks.jpg',
    },
    { id: 'cat-desserts', parentId: null, name: 'Desserts', description: null, imageUrl: null },
  ],
  products: [
    product('p-rosti', 'cat-mains', {
      name: 'Berner Rösti',
      description: 'Mit Spiegelei',
      sku: 'R-01',
      basePriceRappen: 2450,
      defaultCourse: 2,
      publishQr: true,
      publishWeb: true,
    }),
    product('p-geschnetzeltes', 'cat-mains', {
      name: 'Zürcher Geschnetzeltes',
      basePriceRappen: 3850,
      defaultCourse: 2,
      requiresOrigin: true,
      publishQr: true,
    }),
    // Meat without a declared origin: sold in the room, never published (RN-18).
    product('p-wurst', 'cat-mains', {
      name: 'Kalbsbratwurst',
      basePriceRappen: 1950,
      requiresOrigin: true,
      publishQr: true,
      publishWeb: true,
    }),
    product('p-tagesmenu', 'cat-mains', { name: 'Tagesmenü', basePriceRappen: 1990 }),
    product('p-fondue', 'cat-mains', { name: 'Käsefondue', basePriceRappen: 3200 }),
    product('p-hidden', 'cat-mains', { name: 'Saisonale Spezialität', basePriceRappen: 2900 }),
    product('p-bier', 'cat-drinks', {
      name: 'Bier',
      taxCategoryId: 'tc-alcohol',
      taxCategoryKey: 'alcoholic_beverage',
      basePriceRappen: 600,
      publishQr: true,
      allergensComplete: false,
    }),
    product('p-cola', 'cat-drinks', {
      name: 'Cola',
      taxCategoryId: 'tc-soft',
      taxCategoryKey: 'non_alcoholic_beverage',
      basePriceRappen: 450,
    }),
    product('p-creme', 'cat-desserts', {
      name: 'Crème brûlée',
      basePriceRappen: 1200,
      isActive: false,
      publishQr: true,
    }),
  ],
  variants: [
    { id: 'v-bier-3dl', productId: 'p-bier', name: '3 dl', priceRappen: 550, isDefault: false },
    { id: 'v-bier-5dl', productId: 'p-bier', name: '5 dl', priceRappen: 750, isDefault: true },
    { id: 'v-cola-3dl', productId: 'p-cola', name: '3 dl', priceRappen: 450, isDefault: false },
    { id: 'v-cola-5dl', productId: 'p-cola', name: '5 dl', priceRappen: 600, isDefault: false },
  ],
  allergens: [
    { productId: 'p-rosti', allergen: 'milk', presence: 'contains' },
    { productId: 'p-rosti', allergen: 'eggs', presence: 'contains' },
    { productId: 'p-rosti', allergen: 'gluten', presence: 'traces' },
  ],
  origins: [{ productId: 'p-geschnetzeltes', kind: 'meat', species: 'veal', country: 'CH' }],
  productModifierGroups: [
    { productId: 'p-rosti', modifierGroupId: 'mg-extras' },
    { productId: 'p-rosti', modifierGroupId: 'mg-deleted' },
  ],
  modifierGroups: [{ id: 'mg-extras', name: 'Extras', minSelect: 0, maxSelect: 2 }],
  modifiers: [
    { id: 'm-egg', modifierGroupId: 'mg-extras', name: 'Spiegelei', priceDeltaRappen: 250 },
    { id: 'm-bacon', modifierGroupId: 'mg-extras', name: 'Speck', priceDeltaRappen: 400 },
  ],
  modifierAllergens: [{ modifierId: 'm-egg', allergen: 'eggs', presence: 'contains' }],
  availabilityRules: [
    // Tagesmenü: Monday to Friday, 11:30-14:00.
    {
      locationId: null,
      productId: 'p-tagesmenu',
      categoryId: null,
      channel: null,
      daysOfWeek: 0b0011111,
      startTime: '11:30',
      endTime: '14:00',
      validFrom: null,
      validTo: null,
    },
  ],
  channelPrices: [
    {
      productId: 'p-rosti',
      channel: 'takeaway',
      locationId: null,
      variantId: null,
      priceRappen: 2200,
    },
    {
      productId: 'p-rosti',
      channel: 'takeaway',
      locationId: 'loc-be',
      variantId: null,
      priceRappen: 2100,
    },
    {
      productId: 'p-bier',
      channel: 'takeaway',
      locationId: null,
      variantId: 'v-bier-5dl',
      priceRappen: 700,
    },
  ],
  locationSettings: [
    {
      productId: 'p-geschnetzeltes',
      isActive: true,
      priceRappen: 3950,
      soldOutAt: null,
      soldOutUntil: null,
    },
    // "86" since 11:00, back automatically at 04:00 the next day (RF-B09).
    {
      productId: 'p-fondue',
      isActive: true,
      priceRappen: null,
      soldOutAt: '2026-10-06T09:00:00.000Z',
      soldOutUntil: '2026-10-07T02:00:00.000Z',
    },
    {
      productId: 'p-hidden',
      isActive: false,
      priceRappen: null,
      soldOutAt: null,
      soldOutUntil: null,
    },
  ],
  productStations: [
    { productId: 'p-rosti', kitchenStationId: 'st-kitchen' },
    { productId: 'p-rosti', kitchenStationId: 'st-grill' },
    { productId: 'p-bier', kitchenStationId: 'st-bar' },
  ],
  translations: {
    'p-rosti': {
      fr: { name: 'Rösti bernoise', description: 'Avec œuf au plat' },
      en: { name: 'Bernese rösti' },
    },
    'cat-mains': { fr: { name: 'Plats principaux' } },
    'cat-drinks': { fr: { description: 'Froid et chaud' } },
    'm-egg': { fr: { name: 'Œuf au plat' } },
    'v-bier-5dl': { it: { name: '5 dl (grande)' } },
  },
};

const TUESDAY_LUNCH = new Date('2026-10-06T10:15:00Z'); // 12:15 in Zürich
const TUESDAY_EVENING = new Date('2026-10-06T18:00:00Z'); // 20:00
const SATURDAY_LUNCH = new Date('2026-10-10T10:15:00Z');

const menuFor = (
  channel: Channel,
  options: { at?: Date; language?: ContentLanguage; snapshot?: CatalogSnapshot } = {},
) =>
  buildMenu(options.snapshot ?? SNAPSHOT, {
    channel,
    at: options.at ?? TUESDAY_LUNCH,
    ...(options.language ? { language: options.language } : {}),
  });

const productIn = (menu: Menu, id: string) => {
  const found = menu.categories.flatMap((c) => c.products).find((p) => p.id === id);
  if (!found) throw new Error(`${id} is not on the menu`);
  return found;
};
const productIds = (menu: Menu) => menu.categories.flatMap((c) => c.products.map((p) => p.id));

describe('buildMenu (RF-B15, RF-E06, RF-F14)', () => {
  describe('what is listed', () => {
    const menu = menuFor('table');

    it('describes the location, channel, language and moment', () => {
      expect(menu).toMatchObject({
        locationId: 'loc-zh',
        channel: 'table',
        language: 'de',
        at: '2026-10-06T10:15:00.000Z',
      });
    });

    it('keeps the display order and drops categories without listed products', () => {
      expect(menu.categories.map((c) => c.id)).toEqual(['cat-mains', 'cat-drinks']);
      expect(menu.categories[0]!.products.map((p) => p.id)).toEqual([
        'p-rosti',
        'p-geschnetzeltes',
        'p-wurst',
        'p-tagesmenu',
        'p-fondue',
      ]);
      expect(menu.categories[1]).toMatchObject({
        name: 'Getränke',
        description: 'Kalt und warm',
        imageUrl: '/img/drinks.jpg',
      });
    });

    it('leaves out inactive products and products inactive at the location', () => {
      expect(productIds(menu)).not.toContain('p-creme');
      expect(productIds(menu)).not.toContain('p-hidden');
    });

    it('carries everything the POS needs for a product', () => {
      expect(productIn(menu, 'p-rosti')).toEqual({
        id: 'p-rosti',
        categoryId: 'cat-mains',
        taxCategoryId: 'tc-food',
        taxCategoryKey: 'food',
        sku: 'R-01',
        name: 'Berner Rösti',
        description: 'Mit Spiegelei',
        imageUrl: null,
        defaultCourse: 2,
        priceRappen: 2450,
        variants: [],
        // Sorted in the legal order of the 14 allergens (RF-B05).
        allergens: [
          { allergen: 'gluten', presence: 'traces' },
          { allergen: 'eggs', presence: 'contains' },
          { allergen: 'milk', presence: 'contains' },
        ],
        origins: [],
        // A link to a group that no longer exists is ignored.
        modifierGroups: [
          {
            id: 'mg-extras',
            name: 'Extras',
            minSelect: 0,
            maxSelect: 2,
            modifiers: [
              {
                id: 'm-egg',
                name: 'Spiegelei',
                priceDeltaRappen: 250,
                allergens: [{ allergen: 'eggs', presence: 'contains' }],
              },
              { id: 'm-bacon', name: 'Speck', priceDeltaRappen: 400, allergens: [] },
            ],
          },
        ],
        stationIds: ['st-kitchen', 'st-grill'],
        orderable: true,
        reason: null,
      });
    });

    it('carries the tax category and the kitchen stations (RF-C20)', () => {
      expect(productIn(menu, 'p-bier')).toMatchObject({
        taxCategoryId: 'tc-alcohol',
        taxCategoryKey: 'alcoholic_beverage',
        stationIds: ['st-bar'],
      });
      expect(productIn(menu, 'p-cola')).toMatchObject({
        taxCategoryKey: 'non_alcoholic_beverage',
        stationIds: [],
      });
    });

    it('carries the declared origin (RF-B06)', () => {
      expect(productIn(menu, 'p-geschnetzeltes').origins).toEqual([
        { kind: 'meat', species: 'veal', country: 'CH' },
      ]);
    });
  });

  describe('prices (RF-B01, RF-B04)', () => {
    it('uses the default variant for the product price', () => {
      const beer = productIn(menuFor('table'), 'p-bier');
      expect(beer.priceRappen).toBe(750);
      expect(beer.variants).toEqual([
        { id: 'v-bier-3dl', name: '3 dl', priceRappen: 550, isDefault: false },
        { id: 'v-bier-5dl', name: '5 dl', priceRappen: 750, isDefault: true },
      ]);
    });

    it('makes the first variant the default when none is marked', () => {
      const cola = productIn(menuFor('table'), 'p-cola');
      expect(cola.priceRappen).toBe(450);
      expect(cola.variants.map((v) => v.isDefault)).toEqual([true, false]);
    });

    it('applies the location price override', () => {
      expect(productIn(menuFor('table'), 'p-geschnetzeltes').priceRappen).toBe(3950);
      expect(productIn(menuFor('takeaway'), 'p-geschnetzeltes').priceRappen).toBe(3950);
    });

    it('applies channel prices, per variant, ignoring other locations', () => {
      const takeaway = menuFor('takeaway');
      expect(productIn(takeaway, 'p-rosti').priceRappen).toBe(2200);
      const beer = productIn(takeaway, 'p-bier');
      expect(beer.priceRappen).toBe(700);
      expect(beer.variants.map((v) => v.priceRappen)).toEqual([550, 700]);
      expect(productIn(menuFor('table'), 'p-rosti').priceRappen).toBe(2450);
    });
  });

  describe('orderability (RN-17, RF-B08, RF-B09)', () => {
    it('lists a sold-out product as not orderable until its return time', () => {
      expect(productIn(menuFor('table'), 'p-fondue')).toMatchObject({
        orderable: false,
        reason: 'sold_out',
      });
      const nextMorning = menuFor('table', { at: new Date('2026-10-07T02:00:00Z') });
      expect(productIn(nextMorning, 'p-fondue')).toMatchObject({ orderable: true, reason: null });
    });

    it('honours availability windows in local time', () => {
      expect(productIn(menuFor('table'), 'p-tagesmenu').orderable).toBe(true);
      for (const at of [TUESDAY_EVENING, SATURDAY_LUNCH]) {
        expect(productIn(menuFor('table', { at }), 'p-tagesmenu')).toMatchObject({
          orderable: false,
          reason: 'not_available_now',
        });
      }
    });

    it('applies category rules restricted to a channel', () => {
      const drinksAtTableOnly: CatalogSnapshot = {
        ...SNAPSHOT,
        availabilityRules: [
          ...SNAPSHOT.availabilityRules,
          {
            locationId: 'loc-zh',
            productId: null,
            categoryId: 'cat-drinks',
            channel: 'table',
            daysOfWeek: 127,
            startTime: null,
            endTime: null,
            validFrom: null,
            validTo: null,
          },
        ],
      };
      expect(productIn(menuFor('table', { snapshot: drinksAtTableOnly }), 'p-bier').orderable).toBe(
        true,
      );
      expect(
        productIn(menuFor('takeaway', { snapshot: drinksAtTableOnly }), 'p-bier'),
      ).toMatchObject({ orderable: false, reason: 'not_available_on_channel' });
      // The rule of the drinks does not touch the mains.
      expect(
        productIn(menuFor('takeaway', { snapshot: drinksAtTableOnly }), 'p-rosti').orderable,
      ).toBe(true);
    });
  });

  describe('QR and web publish only what may be published (RN-18)', () => {
    it('QR lists products published to QR with confirmed allergens and origin', () => {
      const qr = menuFor('qr');
      // Wurst: origin missing. Bier: allergens not confirmed. Others: not published to QR.
      expect(productIds(qr)).toEqual(['p-rosti', 'p-geschnetzeltes']);
      expect(qr.categories.map((c) => c.id)).toEqual(['cat-mains']);
    });

    it('web lists products published to the web', () => {
      expect(productIds(menuFor('web'))).toEqual(['p-rosti']);
    });

    it('the POS channels list everything active, publishable or not', () => {
      for (const channel of ['table', 'bar', 'takeaway'] as const) {
        expect(productIds(menuFor(channel))).toContain('p-wurst');
        expect(productIds(menuFor(channel))).toContain('p-bier');
      }
    });
  });

  describe('translations (RF-B07)', () => {
    it('uses the requested language where there is a translation', () => {
      const fr = menuFor('table', { language: 'fr' });
      expect(fr.language).toBe('fr');
      expect(productIn(fr, 'p-rosti')).toMatchObject({
        name: 'Rösti bernoise',
        description: 'Avec œuf au plat',
      });
      expect(fr.categories.map((c) => c.name)).toEqual(['Plats principaux', 'Getränke']);
      expect(fr.categories[1]!.description).toBe('Froid et chaud');
      expect(productIn(fr, 'p-rosti').modifierGroups[0]!.modifiers.map((m) => m.name)).toEqual([
        'Œuf au plat',
        'Speck',
      ]);
      expect(productIn(menuFor('table', { language: 'en' }), 'p-rosti').name).toBe('Bernese rösti');
    });

    it('falls back to the location language, then to the catalog text', () => {
      // A location in Geneva: French on site, catalog written in German.
      const geneva: CatalogSnapshot = { ...SNAPSHOT, locationLanguage: 'fr' };
      const italian = menuFor('table', { language: 'it', snapshot: geneva });
      expect(productIn(italian, 'p-rosti').name).toBe('Rösti bernoise'); // location language
      expect(productIn(italian, 'p-bier').name).toBe('Bier'); // catalog text
      expect(productIn(italian, 'p-bier').variants.map((v) => v.name)).toEqual([
        '3 dl',
        '5 dl (grande)',
      ]);
      expect(productIn(italian, 'p-geschnetzeltes').description).toBeNull();
    });

    it('uses the location language when no language is requested', () => {
      const geneva: CatalogSnapshot = { ...SNAPSHOT, locationLanguage: 'fr' };
      const menu = menuFor('table', { snapshot: geneva });
      expect(menu.language).toBe('fr');
      expect(productIn(menu, 'p-rosti').name).toBe('Rösti bernoise');
    });

    it('the catalog language shows the catalog text', () => {
      expect(productIn(menuFor('table', { language: 'de' }), 'p-rosti').name).toBe('Berner Rösti');
    });
  });
});
