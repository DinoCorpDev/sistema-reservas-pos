import { newId } from '@pos/core';
import { schema as s } from '@pos/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOtherOrganization,
  createTestApi,
  type DemoContext,
  demoSession,
  loadDemo,
  pairTerminal,
  TestDevice,
  testLine,
} from '../testing';

/**
 * Inventory by recipe (DEC-051): raw materials, recipes, movements by hand and what sales take,
 * projected on sync from the orders' operations.
 */

const api = createTestApi();
let demo: DemoContext;
let admin: Record<string, string>;
let manager: Record<string, string>;
let waiter: Record<string, string>;
let other: Awaited<ReturnType<typeof createOtherOrganization>>;
let otherAdmin: Record<string, string>;
let pos: TestDevice;
let kitchenStation: string;
let product: { id: string; variantId: string | null };

type Json = Record<string, unknown>;
interface Ingredient {
  id: string;
  name: string;
  unit: string;
  lowStockThreshold: number | null;
  isActive: boolean;
  onHand: number | null;
  isLow: boolean;
}

const call = async <T = Json>(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) => {
  const response = await api.request(method, path, { headers, body });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
};

const createIngredient = async (name: string, threshold: number | null = null) => {
  const res = await call<Ingredient>('POST', '/inventory/ingredients', admin, {
    name,
    unit: 'g',
    lowStockThreshold: threshold,
  });
  expect(res.status).toBe(201);
  return res.body;
};

const onHand = async (id: string) =>
  (await call<{ ingredient: Ingredient }>('GET', `/inventory/ingredients/${id}/movements`, admin))
    .body.ingredient.onHand;

const push = async (operations: unknown[]) => {
  const response = await api.request('POST', '/sync/push', {
    headers: pos.headers,
    body: { operations },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { results: { status: string }[] };
};

const voidItem = (orderId: string, itemId: string, quantity: number, reason: string) =>
  pos.op('item.void', orderId, {
    itemId,
    quantity,
    voidedItemId: newId(),
    reason,
    reasonText: null,
  });

beforeAll(async () => {
  demo = await loadDemo(api.db);
  admin = api.as(demoSession(demo, 'admin'));
  manager = api.as(demoSession(demo, 'manager'));
  waiter = api.as(demoSession(demo, 'waiter'));
  other = await createOtherOrganization(api.db, 'Inventory Other');
  otherAdmin = api.as(other.session);
  const [row] = await api.db
    .select({ id: s.products.id })
    .from(s.products)
    .where(eq(s.products.organizationId, demo.organizationId))
    .limit(1);
  product = { id: row!.id, variantId: null };
  const [station] = await api.db
    .select()
    .from(s.kitchenStations)
    .where(
      and(eq(s.kitchenStations.locationId, demo.locationId), eq(s.kitchenStations.name, 'Küche')),
    );
  kitchenStation = station!.id;
  pos = new TestDevice(
    { organizationId: demo.organizationId, locationId: demo.locationId },
    await pairTerminal(api, admin, { prefix: 'IV1' }),
    demo.users.manager.id,
  );
});

afterAll(async () => {
  await api.close();
});

describe('raw materials and movements (DEC-051)', () => {
  it('creates, buys, counts and warns at the chosen level', async () => {
    const beef = await createIngredient('Rindfleisch', 20_000);
    expect(beef).toMatchObject({ unit: 'g', onHand: 0, isLow: true });

    const bought = await call<Ingredient>(
      'POST',
      `/inventory/ingredients/${beef.id}/movements`,
      manager,
      { kind: 'purchase', quantity: 25_000, note: 'Metzgerei' },
    );
    expect(bought.status).toBe(201);
    expect(bought.body).toMatchObject({ onHand: 25_000, isLow: false });

    const waste = await call<Ingredient>(
      'POST',
      `/inventory/ingredients/${beef.id}/movements`,
      admin,
      { kind: 'waste', quantity: 1_000 },
    );
    expect(waste.body.onHand).toBe(24_000);

    // A count stores the difference to what there is.
    const counted = await call<Ingredient>(
      'POST',
      `/inventory/ingredients/${beef.id}/movements`,
      admin,
      { kind: 'count', quantity: 19_500 },
    );
    expect(counted.body).toMatchObject({ onHand: 19_500, isLow: true });
    const [last] = await api.db
      .select()
      .from(s.stockMovements)
      .where(and(eq(s.stockMovements.ingredientId, beef.id), eq(s.stockMovements.kind, 'count')));
    expect(last).toMatchObject({ quantity: -4_500, countedQuantity: 19_500 });

    const list = await call<Ingredient[]>('GET', '/inventory/ingredients', admin);
    expect(list.body.findIndex((i) => i.id === beef.id)).toBeLessThan(
      list.body.findIndex((i) => !i.isLow) === -1 ? Infinity : list.body.findIndex((i) => !i.isLow),
    );

    const events = await api.db
      .select()
      .from(s.outboxEvents)
      .where(
        and(
          eq(s.outboxEvents.aggregateId, beef.id),
          eq(s.outboxEvents.type, 'inventory.movement_recorded'),
        ),
      );
    expect(events).toHaveLength(3);
  });

  it('never edits a movement (append-only)', async () => {
    const [row] = await api.db.select().from(s.stockMovements).limit(1);
    await expect(
      api.db.update(s.stockMovements).set({ quantity: 1 }).where(eq(s.stockMovements.id, row!.id)),
    ).rejects.toThrow();
  });

  it('a PATCH changes the level, never the unit; a used raw material cannot be removed', async () => {
    const salt = await createIngredient('Salz');
    const patched = await call<Ingredient>('PATCH', `/inventory/ingredients/${salt.id}`, admin, {
      lowStockThreshold: 500,
      unit: 'ml',
    });
    expect(patched.body).toMatchObject({ unit: 'g', lowStockThreshold: 500 });

    await call('PUT', `/inventory/recipes/product/${product.id}`, admin, {
      lines: [{ ingredientId: salt.id, quantity: 2 }],
    });
    expect((await call('DELETE', `/inventory/ingredients/${salt.id}`, admin)).status).toBe(409);
    await call('PUT', `/inventory/recipes/product/${product.id}`, admin, { lines: [] });
    expect((await call('DELETE', `/inventory/ingredients/${salt.id}`, admin)).status).toBe(204);
  });

  it('keeps inventory away from staff without inventory.manage', async () => {
    expect((await call('GET', '/inventory/ingredients', waiter)).status).toBe(403);
    expect(
      (await call('POST', '/inventory/ingredients', waiter, { name: 'X', unit: 'g' })).status,
    ).toBe(403);
  });
});

describe('RNF-12 · another organization sees nothing of our inventory', () => {
  it('answers 404 for our raw materials and recipes', async () => {
    const ours = await createIngredient('Geheim');
    const theirs = await call<Ingredient[]>('GET', '/inventory/ingredients', otherAdmin);
    expect(theirs.body.some((i) => i.id === ours.id)).toBe(false);
    for (const [method, path, body] of [
      ['PATCH', `/inventory/ingredients/${ours.id}`, { name: 'X' }],
      ['DELETE', `/inventory/ingredients/${ours.id}`, undefined],
      ['GET', `/inventory/ingredients/${ours.id}/movements`, undefined],
      ['POST', `/inventory/ingredients/${ours.id}/movements`, { kind: 'purchase', quantity: 1 }],
      ['PUT', `/inventory/recipes/product/${product.id}`, { lines: [] }],
    ] as const) {
      expect((await call(method, path, otherAdmin, body)).status).toBe(404);
    }
  });
});

describe('what sales take from stock (DEC-051)', () => {
  it('takes the recipe when sent, gives it back when voided before preparing', async () => {
    const meat = await createIngredient('Fleisch für Tests', 20_000);
    const fries = await createIngredient('Pommes für Tests');
    await call('POST', `/inventory/ingredients/${meat.id}/movements`, admin, {
      kind: 'purchase',
      quantity: 25_000,
    });
    const recipe = await call('PUT', `/inventory/recipes/product/${product.id}`, admin, {
      lines: [
        { ingredientId: meat.id, quantity: 500 },
        { ingredientId: fries.id, quantity: 250 },
      ],
    });
    expect(recipe.status).toBe(200);

    const open = pos.open(newId(), 41);
    const dish = testLine({ productId: product.id, quantity: 11 });
    const add = pos.op('items.add', open.orderId, { items: [dish] });
    const send = pos.send(open.orderId, [dish.itemId]);
    expect((await push([open, add, send])).results.map((r) => r.status)).toEqual([
      'applied',
      'applied',
      'applied',
    ]);
    expect(await onHand(meat.id)).toBe(25_000 - 5_500);
    expect(await onHand(fries.id)).toBe(-2_750);
    const low = await call<Ingredient[]>('GET', '/inventory/ingredients', admin);
    expect(low.body.find((i) => i.id === meat.id)).toMatchObject({ isLow: true });

    // The same push again changes nothing.
    await push([open, add, send]);
    expect(await onHand(meat.id)).toBe(19_500);

    // One voided before anyone started: back in stock.
    await push([voidItem(open.orderId, dish.itemId, 1, 'guest_changed_mind')]);
    expect(await onHand(meat.id)).toBe(20_000);

    // A recipe change does not rewrite what was sold.
    await call('PUT', `/inventory/recipes/product/${product.id}`, admin, {
      lines: [{ ingredientId: meat.id, quantity: 900 }],
    });
    await push([voidItem(open.orderId, dish.itemId, 1, 'entry_error')]);
    expect(await onHand(meat.id)).toBe(20_500);
    await call('PUT', `/inventory/recipes/product/${product.id}`, admin, { lines: [] });
  });

  it('counts a dish voided in preparation as waste', async () => {
    const fish = await createIngredient('Fisch für Tests');
    await call('PUT', `/inventory/recipes/product/${product.id}`, admin, {
      lines: [{ ingredientId: fish.id, quantity: 200 }],
    });
    const open = pos.open(newId(), 42);
    const dish = testLine({ productId: product.id, quantity: 2, stationIds: [kitchenStation] });
    const add = pos.op('items.add', open.orderId, { items: [dish] });
    const send = pos.send(open.orderId, [dish.itemId], [kitchenStation]);
    const start = pos.kitchen('kitchen.start', open.orderId, kitchenStation, [dish.itemId]);
    await push([open, add, send, start]);
    await push([voidItem(open.orderId, dish.itemId, 2, 'guest_changed_mind')]);
    expect(await onHand(fish.id)).toBe(-400);

    const rows = await api.db
      .select()
      .from(s.stockConsumptions)
      .where(eq(s.stockConsumptions.ingredientId, fish.id));
    expect(rows.map((r) => [r.kind, r.quantity])).toEqual([['waste', 400]]);
    const history = await call<{ days: { sold: number; wasted: number }[] }>(
      'GET',
      `/inventory/ingredients/${fish.id}/movements`,
      admin,
    );
    expect(history.body.days).toMatchObject([{ sold: 0, wasted: 400 }]);
    await call('PUT', `/inventory/recipes/product/${product.id}`, admin, { lines: [] });
  });
});
