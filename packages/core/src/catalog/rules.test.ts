import { describe, expect, it } from 'vitest';
import { rappen } from '../shared/money';
import {
  type AvailabilityRuleRecord,
  checkOrderable,
  checkPublishable,
  isSoldOut,
  type LocalMoment,
  resolvePrice,
  translate,
  validateModifierSelection,
} from './rules';

const LOC = 'loc-zh';
const OTHER_LOC = 'loc-be';

describe('resolvePrice (RF-B01, RF-B04)', () => {
  const base = {
    basePriceRappen: rappen(2450),
    channelPrices: [],
    channel: 'table' as const,
    locationId: LOC,
  };

  it('uses the catalog price by default and the location price when set', () => {
    expect(resolvePrice(base)).toBe(2450);
    expect(resolvePrice({ ...base, locationPriceRappen: rappen(2600) })).toBe(2600);
  });

  it('uses the variant price for products with variants', () => {
    expect(resolvePrice({ ...base, variant: { id: 'v5dl', priceRappen: rappen(750) } })).toBe(750);
  });

  it('prefers a location-specific channel price over an organization-wide one', () => {
    const channelPrices = [
      {
        channel: 'takeaway' as const,
        locationId: null,
        variantId: null,
        priceRappen: rappen(1950),
      },
      { channel: 'takeaway' as const, locationId: LOC, variantId: null, priceRappen: rappen(1900) },
      {
        channel: 'takeaway' as const,
        locationId: OTHER_LOC,
        variantId: null,
        priceRappen: rappen(1800),
      },
    ];
    expect(resolvePrice({ ...base, channel: 'takeaway', channelPrices })).toBe(1900);
    expect(resolvePrice({ ...base, channel: 'takeaway', channelPrices, locationId: 'loc-x' })).toBe(
      1950,
    );
    expect(resolvePrice({ ...base, channel: 'table', channelPrices })).toBe(2450);
  });

  it('matches channel prices to the exact variant', () => {
    const channelPrices = [
      {
        channel: 'takeaway' as const,
        locationId: null,
        variantId: 'v5dl',
        priceRappen: rappen(700),
      },
    ];
    const variant3dl = { id: 'v3dl', priceRappen: rappen(550) };
    const variant5dl = { id: 'v5dl', priceRappen: rappen(750) };
    expect(resolvePrice({ ...base, channel: 'takeaway', channelPrices, variant: variant5dl })).toBe(
      700,
    );
    expect(resolvePrice({ ...base, channel: 'takeaway', channelPrices, variant: variant3dl })).toBe(
      550,
    );
  });
});

describe('RN-17 · only orderable when active, not sold out and available', () => {
  const product = { id: 'tagesmenue', categoryId: 'mains', isActive: true };
  // Tuesday 2026-10-06, 12:15 in Zürich.
  const tuesdayLunch: LocalMoment = {
    now: new Date('2026-10-06T10:15:00Z'),
    date: '2026-10-06',
    time: '12:15:00',
    isoWeekday: 2,
  };
  const lunchOnWeekdays: AvailabilityRuleRecord = {
    locationId: LOC,
    productId: 'tagesmenue',
    categoryId: null,
    channel: null,
    daysOfWeek: 0b0011111,
    startTime: '11:30:00',
    endTime: '14:00:00',
    validFrom: null,
    validTo: null,
  };
  const check = (overrides: Partial<Parameters<typeof checkOrderable>[0]> = {}) =>
    checkOrderable({
      product,
      locationSetting: { isActive: true, soldOutAt: null, soldOutUntil: null },
      rules: [lunchOnWeekdays],
      channel: 'table',
      locationId: LOC,
      at: tuesdayLunch,
      ...overrides,
    });

  it('is orderable inside its window', () => {
    expect(check()).toEqual({ orderable: true });
  });

  it('is not orderable outside the time window or on the weekend', () => {
    expect(check({ at: { ...tuesdayLunch, time: '14:00:00' } })).toEqual({
      orderable: false,
      reason: 'not_available_now',
    });
    expect(check({ at: { ...tuesdayLunch, isoWeekday: 6 } })).toMatchObject({
      reason: 'not_available_now',
    });
  });

  it('respects channel restrictions', () => {
    const tableOnly = { ...lunchOnWeekdays, channel: 'table' as const };
    expect(check({ rules: [tableOnly], channel: 'qr' })).toEqual({
      orderable: false,
      reason: 'not_available_on_channel',
    });
    expect(check({ rules: [tableOnly], channel: 'table' })).toEqual({ orderable: true });
  });

  it('applies category rules and ignores rules of other locations', () => {
    const breakfastCategory = {
      ...lunchOnWeekdays,
      productId: null,
      categoryId: 'mains',
      startTime: '07:00',
      endTime: '10:00',
    };
    expect(check({ rules: [breakfastCategory] })).toMatchObject({ reason: 'not_available_now' });
    expect(check({ rules: [{ ...breakfastCategory, locationId: OTHER_LOC }] })).toEqual({
      orderable: true,
    });
  });

  it('supports windows that cross midnight', () => {
    const lateNight = { ...lunchOnWeekdays, daysOfWeek: 127, startTime: '22:00', endTime: '02:00' };
    expect(check({ rules: [lateNight], at: { ...tuesdayLunch, time: '23:30:00' } })).toEqual({
      orderable: true,
    });
    expect(check({ rules: [lateNight], at: { ...tuesdayLunch, time: '01:59:59' } })).toEqual({
      orderable: true,
    });
    expect(check({ rules: [lateNight] })).toMatchObject({ reason: 'not_available_now' });
  });

  it('honours the validity dates of a rule', () => {
    expect(check({ rules: [{ ...lunchOnWeekdays, validTo: '2026-10-05' }] })).toMatchObject({
      reason: 'not_available_now',
    });
  });

  it('blocks inactive and sold-out products (RF-B09)', () => {
    expect(check({ product: { ...product, isActive: false } })).toMatchObject({
      reason: 'inactive',
    });
    expect(
      check({ locationSetting: { isActive: false, soldOutAt: null, soldOutUntil: null } }),
    ).toMatchObject({ reason: 'inactive_at_location' });
    expect(
      check({
        locationSetting: {
          isActive: true,
          soldOutAt: new Date('2026-10-06T09:00:00Z'),
          soldOutUntil: null,
        },
      }),
    ).toMatchObject({ reason: 'sold_out' });
  });

  it('brings a sold-out product back automatically at its return time', () => {
    const setting = {
      soldOutAt: new Date('2026-10-05T19:00:00Z'),
      soldOutUntil: new Date('2026-10-06T04:00:00Z'),
    };
    expect(isSoldOut(setting, new Date('2026-10-06T03:59:59Z'))).toBe(true);
    expect(isSoldOut(setting, new Date('2026-10-06T04:00:00Z'))).toBe(false);
    expect(isSoldOut(null, new Date())).toBe(false);
  });

  it('is always orderable without availability rules', () => {
    expect(check({ rules: [], at: { ...tuesdayLunch, time: '03:00:00', isoWeekday: 7 } })).toEqual({
      orderable: true,
    });
  });
});

describe('RN-18 · no publication without allergens and origin', () => {
  it('blocks products whose allergens are not confirmed', () => {
    expect(
      checkPublishable({ allergensComplete: false, requiresOrigin: false, origins: [] }),
    ).toEqual({
      publishable: false,
      issues: ['allergens_missing'],
    });
  });

  it('blocks meat, poultry and fish without a declared origin', () => {
    expect(
      checkPublishable({ allergensComplete: true, requiresOrigin: true, origins: [] }),
    ).toEqual({
      publishable: false,
      issues: ['origin_missing'],
    });
    expect(
      checkPublishable({
        allergensComplete: true,
        requiresOrigin: true,
        origins: [{ kind: 'meat', country: 'CH' }],
      }),
    ).toEqual({ publishable: true, issues: [] });
  });

  it('ignores malformed origins', () => {
    expect(
      checkPublishable({
        allergensComplete: true,
        requiresOrigin: true,
        origins: [{ kind: 'meat', country: 'Schweiz' }],
      }).issues,
    ).toEqual(['origin_missing']);
  });

  it('publishes a confirmed product with zero allergens', () => {
    expect(
      checkPublishable({ allergensComplete: true, requiresOrigin: false, origins: [] }).publishable,
    ).toBe(true);
  });
});

describe('validateModifierSelection (RF-B02)', () => {
  const groups = [
    { id: 'doneness', minSelect: 1, maxSelect: 1, modifierIds: ['rare', 'medium', 'well'] },
    { id: 'extras', minSelect: 0, maxSelect: 2, modifierIds: ['cheese', 'no-onion', 'sauce'] },
  ];

  it('accepts a valid selection', () => {
    expect(
      validateModifierSelection(groups, [{ modifierId: 'medium' }, { modifierId: 'cheese' }]),
    ).toEqual([]);
  });

  it('requires mandatory groups and enforces the maximum', () => {
    expect(validateModifierSelection(groups, [])).toEqual([
      { code: 'below_min', groupId: 'doneness', min: 1, selected: 0 },
    ]);
    expect(
      validateModifierSelection(groups, [
        { modifierId: 'rare' },
        { modifierId: 'cheese', quantity: 2 },
        { modifierId: 'sauce' },
      ]),
    ).toEqual([{ code: 'above_max', groupId: 'extras', max: 2, selected: 3 }]);
  });

  it('rejects modifiers that do not belong to the product', () => {
    expect(
      validateModifierSelection(groups, [{ modifierId: 'medium' }, { modifierId: 'oat-milk' }]),
    ).toEqual([{ code: 'unknown_modifier', modifierId: 'oat-milk' }]);
  });
});

describe('translate (RF-B07)', () => {
  it('falls back to the location language, then to the catalog text', () => {
    const texts = { de: 'Tagesmenü', fr: 'Menu du jour', it: '' };
    expect(translate(texts, 'Tagesmenü', 'fr', 'de')).toBe('Menu du jour');
    expect(translate(texts, 'Tagesmenü', 'it', 'de')).toBe('Tagesmenü');
    expect(translate({ fr: 'Menu du jour' }, 'Tagesmenü (catalog)', 'en', 'de')).toBe(
      'Tagesmenü (catalog)',
    );
  });
});
