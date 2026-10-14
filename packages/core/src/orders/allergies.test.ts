import { describe, expect, it } from 'vitest';
import { allergenClashes, mergeAllergies, normalizeAllergies } from './allergies';
import { orderNumber } from './numbering';
import { operationSchema } from './operations';
import { foldOperations } from './reducer';
import { BUSINESS_DATE, CONTEXT, Device, freshId, line, TERMINAL, USER } from './test-kit';

describe('allergies at the table (DEC-037)', () => {
  it('keeps the allergens in the canonical order, without duplicates; nothing becomes null', () => {
    expect(normalizeAllergies({ allergens: ['milk', 'gluten', 'milk'], note: '  Kiwi ' })).toEqual({
      allergens: ['gluten', 'milk'],
      note: 'Kiwi',
    });
    expect(normalizeAllergies({ allergens: [], note: '   ' })).toBeNull();
    expect(normalizeAllergies(null)).toBeNull();
  });

  it('a merge keeps every warning of both orders', () => {
    expect(
      mergeAllergies(
        { allergens: ['tree_nuts'], note: 'Kiwi' },
        { allergens: ['gluten', 'tree_nuts'], note: 'Erdbeeren' },
      ),
    ).toEqual({ allergens: ['gluten', 'tree_nuts'], note: 'Kiwi · Erdbeeren' });
    expect(mergeAllergies(null, { allergens: ['fish'], note: null })).toEqual({
      allergens: ['fish'],
      note: null,
    });
    expect(mergeAllergies(null, null)).toBeNull();
  });

  it('finds the flagged allergens a product contains or may contain', () => {
    const allergies = normalizeAllergies({ allergens: ['gluten', 'celery'], note: 'Kiwi' });
    expect(allergenClashes(allergies, [{ allergen: 'milk' }, { allergen: 'celery' }])).toEqual([
      'celery',
    ]);
    expect(allergenClashes(null, [{ allergen: 'gluten' }])).toEqual([]);
  });

  it('accepts only the 14 allergens, once each, and a short free text', () => {
    const parse = (allergies: unknown) =>
      operationSchema.safeParse({
        ...new Device(TERMINAL.H1).op('order.update', freshId(), { guestCount: 2 }),
        payload: { allergies },
      }).success;
    expect(parse({ allergens: ['gluten', 'sesame'], note: 'Kiwi' })).toBe(true);
    expect(parse(null)).toBe(true);
    expect(parse({ allergens: ['kiwi'], note: null })).toBe(false);
    expect(parse({ allergens: ['gluten', 'gluten'], note: null })).toBe(false);
    expect(parse({ allergens: [], note: 'x'.repeat(201) })).toBe(false);
  });

  it('is set, changed and cleared on the order; the last change wins (RNF-04)', () => {
    const h1 = new Device(TERMINAL.H1, USER.waiter);
    const h2 = new Device(TERMINAL.H2, USER.waiter2);
    const open = h1.open();
    h2.sees(open);
    const first = h1.op('order.update', open.orderId, {
      allergies: { allergens: ['tree_nuts', 'gluten'], note: 'Kiwi' },
    });
    const later = h2.wait(5_000).op('order.update', open.orderId, {
      allergies: { allergens: ['gluten'], note: null },
    });
    for (const ops of [
      [open, first, later],
      [later, first, open],
    ]) {
      expect(foldOperations(ops, CONTEXT).orders.get(open.orderId)!.allergies).toEqual({
        allergens: ['gluten'],
        note: null,
      });
    }
    const cleared = h2.wait(5_000).op('order.update', open.orderId, { allergies: null });
    expect(
      foldOperations([open, first, later, cleared], CONTEXT).orders.get(open.orderId)!.allergies,
    ).toBeNull();
  });

  it('goes with a split part and adds up in a merge, so no warning gets lost', () => {
    const d = new Device(TERMINAL.H1, USER.waiter);
    const a = d.open();
    const b = d.open();
    const soup = line();
    const pasta = line();
    const ops = [
      a,
      b,
      d.add(a.orderId, soup, pasta),
      d.op('order.update', a.orderId, { allergies: { allergens: ['gluten'], note: 'Kiwi' } }),
      d.op('order.update', b.orderId, { allergies: { allergens: ['fish'], note: null } }),
    ];
    const child = freshId();
    const split = d.op('order.split', a.orderId, {
      newOrderId: child,
      itemIds: [pasta.itemId],
      number: orderNumber(BUSINESS_DATE, 7),
    });
    let state = foldOperations([...ops, split], CONTEXT);
    expect(state.orders.get(child)!.allergies).toEqual({ allergens: ['gluten'], note: 'Kiwi' });

    const merge = d.op('order.merge', a.orderId, { intoOrderId: b.orderId });
    state = foldOperations([...ops, split, merge], CONTEXT);
    expect(state.orders.get(b.orderId)!.allergies).toEqual({
      allergens: ['gluten', 'fish'],
      note: 'Kiwi',
    });
  });
});
