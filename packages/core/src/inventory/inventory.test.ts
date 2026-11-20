import { describe, expect, it } from 'vitest';
import { foldOperations } from '../orders/reducer';
import { CONTEXT, Device, freshId, line, STATION, TERMINAL, uid, USER } from '../orders/test-kit';
import { recordMovementSchema, replaceRecipeSchema, updateIngredientSchema } from './commands';
import { consumptionKind, stockUsage, takesStock, usageKey } from './consumption';
import { recipeBook, resolveRecipe, type RecipeLine } from './recipes';
import { isLowStock, movementDelta } from './stock';
import { formatQuantity, fromBaseQuantity, toBaseQuantity } from './units';

const BEEF = uid(900);
const POTATO = uid(901);
const OIL = uid(902);
const LOMO = uid(500); // the product of line()
const LARGE = uid(510);
const EXTRA_FRIES = uid(520);

const RECIPES: RecipeLine[] = [
  { ownerType: 'product', ownerId: LOMO, ingredientId: BEEF, quantity: 500 },
  { ownerType: 'product', ownerId: LOMO, ingredientId: POTATO, quantity: 250 },
  { ownerType: 'variant', ownerId: LARGE, ingredientId: BEEF, quantity: 700 },
  { ownerType: 'variant', ownerId: LARGE, ingredientId: POTATO, quantity: 300 },
  { ownerType: 'modifier', ownerId: EXTRA_FRIES, ingredientId: POTATO, quantity: 250 },
  { ownerType: 'modifier', ownerId: EXTRA_FRIES, ingredientId: OIL, quantity: 20 },
];
const BOOK = recipeBook(RECIPES);

const usageOf = (rows: ReturnType<typeof stockUsage>) =>
  Object.fromEntries(
    rows.map((r) => [
      `${r.ingredientId === BEEF ? 'beef' : r.ingredientId === POTATO ? 'potato' : 'oil'}`,
      [r.kind, r.quantity],
    ]),
  );

describe('units (DEC-051)', () => {
  it('turns what a person types into whole base units', () => {
    expect(toBaseQuantity('19,5', 'kg', 'g')).toBe(19_500);
    expect(toBaseQuantity('0.25', 'l', 'ml')).toBe(250);
    expect(toBaseQuantity('500', 'g', 'g')).toBe(500);
    expect(toBaseQuantity(12, 'unit', 'unit')).toBe(12);
    expect(toBaseQuantity('1,0004', 'kg', 'g')).toBe(1000);
  });

  it('refuses text and units of another kind', () => {
    expect(toBaseQuantity('abc', 'kg', 'g')).toBeNull();
    expect(toBaseQuantity('2', 'l', 'g')).toBeNull();
    expect(toBaseQuantity('', 'g', 'g')).toBeNull();
  });

  it('shows kilos and litres from 1000 up', () => {
    expect(fromBaseQuantity(19_500, 'g')).toEqual({ value: 19.5, unit: 'kg' });
    expect(fromBaseQuantity(999, 'g')).toEqual({ value: 999, unit: 'g' });
    expect(formatQuantity(19_500, 'g', 'es-CO')).toBe('19,5 kg');
    expect(formatQuantity(750, 'ml', 'de-CH')).toBe('750 ml');
    expect(formatQuantity(-2_000, 'ml', 'en')).toBe('-2 l');
    expect(formatQuantity(12, 'unit', 'de-CH')).toBe('12');
  });
});

describe('recipes (DEC-051)', () => {
  it('a product uses its recipe', () => {
    const usage = resolveRecipe({ productId: LOMO, variantId: null, modifiers: [] }, BOOK);
    expect(Object.fromEntries(usage)).toEqual({ [BEEF]: 500, [POTATO]: 250 });
  });

  it('a variant with its own recipe replaces the product, one without falls back to it', () => {
    const large = resolveRecipe({ productId: LOMO, variantId: LARGE, modifiers: [] }, BOOK);
    expect(Object.fromEntries(large)).toEqual({ [BEEF]: 700, [POTATO]: 300 });
    const other = resolveRecipe({ productId: LOMO, variantId: uid(511), modifiers: [] }, BOOK);
    expect(Object.fromEntries(other)).toEqual({ [BEEF]: 500, [POTATO]: 250 });
  });

  it('modifier options add theirs, times how many were chosen', () => {
    const usage = resolveRecipe(
      { productId: LOMO, variantId: null, modifiers: [{ modifierId: EXTRA_FRIES, quantity: 2 }] },
      BOOK,
    );
    expect(Object.fromEntries(usage)).toEqual({ [BEEF]: 500, [POTATO]: 750, [OIL]: 40 });
  });

  it('a product without recipe uses nothing', () => {
    expect(resolveRecipe({ productId: uid(599), variantId: null, modifiers: [] }, BOOK).size).toBe(
      0,
    );
  });
});

describe('consumption of what is sold (DEC-051)', () => {
  const run = (
    build: (d: Device, orderId: string, itemId: string) => unknown[],
    qty = 2,
    stationIds: string[] = [],
  ) => {
    const d = new Device(TERMINAL.H1, USER.manager);
    const open = d.open();
    const item = line({ quantity: qty, stationIds });
    const ops = [
      open,
      d.add(open.orderId, item),
      ...(build(d, open.orderId, item.itemId) as never[]),
    ];
    const state = foldOperations(ops, CONTEXT);
    return { state, itemId: item.itemId, items: [...state.items.values()] };
  };

  it('takes nothing while the item is pending', () => {
    const { items } = run(() => []);
    expect(stockUsage(items, BOOK)).toEqual([]);
  });

  it('takes the recipe × quantity once the item is sent to the kitchen', () => {
    const { items } = run((d, orderId, itemId) => [d.send(orderId, itemId)]);
    expect(usageOf(stockUsage(items, BOOK))).toEqual({
      beef: ['sale', 1000],
      potato: ['sale', 500],
    });
  });

  it('also when served straight at the bar without being sent', () => {
    const { items } = run((d, orderId, itemId) => [d.serve(orderId, itemId)]);
    expect(stockUsage(items, BOOK).map((r) => r.kind)).toEqual(['sale', 'sale']);
  });

  it('gives it back when voided before anyone started on it', () => {
    const { items } = run((d, orderId, itemId) => [
      d.send(orderId, itemId),
      d.op('item.void', orderId, {
        itemId,
        quantity: 2,
        voidedItemId: freshId(),
        reason: 'guest_changed_mind',
        reasonText: null,
      }),
    ]);
    const rows = stockUsage(items, BOOK);
    expect(rows.map((r) => r.kind)).toEqual(['returned', 'returned']);
    expect(rows.some((r) => takesStock(r.kind))).toBe(false);
  });

  it('counts it as waste when voided in preparation', () => {
    const { items } = run(
      (d, orderId, itemId) => [
        d.sendTo(orderId, [STATION.kitchen], itemId),
        d.kitchen('kitchen.start', orderId, STATION.kitchen, itemId),
        d.op('item.void', orderId, {
          itemId,
          quantity: 2,
          voidedItemId: freshId(),
          reason: 'guest_changed_mind',
          reasonText: null,
        }),
      ],
      2,
      [STATION.kitchen],
    );
    expect(stockUsage(items, BOOK).map((r) => r.kind)).toEqual(['waste', 'waste']);
  });

  it('counts it as waste when voided for a kitchen error, even without a KDS', () => {
    const { items } = run((d, orderId, itemId) => [
      d.send(orderId, itemId),
      d.op('item.void', orderId, {
        itemId,
        quantity: 2,
        voidedItemId: freshId(),
        reason: 'quality',
        reasonText: null,
      }),
    ]);
    expect(stockUsage(items, BOOK).map((r) => r.kind)).toEqual(['waste', 'waste']);
  });

  it('splits a partial void: the rest is sold, the voided part on its own line', () => {
    const voidedItemId = freshId();
    const { items, itemId } = run(
      (d, orderId, id) => [
        d.send(orderId, id),
        d.op('item.void', orderId, {
          itemId: id,
          quantity: 1,
          voidedItemId,
          reason: 'kitchen_error',
          reasonText: null,
        }),
      ],
      3,
    );
    const rows = stockUsage(items, BOOK).filter((r) => r.ingredientId === BEEF);
    expect(rows).toEqual([
      { orderItemId: itemId, ingredientId: BEEF, kind: 'sale', perUnit: 500, quantity: 1000 },
      { orderItemId: voidedItemId, ingredientId: BEEF, kind: 'waste', perUnit: 500, quantity: 500 },
    ]);
  });

  it('keeps the recipe of the first sync: a later recipe change does not rewrite sales', () => {
    const { items, itemId } = run((d, orderId, id) => [d.send(orderId, id)]);
    const frozen = new Map([[usageKey(itemId, BEEF), 400]]);
    expect(stockUsage(items, BOOK, frozen)).toEqual([
      { orderItemId: itemId, ingredientId: BEEF, kind: 'sale', perUnit: 400, quantity: 800 },
    ]);
  });

  it('a late void that sorts before the send turns written rows into returned ones', () => {
    const { items, itemId } = run((d, orderId, id) => [
      d.op('item.void', orderId, {
        itemId: id,
        quantity: 2,
        voidedItemId: freshId(),
        reason: 'entry_error',
        reasonText: null,
      }),
      d.send(orderId, id),
    ]);
    expect(consumptionKind(items[0]!)).toBeNull();
    const frozen = new Map([[usageKey(itemId, BEEF), 500]]);
    expect(stockUsage(items, BOOK, frozen)).toEqual([
      { orderItemId: itemId, ingredientId: BEEF, kind: 'returned', perUnit: 500, quantity: 1000 },
    ]);
  });
});

describe('stock movements (DEC-051)', () => {
  it('a purchase adds, waste takes, an adjustment is signed', () => {
    expect(movementDelta('purchase', 25_000, 3_000)).toBe(25_000);
    expect(movementDelta('waste', 1_000, 3_000)).toBe(-1_000);
    expect(movementDelta('adjustment', -250, 3_000)).toBe(-250);
  });

  it('a count moves the difference to what there is', () => {
    expect(movementDelta('count', 18_000, 19_500)).toBe(-1_500);
    expect(movementDelta('count', 20_000, 19_500)).toBe(500);
    expect(movementDelta('count', 0, -300)).toBe(300);
  });

  it('warns at or under the chosen level, never without one', () => {
    expect(isLowStock(20_000, 20_000)).toBe(true);
    expect(isLowStock(19_500, 20_000)).toBe(true);
    expect(isLowStock(20_001, 20_000)).toBe(false);
    expect(isLowStock(-5, null)).toBe(false);
  });
});

describe('inventory commands (DEC-051)', () => {
  it('validates movements by kind', () => {
    expect(recordMovementSchema.parse({ kind: 'purchase', quantity: 25_000 })).toEqual({
      kind: 'purchase',
      quantity: 25_000,
      note: null,
    });
    expect(recordMovementSchema.safeParse({ kind: 'purchase', quantity: 0 }).success).toBe(false);
    expect(recordMovementSchema.safeParse({ kind: 'waste', quantity: -5 }).success).toBe(false);
    expect(recordMovementSchema.safeParse({ kind: 'adjustment', quantity: -5 }).success).toBe(true);
    expect(recordMovementSchema.safeParse({ kind: 'adjustment', quantity: 0 }).success).toBe(false);
    expect(recordMovementSchema.safeParse({ kind: 'count', quantity: 0 }).success).toBe(true);
    expect(recordMovementSchema.safeParse({ kind: 'count', quantity: 1.5 }).success).toBe(false);
  });

  it('a recipe lists each raw material once, with a positive amount', () => {
    const ok = { lines: [{ ingredientId: BEEF, quantity: 500 }] };
    expect(replaceRecipeSchema.safeParse(ok).success).toBe(true);
    const twice = { lines: [ok.lines[0], ok.lines[0]] };
    expect(replaceRecipeSchema.safeParse(twice).success).toBe(false);
    const zero = { lines: [{ ingredientId: BEEF, quantity: 0 }] };
    expect(replaceRecipeSchema.safeParse(zero).success).toBe(false);
  });

  it('a PATCH never resets omitted fields nor changes the unit', () => {
    expect(updateIngredientSchema.parse({ name: 'Rind' })).toEqual({ name: 'Rind' });
    expect(updateIngredientSchema.parse({ unit: 'ml' })).toEqual({});
  });
});
