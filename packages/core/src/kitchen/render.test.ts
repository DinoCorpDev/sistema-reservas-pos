import { describe, expect, it } from 'vitest';
import type { CatalogSnapshot } from '../catalog/menu';
import type { Operation } from '../orders/operations';
import { foldOperations } from '../orders/reducer';
import { ticketKey } from '../orders/state';
import { CONTEXT, Device, freshId, line, STATION, TERMINAL, uid, USER } from '../orders/test-kit';
import { columnsAt, columnsFor, type PrintDocument } from '../printing/document';
import { ticketView } from './board';
import { kitchenCatalog } from './catalog';
import { KITCHEN_LABELS } from './labels';
import { renderAllergyNotice, renderKitchenTicket, renderTestPage } from './render';

const PRODUCT = uid(500);
const MODIFIER = uid(600);
const VARIANT = uid(700);

/** A small catalog: Rösti with egg on top, translated to French. */
const SNAPSHOT: Pick<
  CatalogSnapshot,
  | 'translations'
  | 'locationLanguage'
  | 'catalogLanguage'
  | 'products'
  | 'variants'
  | 'modifiers'
  | 'allergens'
  | 'modifierAllergens'
> = {
  locationLanguage: 'de',
  catalogLanguage: 'de',
  products: [{ id: PRODUCT, name: 'Berner Rösti' } as CatalogSnapshot['products'][number]],
  variants: [
    { id: VARIANT, productId: PRODUCT, name: 'Gross', priceRappen: 2850, isDefault: false },
  ],
  modifiers: [
    { id: MODIFIER, modifierGroupId: uid(601), name: 'Spiegelei', priceDeltaRappen: 250 },
  ],
  allergens: [
    { productId: PRODUCT, allergen: 'milk', presence: 'contains' },
    { productId: PRODUCT, allergen: 'gluten', presence: 'may_contain' },
  ],
  modifierAllergens: [
    { modifierId: MODIFIER, allergen: 'eggs', presence: 'contains' },
    { modifierId: MODIFIER, allergen: 'gluten', presence: 'contains' },
  ],
  translations: {
    [PRODUCT]: { fr: { name: 'Rösti bernois' } },
    [MODIFIER]: { fr: { name: 'Œuf au plat' } },
  },
};

function ticket(
  options: {
    quantity?: number;
    voidOne?: boolean;
    allergies?: { allergens: ('gluten' | 'tree_nuts' | 'fish')[]; note: string | null };
  } = {},
) {
  const waiter = new Device(TERMINAL.H1, USER.waiter);
  const open = waiter.open(freshId(), {}, 42);
  const rosti = line({
    productId: PRODUCT,
    variantId: VARIANT,
    variantName: 'Gross',
    quantity: options.quantity ?? 2,
    modifiers: [
      {
        id: freshId(),
        modifierId: MODIFIER,
        name: 'Spiegelei',
        priceDeltaRappen: 250,
        quantity: 1,
      },
    ],
    note: 'Ohne Zwiebeln, bitte sehr knusprig und mit extra viel Butter',
    seat: 3,
    stationIds: [STATION.kitchen],
  });
  const drink = line({
    productId: uid(501),
    name: 'Apfelschorle',
    course: 0,
    stationIds: [STATION.kitchen],
  });
  const ops: Operation[] = [open, waiter.add(open.orderId, rosti, drink)];
  const send = waiter.sendTo(open.orderId, [STATION.kitchen], rosti.itemId, drink.itemId);
  ops.push(send);
  const voidedItemId = freshId();
  if (options.voidOne) {
    ops.push(
      waiter.op(
        'item.void',
        open.orderId,
        {
          itemId: rosti.itemId,
          quantity: 1,
          voidedItemId,
          reason: 'guest_changed_mind',
          reasonText: null,
        },
        {
          approval: {
            approverUserId: USER.manager,
            permissions: ['order.void_item', 'approval.grant'],
          },
        },
      ),
    );
  }
  // Noted after the items were sent: the ticket reads it live (DEC-037).
  if (options.allergies) {
    ops.push(waiter.op('order.update', open.orderId, { allergies: options.allergies }));
  }
  const state = foldOperations(ops, CONTEXT);
  return {
    state,
    orderId: open.orderId,
    voidedItemId,
    key: ticketKey(send.id, STATION.kitchen),
    at: ops[ops.length - 1]!.deviceAt,
  };
}

const text = (doc: PrintDocument) => doc.lines.map((l) => l.text);

function fitsPaper(doc: PrintDocument, width: number) {
  for (const l of doc.lines) expect(l.text.length).toBeLessThanOrEqual(columnsAt(width, l.size));
}

describe('allergies at the table on the kitchen tickets (DEC-037)', () => {
  const allergies = {
    allergens: ['gluten', 'tree_nuts'] as ('gluten' | 'tree_nuts')[],
    note: 'Kiwi',
  };
  const options = {
    width: 48,
    labels: KITCHEN_LABELS.de,
    timeZone: 'Europe/Zurich',
    stationName: 'Küche',
    tableLabel: '5',
    waiterName: 'Anna Huber',
  };

  it('the ticket reads them live from the order, even when noted after sending', () => {
    const { state, key, at } = ticket({ allergies });
    const view = ticketView(state, state.tickets.get(key)!, { now: at, alertAfterMinutes: 12 });
    expect(view.allergies).toEqual({ allergens: ['gluten', 'tree_nuts'], note: 'Kiwi' });
  });

  it('every printed ticket of the order carries the warning above everything else', () => {
    const { state, key, at } = ticket({ allergies });
    const view = ticketView(state, state.tickets.get(key)!, { now: at, alertAfterMinutes: 12 });
    const doc = renderKitchenTicket(view, { ...options, kind: 'ticket', at });
    expect(text(doc).slice(0, 6)).toEqual([
      'KÜCHE',
      '*'.repeat(48),
      '!!! ALLERGIE AM TISCH !!!',
      'Gluten, Nüsse · Kiwi',
      'Kreuzkontamination vermeiden',
      '*'.repeat(48),
    ]);
    expect(doc.lines[3]).toMatchObject({ bold: true, size: 'tall' });
    fitsPaper(doc, 48);
  });

  it('without allergies the ticket has no warning', () => {
    const { state, key, at } = ticket();
    const view = ticketView(state, state.tickets.get(key)!, { now: at, alertAfterMinutes: 12 });
    expect(text(renderKitchenTicket(view, { ...options, kind: 'ticket', at }))).not.toContain(
      '!!! ALLERGIE AM TISCH !!!',
    );
  });

  it('a notice warns a station that already has the items, in its language and on 58 mm', () => {
    const { state, orderId, at } = ticket({ allergies });
    const order = state.orders.get(orderId)!;
    const doc = renderAllergyNotice(
      { channel: order.channel, displayNumber: order.displayNumber, allergies: order.allergies! },
      { ...options, width: columnsFor(58), labels: KITCHEN_LABELS.fr, stationName: 'Cuisine', at },
    );
    const lines = text(doc);
    expect(lines[0]).toBe('CUISINE');
    expect(lines.join(' ')).toContain('AVIS D’ALLERGIE');
    expect(lines.join(' ')).toContain('Gluten, Fruits à coque · Kiwi');
    expect(lines).toContain('!!! ALLERGIE À LA TABLE !!!');
    expect(doc).toMatchObject({ cut: true, openDrawer: false });
    fitsPaper(doc, 32);
  });
});

describe('kitchen ticket print (RF-C26, RF-C25, RF-C20)', () => {
  it('prints station, table, course, items, modifiers, note, seat and allergens in the kitchen language', () => {
    const { state, key, at } = ticket();
    const view = ticketView(state, state.tickets.get(key)!, {
      now: at,
      alertAfterMinutes: 12,
      catalog: kitchenCatalog(SNAPSHOT, 'fr'),
    });
    const doc = renderKitchenTicket(view, {
      kind: 'ticket',
      width: 48,
      labels: KITCHEN_LABELS.fr,
      timeZone: 'Europe/Zurich',
      stationName: 'Cuisine',
      tableLabel: '5',
      waiterName: 'Anna Huber',
      at,
    });
    expect(text(doc)).toEqual([
      'CUISINE',
      'Table 5',
      'Commande 0042 · 20:00 · Serveur: Anna Huber',
      '-'.repeat(48),
      'BOISSONS',
      '1x Apfelschorle',
      '-'.repeat(48),
      'SERVICE 1',
      '2x Rösti bernois (Gross)',
      '   + Œuf au plat',
      '   > Note: Ohne Zwiebeln, bitte sehr knusprig',
      '   und mit extra viel Butter',
      '   Place 3',
      // The legal order of the 14 allergens (RF-B05).
      '   ! Allergènes: Gluten, Œufs, Lait',
      '-'.repeat(48),
    ]);
    expect(doc.lines[1]).toMatchObject({ size: 'large', bold: true });
    expect(doc).toMatchObject({ cut: true, openDrawer: false });
    fitsPaper(doc, 48);
  });

  it('fits 58 mm paper (32 columns) and the large lines (16 columns)', () => {
    const { state, key, at } = ticket();
    const view = ticketView(state, state.tickets.get(key)!, { now: at, alertAfterMinutes: 12 });
    const doc = renderKitchenTicket(view, {
      kind: 'ticket',
      width: columnsFor(58),
      labels: KITCHEN_LABELS.de,
      timeZone: 'Europe/Zurich',
      stationName: 'Küche',
      tableLabel: 'Terrasse 12 beim Brunnen',
      waiterName: null,
      at,
    });
    fitsPaper(doc, 32);
    expect(text(doc).slice(1, 3)).toEqual(['Tisch Terrasse', '12 beim Brunnen']);
  });

  it('a storno slip lists only the voided part, with its time (RN-13)', () => {
    const { state, key, at, voidedItemId } = ticket({ quantity: 3, voidOne: true });
    const view = ticketView(state, state.tickets.get(key)!, { now: at, alertAfterMinutes: 12 });
    const doc = renderKitchenTicket(view, {
      kind: 'storno',
      width: 48,
      labels: KITCHEN_LABELS.de,
      timeZone: 'Europe/Zurich',
      stationName: 'Küche',
      tableLabel: '5',
      waiterName: null,
      itemIds: [voidedItemId],
      at,
    });
    const lines = text(doc);
    expect(lines[1]).toBe('*** STORNO 20:00 ***');
    expect(lines.filter((l) => /^\dx /.test(l))).toEqual(['1x Berner Rösti (Gross)']);
    fitsPaper(doc, 48);
  });

  it('a normal ticket leaves voided items out; a reprint says so', () => {
    const { state, key, at } = ticket({ quantity: 3, voidOne: true });
    const view = ticketView(state, state.tickets.get(key)!, { now: at, alertAfterMinutes: 12 });
    const doc = renderKitchenTicket(view, {
      kind: 'reprint',
      width: 48,
      labels: KITCHEN_LABELS.it,
      timeZone: 'Europe/Zurich',
      stationName: 'Cucina',
      tableLabel: '5',
      waiterName: null,
      at,
    });
    const lines = text(doc);
    expect(lines[1]).toBe('*** RISTAMPA 20:00 ***');
    expect(lines.filter((l) => /^\dx /.test(l))).toEqual([
      '1x Apfelschorle',
      '2x Berner Rösti (Gross)',
    ]);
  });

  it('a counter order shows its channel and number instead of a table', () => {
    const counter = new Device(TERMINAL.K1, USER.cashier);
    const open = counter.open(
      freshId(),
      { channel: 'takeaway', consumptionType: 'takeaway', tableId: null },
      7,
    );
    const item = line({ stationIds: [STATION.kitchen] });
    const add = counter.add(open.orderId, item);
    const send = counter.sendTo(open.orderId, [STATION.kitchen], item.itemId);
    const state = foldOperations([open, add, send], CONTEXT);
    const view = ticketView(state, state.tickets.get(ticketKey(send.id, STATION.kitchen))!, {
      now: send.deviceAt,
      alertAfterMinutes: 12,
    });
    const doc = renderKitchenTicket(view, {
      kind: 'ticket',
      width: 48,
      labels: KITCHEN_LABELS.de,
      timeZone: 'Europe/Zurich',
      stationName: 'Küche',
      tableLabel: null,
      waiterName: 'Lea',
      at: send.deviceAt,
    });
    expect(text(doc).slice(1, 3)).toEqual(['Mitnehmen 0007', '20:00 · Service: Lea']);
  });

  it('prints a test page with the special characters of the four languages (RF-F17)', () => {
    const doc = renderTestPage({
      width: 48,
      labels: KITCHEN_LABELS.de,
      printerName: 'Küchendrucker',
      timeZone: 'Europe/Zurich',
      at: '2026-10-07T18:30:00.000Z',
    });
    expect(text(doc)).toContain('TESTDRUCK');
    expect(text(doc)).toContain('2026-10-07 20:30');
    expect(text(doc).join('\n')).toContain('ÄÖÜ äöü éèàç ß €');
    fitsPaper(doc, 48);
  });
});

describe('kitchen catalog (RF-C25, RF-C20)', () => {
  const catalog = kitchenCatalog(SNAPSHOT, 'fr');

  it('names in the kitchen language, else the location language, else the frozen name', () => {
    expect(catalog.productName(PRODUCT, 'x')).toBe('Rösti bernois');
    expect(catalog.modifierName(MODIFIER, 'x')).toBe('Œuf au plat');
    // No French variant name: the catalog text.
    expect(catalog.variantName(VARIANT, 'x')).toBe('Gross');
    expect(catalog.variantName(null, null)).toBeNull();
    // A product the snapshot does not know (removed since): the name frozen in the line.
    expect(catalog.productName(uid(999), 'Alter Name')).toBe('Alter Name');
    expect(kitchenCatalog(SNAPSHOT, 'it').productName(PRODUCT, 'x')).toBe('Berner Rösti');
  });

  it('merges product and modifier allergens in the legal order; "contains" wins', () => {
    expect(catalog.allergens(PRODUCT, [MODIFIER])).toEqual([
      { allergen: 'gluten', presence: 'contains' },
      { allergen: 'eggs', presence: 'contains' },
      { allergen: 'milk', presence: 'contains' },
    ]);
    expect(catalog.allergens(PRODUCT, [])).toEqual([
      { allergen: 'gluten', presence: 'may_contain' },
      { allergen: 'milk', presence: 'contains' },
    ]);
  });
});
