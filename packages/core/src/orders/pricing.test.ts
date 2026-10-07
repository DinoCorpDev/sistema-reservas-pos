import { describe, expect, it } from 'vitest';
import type { MenuProduct } from '../catalog/menu';
import { CONSUMPTION_TYPES, type ConsumptionType } from '../shared/channels';
import { rappen } from '../shared/money';
import { TaxError, type TaxRateRecord, type TaxRuleRecord } from '../tax/calculation';
import type { TaxCategoryKey, TaxRateCode } from '../tax/constants';
import { lineSnapshotSchema } from './operations';
import { buildLineSnapshot, LineError, type LineSelection } from './pricing';
import { uid } from './test-kit';

// Rates and rules are DATA (RN-02): the test builds them like the database would hold them.
const RATES: TaxRateRecord[] = [
  { code: 'normal', rateBp: 770, validFrom: '2018-01-01', validTo: '2023-12-31' },
  { code: 'reduced', rateBp: 250, validFrom: '2018-01-01', validTo: '2023-12-31' },
  { code: 'normal', rateBp: 810, validFrom: '2024-01-01', validTo: null },
  { code: 'reduced', rateBp: 260, validFrom: '2024-01-01', validTo: null },
];

const MATRIX: Partial<Record<TaxCategoryKey, Record<ConsumptionType, TaxRateCode>>> = {
  food: { on_premise: 'normal', takeaway: 'reduced', delivery: 'reduced' },
  non_alcoholic_beverage: { on_premise: 'normal', takeaway: 'reduced', delivery: 'reduced' },
  alcoholic_beverage: { on_premise: 'normal', takeaway: 'normal', delivery: 'normal' },
};

const RULES: TaxRuleRecord[] = Object.entries(MATRIX).flatMap(([taxCategoryKey, byType]) =>
  CONSUMPTION_TYPES.map((consumptionType) => ({
    taxCategoryKey: taxCategoryKey as TaxCategoryKey,
    consumptionType,
    rateCode: byType[consumptionType],
    validFrom: '2018-01-01',
    validTo: null,
  })),
);

const EGG = { fried: uid(631), scrambled: uid(632) };
const EXTRA = { bacon: uid(641), noOnion: uid(642), cheese: uid(643) };
const STATION = { kitchen: uid(650), grill: uid(651), bar: uid(652) };

/** Berner Rösti, CHF 24.50, main course; one egg is mandatory, up to two extras. */
const ROSTI: MenuProduct = {
  id: uid(600),
  categoryId: uid(610),
  taxCategoryId: uid(620),
  taxCategoryKey: 'food',
  sku: null,
  name: 'Berner Rösti',
  description: null,
  imageUrl: null,
  defaultCourse: 2,
  priceRappen: rappen(2450),
  variants: [],
  allergens: [],
  origins: [],
  modifierGroups: [
    {
      id: uid(630),
      name: 'Ei',
      minSelect: 1,
      maxSelect: 1,
      modifiers: [
        { id: EGG.fried, name: 'Spiegelei', priceDeltaRappen: rappen(250), allergens: [] },
        { id: EGG.scrambled, name: 'Rührei', priceDeltaRappen: rappen(300), allergens: [] },
      ],
    },
    {
      id: uid(640),
      name: 'Extras',
      minSelect: 0,
      maxSelect: 2,
      modifiers: [
        { id: EXTRA.bacon, name: 'Speck', priceDeltaRappen: rappen(400), allergens: [] },
        { id: EXTRA.noOnion, name: 'ohne Zwiebeln', priceDeltaRappen: rappen(0), allergens: [] },
        { id: EXTRA.cheese, name: 'Käse', priceDeltaRappen: rappen(350), allergens: [] },
      ],
    },
  ],
  stationIds: [STATION.kitchen, STATION.grill],
  orderable: true,
  reason: null,
};

/** Bier with two sizes; 5 dl is the default. */
const BEER: MenuProduct = {
  ...ROSTI,
  id: uid(601),
  taxCategoryKey: 'alcoholic_beverage',
  name: 'Bier',
  defaultCourse: 1,
  priceRappen: rappen(750),
  variants: [
    { id: uid(661), name: '3 dl', priceRappen: rappen(550), isDefault: false },
    { id: uid(662), name: '5 dl', priceRappen: rappen(750), isDefault: true },
  ],
  modifierGroups: [],
  stationIds: [STATION.bar],
};

const ITEM_ID = uid(700);
const ROW_IDS = [uid(701), uid(702), uid(703)];

type BuildInput = Parameters<typeof buildLineSnapshot>[0];

function build(
  selection: Partial<LineSelection> = {},
  overrides: Partial<Omit<BuildInput, 'selection'>> = {},
) {
  return buildLineSnapshot({
    selection: {
      product: ROSTI,
      variantId: null,
      modifiers: [{ modifierId: EGG.fried, quantity: 1 }],
      quantity: 1,
      note: null,
      seat: null,
      ...selection,
    },
    ids: { itemId: ITEM_ID, modifierRowIds: ROW_IDS },
    consumptionType: 'on_premise',
    saleDate: '2026-10-06',
    taxRules: RULES,
    taxRates: RATES,
    ...overrides,
  });
}

function lineErrorOf(fn: () => unknown): LineError {
  try {
    fn();
  } catch (error) {
    if (error instanceof LineError) return error;
    throw error;
  }
  throw new Error('Expected a LineError, nothing was thrown');
}

describe('buildLineSnapshot (RF-C08, RN-04, RN-17)', () => {
  it('freezes product, price, modifiers, rate and routing into a valid line', () => {
    const snapshot = build({ seat: 3 });
    expect(snapshot).toEqual({
      itemId: ITEM_ID,
      productId: ROSTI.id,
      variantId: null,
      name: 'Berner Rösti',
      variantName: null,
      quantity: 1,
      unitPriceRappen: 2450,
      modifiers: [
        {
          id: ROW_IDS[0],
          modifierId: EGG.fried,
          name: 'Spiegelei',
          priceDeltaRappen: 250,
          quantity: 1,
        },
      ],
      taxCategoryKey: 'food',
      taxRateCode: 'normal',
      taxRateBp: 810,
      course: 2,
      seat: 3,
      note: null,
      stationIds: [STATION.kitchen, STATION.grill],
    });
    // It is exactly what `items.add` accepts.
    expect(lineSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it('assigns the modifier row ids in selection order and keeps their quantities', () => {
    const snapshot = build({
      modifiers: [
        { modifierId: EGG.scrambled, quantity: 1 },
        { modifierId: EXTRA.bacon, quantity: 2 },
      ],
    });
    expect(snapshot.modifiers).toEqual([
      {
        id: ROW_IDS[0],
        modifierId: EGG.scrambled,
        name: 'Rührei',
        priceDeltaRappen: 300,
        quantity: 1,
      },
      {
        id: ROW_IDS[1],
        modifierId: EXTRA.bacon,
        name: 'Speck',
        priceDeltaRappen: 400,
        quantity: 2,
      },
    ]);
    // The unit price stays the product price: modifiers are their own rows.
    expect(snapshot.unitPriceRappen).toBe(2450);
  });

  it('copies the station ids instead of sharing the menu array', () => {
    const snapshot = build();
    expect(snapshot.stationIds).toEqual(ROSTI.stationIds);
    expect(snapshot.stationIds).not.toBe(ROSTI.stationIds);
  });

  describe('orderability (RN-17)', () => {
    it('refuses a product that cannot be ordered now and says why', () => {
      const soldOut: MenuProduct = { ...ROSTI, orderable: false, reason: 'sold_out' };
      const error = lineErrorOf(() => build({ product: soldOut }));
      expect(error.code).toBe('NOT_ORDERABLE');
      expect(error.details).toEqual({ reason: 'sold_out' });
    });

    it('checks orderability before anything else', () => {
      const closed: MenuProduct = { ...ROSTI, orderable: false, reason: 'not_available_now' };
      expect(lineErrorOf(() => build({ product: closed, quantity: 0 })).code).toBe('NOT_ORDERABLE');
    });
  });

  describe('quantity and course', () => {
    it.each([1, 2, 999])('accepts quantity %i', (quantity) => {
      expect(build({ quantity }).quantity).toBe(quantity);
    });

    it.each([0, -1, 1000, 1.5, Number.NaN])('refuses quantity %s', (quantity) => {
      expect(lineErrorOf(() => build({ quantity })).code).toBe('INVALID_QUANTITY');
    });

    it('uses the default course of the product when none is chosen', () => {
      expect(build().course).toBe(2);
      expect(build({ product: BEER, modifiers: [] }).course).toBe(1);
    });

    // DEC-011: 0 = drinks (go at once), 1 = starters, 2 = mains…
    it.each([0, 1, 5, 9])('accepts course %i', (course) => {
      expect(build({ course }).course).toBe(course);
    });

    it.each([-1, 10, 2.5])('refuses course %s', (course) => {
      expect(lineErrorOf(() => build({ course })).code).toBe('INVALID_COURSE');
    });

    it('takes a drink course 0 from the product, and refuses an out-of-range default', () => {
      expect(build({ product: { ...ROSTI, defaultCourse: 0 } }).course).toBe(0);
      const broken: MenuProduct = { ...ROSTI, defaultCourse: 12 };
      expect(lineErrorOf(() => build({ product: broken })).code).toBe('INVALID_COURSE');
    });
  });

  describe('variants (RF-B04)', () => {
    it('uses the chosen variant price and name', () => {
      const snapshot = build({ product: BEER, variantId: uid(661), modifiers: [] });
      expect(snapshot).toMatchObject({
        variantId: uid(661),
        variantName: '3 dl',
        unitPriceRappen: 550,
      });
    });

    it('picks the default variant when none is chosen', () => {
      const snapshot = build({ product: BEER, variantId: null, modifiers: [] });
      expect(snapshot).toMatchObject({
        variantId: uid(662),
        variantName: '5 dl',
        unitPriceRappen: 750,
      });
    });

    it('falls back to the first variant when none is marked as default', () => {
      const noDefault: MenuProduct = {
        ...BEER,
        variants: BEER.variants.map((v) => ({ ...v, isDefault: false })),
      };
      const snapshot = build({ product: noDefault, variantId: null, modifiers: [] });
      expect(snapshot).toMatchObject({ variantId: uid(661), unitPriceRappen: 550 });
    });

    it('names the variant only when the product has more than one', () => {
      const single: MenuProduct = {
        ...BEER,
        variants: [{ id: uid(663), name: 'Flasche', priceRappen: rappen(800), isDefault: true }],
      };
      const snapshot = build({ product: single, variantId: null, modifiers: [] });
      expect(snapshot).toMatchObject({
        variantId: uid(663),
        variantName: null,
        unitPriceRappen: 800,
      });
    });

    it('refuses a variant that does not belong to the product', () => {
      const error = lineErrorOf(() => build({ product: BEER, variantId: uid(999), modifiers: [] }));
      expect(error.code).toBe('UNKNOWN_VARIANT');
    });

    it('refuses any variant id for a product without variants', () => {
      expect(lineErrorOf(() => build({ variantId: uid(661) })).code).toBe('UNKNOWN_VARIANT');
    });
  });

  describe('modifiers (RF-B02)', () => {
    it('refuses a missing mandatory choice', () => {
      const error = lineErrorOf(() => build({ modifiers: [] }));
      expect(error.code).toBe('INVALID_MODIFIERS');
      expect(error.details).toEqual([
        { code: 'below_min', groupId: uid(630), min: 1, selected: 0 },
      ]);
    });

    it('refuses more choices than a group allows, counting quantities', () => {
      const error = lineErrorOf(() =>
        build({
          modifiers: [
            { modifierId: EGG.fried, quantity: 1 },
            { modifierId: EXTRA.bacon, quantity: 2 },
            { modifierId: EXTRA.cheese, quantity: 1 },
          ],
        }),
      );
      expect(error.code).toBe('INVALID_MODIFIERS');
      expect(error.details).toEqual([
        { code: 'above_max', groupId: uid(640), max: 2, selected: 3 },
      ]);
    });

    it('refuses a modifier of another product', () => {
      const error = lineErrorOf(() =>
        build({
          modifiers: [
            { modifierId: EGG.fried, quantity: 1 },
            { modifierId: uid(999), quantity: 1 },
          ],
        }),
      );
      expect(error.code).toBe('INVALID_MODIFIERS');
      expect(error.details).toEqual([{ code: 'unknown_modifier', modifierId: uid(999) }]);
    });

    it('refuses when the caller did not provide an id for every modifier row', () => {
      const error = lineErrorOf(() =>
        buildLineSnapshot({
          selection: {
            product: ROSTI,
            variantId: null,
            modifiers: [
              { modifierId: EGG.fried, quantity: 1 },
              { modifierId: EXTRA.noOnion, quantity: 1 },
            ],
            quantity: 1,
            note: null,
            seat: null,
          },
          ids: { itemId: ITEM_ID, modifierRowIds: [uid(701)] },
          consumptionType: 'on_premise',
          saleDate: '2026-10-06',
          taxRules: RULES,
          taxRates: RATES,
        }),
      );
      expect(error.code).toBe('INVALID_MODIFIERS');
      expect(error.details).toBeUndefined();
    });
  });

  describe('MWST rate from data (RN-02, RN-03, RN-04)', () => {
    it.each([
      ['food', 'on_premise', 'normal', 810],
      ['food', 'takeaway', 'reduced', 260],
      ['food', 'delivery', 'reduced', 260],
      ['non_alcoholic_beverage', 'takeaway', 'reduced', 260],
      ['alcoholic_beverage', 'on_premise', 'normal', 810],
      ['alcoholic_beverage', 'takeaway', 'normal', 810],
    ] as const)('%s consumed %s → %s %i bp', (taxCategoryKey, consumptionType, code, bp) => {
      const product: MenuProduct = { ...ROSTI, taxCategoryKey };
      const snapshot = build({ product }, { consumptionType });
      expect(snapshot).toMatchObject({ taxCategoryKey, taxRateCode: code, taxRateBp: bp });
    });

    it('uses the rate valid on the sale date', () => {
      expect(build({}, { saleDate: '2023-12-31' }).taxRateBp).toBe(770);
      expect(build({}, { saleDate: '2024-01-01' }).taxRateBp).toBe(810);
      expect(build({}, { saleDate: '2023-06-30', consumptionType: 'takeaway' }).taxRateBp).toBe(
        250,
      );
    });

    it('fails loudly when the tax data is missing, never with a default rate', () => {
      expect(() => build({}, { taxRules: [] })).toThrow(TaxError);
      expect(() => build({}, { taxRates: [] })).toThrow(
        expect.objectContaining({ code: 'NO_RATE' }),
      );
    });
  });

  describe('note and seat', () => {
    it('trims the note', () => {
      expect(build({ note: '  ohne Salz  ' }).note).toBe('ohne Salz');
    });

    it.each(['', '   ', null])('stores an empty note (%j) as null', (note) => {
      expect(build({ note }).note).toBeNull();
    });

    it('keeps the seat as chosen', () => {
      expect(build({ seat: null }).seat).toBeNull();
      expect(build({ seat: 4 }).seat).toBe(4);
    });
  });
});
