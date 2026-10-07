import { describe, expect, it } from 'vitest';
import { CONSUMPTION_TYPES, type ConsumptionType } from '../shared/channels';
import { type Rappen, rappen } from '../shared/money';
import {
  allocate,
  extractTax,
  priceLine,
  resolveTaxRate,
  splitEvenly,
  summarizeByRate,
  TaxError,
  type TaxRateRecord,
  type TaxRuleRecord,
} from './calculation';
import { TAX_CATEGORY_KEYS, type TaxCategoryKey, type TaxRateCode } from './constants';

// Test fixtures mirror the Swiss template that lives as DATA in the database (RN-02).
const RATES: TaxRateRecord[] = [
  { code: 'normal', rateBp: 770, validFrom: '2018-01-01', validTo: '2023-12-31' },
  { code: 'reduced', rateBp: 250, validFrom: '2018-01-01', validTo: '2023-12-31' },
  { code: 'accommodation', rateBp: 370, validFrom: '2018-01-01', validTo: '2023-12-31' },
  { code: 'normal', rateBp: 810, validFrom: '2024-01-01', validTo: null },
  { code: 'reduced', rateBp: 260, validFrom: '2024-01-01', validTo: null },
  { code: 'accommodation', rateBp: 380, validFrom: '2024-01-01', validTo: null },
];

const MATRIX: Record<TaxCategoryKey, Record<ConsumptionType, TaxRateCode>> = {
  food: { on_premise: 'normal', takeaway: 'reduced', delivery: 'reduced' },
  non_alcoholic_beverage: { on_premise: 'normal', takeaway: 'reduced', delivery: 'reduced' },
  alcoholic_beverage: { on_premise: 'normal', takeaway: 'normal', delivery: 'normal' },
  accommodation: {
    on_premise: 'accommodation',
    takeaway: 'accommodation',
    delivery: 'accommodation',
  },
  other: { on_premise: 'normal', takeaway: 'normal', delivery: 'normal' },
};

const RULES: TaxRuleRecord[] = TAX_CATEGORY_KEYS.flatMap((taxCategoryKey) =>
  CONSUMPTION_TYPES.map((consumptionType) => ({
    taxCategoryKey,
    consumptionType,
    rateCode: MATRIX[taxCategoryKey][consumptionType],
    validFrom: '2018-01-01',
    validTo: null,
  })),
);

const resolve = (
  taxCategoryKey: TaxCategoryKey,
  consumptionType: ConsumptionType,
  saleDate = '2026-10-06',
) => resolveTaxRate({ taxCategoryKey, consumptionType, saleDate, rules: RULES, rates: RATES });

describe('RN-01 · tax is extracted from tax-inclusive prices, never added', () => {
  it.each([
    [10000, 810, 749], // CHF 100.00 incl. 8.1 % → CHF 7.49 MWST
    [10000, 260, 253], // CHF 100.00 incl. 2.6 % → CHF 2.53
    [10000, 380, 366], // CHF 100.00 incl. 3.8 % → CHF 3.66
    [10000, 770, 715], // CHF 100.00 incl. 7.7 % (2018-2023)
    [3850, 810, 288], // Zürcher Geschnetzeltes CHF 38.50
    [550, 810, 41], // Lager 3 dl CHF 5.50
    [550, 260, 14], // takeaway soft drink
    [5, 810, 0],
    [0, 810, 0],
    [1, 10000, 1], // exact half → rounds up
  ])('%i Rp at %i bp contains %i Rp of tax', (gross, rateBp, tax) => {
    expect(extractTax(rappen(gross), rateBp)).toBe(tax);
  });

  it('is symmetric for negative amounts (refunds)', () => {
    expect(extractTax(rappen(-10000), 810)).toBe(-749);
    expect(extractTax(rappen(-1), 10000)).toBe(-1);
  });

  it('never adds tax on top: the gross amount is always net + tax', () => {
    for (const rateBp of [0, 250, 260, 370, 380, 770, 810]) {
      for (let gross = 0; gross <= 25_000; gross += 7) {
        const tax = extractTax(rappen(gross), rateBp);
        // tax ≈ gross × r / (1 + r), within half a rappen.
        const error = Math.abs(tax * (10000 + rateBp) - gross * rateBp);
        expect(error).toBeLessThanOrEqual((10000 + rateBp) / 2);
        expect(tax).toBeLessThanOrEqual(gross);
        expect(Number.isInteger(tax)).toBe(true);
      }
    }
  });

  it('handles large amounts exactly (no float drift)', () => {
    // 2'000'000'000 × 810 / 10'810 = 149'861'239.59… → rounds to …240
    expect(extractTax(rappen(2_000_000_000), 810)).toBe(149_861_240);
  });

  it('rejects invalid rates', () => {
    expect(() => extractTax(rappen(100), -1)).toThrow(TaxError);
    expect(() => extractTax(rappen(100), 8.1)).toThrow(TaxError);
    expect(() => extractTax(rappen(100), 10001)).toThrow(TaxError);
  });
});

describe('RN-02 · rates are dated data, not constants', () => {
  it('applies the rate valid on the sale date', () => {
    expect(resolve('food', 'on_premise', '2023-12-31').rateBp).toBe(770);
    expect(resolve('food', 'on_premise', '2024-01-01').rateBp).toBe(810);
    expect(resolve('food', 'takeaway', '2023-12-31').rateBp).toBe(250);
    expect(resolve('food', 'takeaway', '2024-01-01').rateBp).toBe(260);
    expect(resolve('accommodation', 'on_premise', '2024-01-01').rateBp).toBe(380);
  });

  it('follows a future rate change without code changes', () => {
    const future: TaxRateRecord[] = [
      ...RATES.map((r) => (r.validTo === null ? { ...r, validTo: '2027-12-31' } : r)),
      { code: 'normal', rateBp: 850, validFrom: '2028-01-01', validTo: null },
      { code: 'reduced', rateBp: 270, validFrom: '2028-01-01', validTo: null },
      { code: 'accommodation', rateBp: 400, validFrom: '2028-01-01', validTo: null },
    ];
    const at = (saleDate: string) =>
      resolveTaxRate({
        taxCategoryKey: 'food',
        consumptionType: 'on_premise',
        saleDate,
        rules: RULES,
        rates: future,
      }).rateBp;
    expect(at('2027-12-31')).toBe(810);
    expect(at('2028-01-01')).toBe(850);
  });

  it('fails loudly when the data is missing or overlapping', () => {
    expect(() =>
      resolveTaxRate({
        taxCategoryKey: 'food',
        consumptionType: 'on_premise',
        saleDate: '2017-06-01',
        rules: RULES,
        rates: RATES,
      }),
    ).toThrow(expect.objectContaining({ code: 'NO_RULE' }));
    expect(() =>
      resolveTaxRate({
        taxCategoryKey: 'food',
        consumptionType: 'on_premise',
        saleDate: '2024-05-01',
        rules: RULES,
        rates: RATES.filter((r) => r.code !== 'normal'),
      }),
    ).toThrow(expect.objectContaining({ code: 'NO_RATE' }));
    expect(() =>
      resolveTaxRate({
        taxCategoryKey: 'food',
        consumptionType: 'on_premise',
        saleDate: '2024-05-01',
        rules: [...RULES, { ...RULES[0]!, rateCode: 'reduced' }],
        rates: RATES,
      }),
    ).toThrow(expect.objectContaining({ code: 'AMBIGUOUS_RULE' }));
    expect(() =>
      resolveTaxRate({
        taxCategoryKey: 'food',
        consumptionType: 'on_premise',
        saleDate: '2024-05-01',
        rules: RULES,
        rates: [...RATES, { code: 'normal', rateBp: 900, validFrom: '2024-03-01', validTo: null }],
      }),
    ).toThrow(expect.objectContaining({ code: 'AMBIGUOUS_RATE' }));
    expect(() => resolve('food', 'on_premise', '06.10.2026')).toThrow(TaxError);
  });
});

describe('RN-03 · rate from tax category + channel + consumption type', () => {
  it('uses the normal rate for every category consumed on the premises (except lodging)', () => {
    for (const category of [
      'food',
      'non_alcoholic_beverage',
      'alcoholic_beverage',
      'other',
    ] as const) {
      expect(resolve(category, 'on_premise').rateCode).toBe('normal');
    }
  });

  it('uses the reduced rate for food and soft drinks to take away or delivered', () => {
    for (const consumption of ['takeaway', 'delivery'] as const) {
      expect(resolve('food', consumption).rateBp).toBe(260);
      expect(resolve('non_alcoholic_beverage', consumption).rateBp).toBe(260);
    }
  });

  it('always uses the normal rate for alcoholic drinks', () => {
    for (const consumption of CONSUMPTION_TYPES) {
      expect(resolve('alcoholic_beverage', consumption).rateBp).toBe(810);
    }
  });

  it('uses the accommodation rate for lodging', () => {
    expect(resolve('accommodation', 'on_premise').rateCode).toBe('accommodation');
  });
});

describe('RN-04 · price, rate and tax are frozen on the sold line', () => {
  it('prices a line with modifiers, quantity and discount', () => {
    const line = priceLine({
      unitPriceRappen: rappen(5200),
      modifiersRappen: rappen(300),
      quantity: 2,
      discountRappen: rappen(1000),
      rate: resolve('food', 'on_premise'),
    });
    expect(line).toMatchObject({
      grossBeforeDiscountRappen: 11000,
      lineTotalRappen: 10000,
      taxRateCode: 'normal',
      taxRateBp: 810,
      taxRappen: 749,
      netRappen: 9251,
      taxCategoryKey: 'food',
    });
  });

  it('keeps the old rate in the summary after the rates change', () => {
    const soldIn2023 = priceLine({
      unitPriceRappen: rappen(10000),
      modifiersRappen: rappen(0),
      quantity: 1,
      discountRappen: rappen(0),
      rate: resolve('food', 'on_premise', '2023-11-30'),
    });
    // Later the rate is 8.1 %, but the stored line still reports 7.7 %.
    expect(resolve('food', 'on_premise', '2026-10-06').rateBp).toBe(810);
    expect(summarizeByRate([soldIn2023])).toEqual([
      { rateCode: 'normal', rateBp: 770, grossRappen: 10000, taxRappen: 715, netRappen: 9285 },
    ]);
  });

  it('rejects impossible lines', () => {
    const rate = resolve('food', 'on_premise');
    const base = {
      unitPriceRappen: rappen(1000),
      modifiersRappen: rappen(0),
      quantity: 1,
      discountRappen: rappen(0),
      rate,
    };
    expect(() => priceLine({ ...base, quantity: 0 })).toThrow(TaxError);
    expect(() => priceLine({ ...base, quantity: 1.5 })).toThrow(TaxError);
    expect(() => priceLine({ ...base, discountRappen: rappen(1001) })).toThrow(TaxError);
    expect(() => priceLine({ ...base, discountRappen: rappen(-1) })).toThrow(TaxError);
    expect(() => priceLine({ ...base, unitPriceRappen: rappen(-1) })).toThrow(TaxError);
  });
});

describe('summarizeByRate', () => {
  it('groups lines per rate, highest rate first, and adds the frozen amounts', () => {
    const lines = [
      priceLine({
        unitPriceRappen: rappen(3850),
        modifiersRappen: rappen(0),
        quantity: 1,
        discountRappen: rappen(0),
        rate: resolve('food', 'takeaway'),
      }),
      priceLine({
        unitPriceRappen: rappen(550),
        modifiersRappen: rappen(0),
        quantity: 2,
        discountRappen: rappen(0),
        rate: resolve('alcoholic_beverage', 'takeaway'),
      }),
      priceLine({
        unitPriceRappen: rappen(480),
        modifiersRappen: rappen(0),
        quantity: 1,
        discountRappen: rappen(0),
        rate: resolve('non_alcoholic_beverage', 'takeaway'),
      }),
    ];
    const summary = summarizeByRate(lines);
    expect(summary.map((s) => s.rateBp)).toEqual([810, 260]);
    expect(summary[1]).toMatchObject({
      grossRappen: 3850 + 480,
      taxRappen: lines[0]!.taxRappen + lines[2]!.taxRappen,
    });
    for (const s of summary) expect(s.grossRappen).toBe(s.netRappen + s.taxRappen);
  });

  it('returns nothing for no lines', () => {
    expect(summarizeByRate([])).toEqual([]);
  });
});

describe('allocate and splitEvenly', () => {
  const sum = (values: Rappen[]) => values.reduce((a, b) => a + b, 0);

  it('splits proportionally and always adds up to the total', () => {
    expect(allocate(rappen(1000), [3850, 550, 480])).toEqual([789, 113, 98]);
    for (let total = 0; total <= 3000; total += 13) {
      expect(sum(allocate(rappen(total), [7, 3, 0, 11]))).toBe(total);
    }
  });

  it('gives the extra rappen to the largest remainders, then the earliest index', () => {
    expect(splitEvenly(rappen(1000), 3)).toEqual([334, 333, 333]);
    expect(splitEvenly(rappen(2), 3)).toEqual([1, 1, 0]);
  });

  it('handles negative totals and all-zero weights', () => {
    expect(allocate(rappen(-1000), [1, 1, 1])).toEqual([-334, -333, -333]);
    expect(allocate(rappen(10), [0, 0])).toEqual([5, 5]);
  });

  it('rejects invalid input', () => {
    expect(() => allocate(rappen(10), [])).toThrow(TaxError);
    expect(() => allocate(rappen(10), [1, -1])).toThrow(TaxError);
    expect(() => splitEvenly(rappen(10), 0)).toThrow(TaxError);
  });
});
