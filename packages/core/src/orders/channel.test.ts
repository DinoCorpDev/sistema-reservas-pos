import { describe, expect, it } from 'vitest';
import { rappen } from '../shared/money';
import type { TaxRateRecord, TaxRuleRecord } from '../tax/calculation';
import { changeOrderChannel, OrderRuleError, type TaxedOrderLine } from './channel';

const RATES: TaxRateRecord[] = [
  { code: 'normal', rateBp: 810, validFrom: '2024-01-01', validTo: null },
  { code: 'reduced', rateBp: 260, validFrom: '2024-01-01', validTo: null },
];
const rule = (
  taxCategoryKey: TaxRuleRecord['taxCategoryKey'],
  consumptionType: TaxRuleRecord['consumptionType'],
  rateCode: TaxRuleRecord['rateCode'],
): TaxRuleRecord => ({
  taxCategoryKey,
  consumptionType,
  rateCode,
  validFrom: '2024-01-01',
  validTo: null,
});
const RULES: TaxRuleRecord[] = [
  rule('food', 'on_premise', 'normal'),
  rule('food', 'takeaway', 'reduced'),
  rule('alcoholic_beverage', 'on_premise', 'normal'),
  rule('alcoholic_beverage', 'takeaway', 'normal'),
];

const line = (overrides: Partial<TaxedOrderLine>): TaxedOrderLine => ({
  id: 'line-1',
  prepStatus: 'sent',
  taxCategoryKey: 'food',
  unitPriceRappen: rappen(3850),
  modifiersRappen: rappen(0),
  quantity: 1,
  discountRappen: rappen(0),
  lineTotalRappen: rappen(3850),
  taxRateCode: 'normal',
  taxRateBp: 810,
  taxRappen: rappen(288),
  ...overrides,
});

const order = (paymentStatus: 'unpaid' | 'partial' | 'paid' | 'refunded' = 'unpaid') => ({
  channel: 'table' as const,
  consumptionType: 'on_premise' as const,
  paymentStatus,
  lines: [
    line({ id: 'food' }),
    line({
      id: 'beer',
      taxCategoryKey: 'alcoholic_beverage',
      unitPriceRappen: rappen(550),
      lineTotalRappen: rappen(550),
      taxRappen: rappen(41),
    }),
    line({ id: 'voided', prepStatus: 'voided' }),
  ],
});

describe('RN-05 · channel change before payment recalculates the rates and is audited', () => {
  it('moves food to the reduced rate and keeps alcohol at the normal rate', () => {
    const result = changeOrderChannel(order(), {
      channel: 'takeaway',
      saleDate: '2026-10-06',
      rules: RULES,
      rates: RATES,
    });
    expect(result.consumptionType).toBe('takeaway');
    const byId = Object.fromEntries(result.lines.map((l) => [l.id, l]));
    expect(byId.food).toMatchObject({ taxRateCode: 'reduced', taxRateBp: 260, taxRappen: 98 });
    expect(byId.beer).toMatchObject({ taxRateCode: 'normal', taxRateBp: 810, taxRappen: 41 });
    // Prices are not changed by the channel switch.
    expect(byId.food?.lineTotalRappen).toBe(3850);
  });

  it('leaves voided lines untouched', () => {
    const result = changeOrderChannel(order(), {
      channel: 'takeaway',
      saleDate: '2026-10-06',
      rules: RULES,
      rates: RATES,
    });
    expect(result.lines.find((l) => l.id === 'voided')).toEqual(order().lines[2]);
  });

  it('returns the before/after audit record', () => {
    const result = changeOrderChannel(order(), {
      channel: 'takeaway',
      saleDate: '2026-10-06',
      rules: RULES,
      rates: RATES,
    });
    expect(result.audit.action).toBe('order.channel_changed');
    expect(result.audit.before.channel).toBe('table');
    expect(result.audit.after.channel).toBe('takeaway');
    expect(result.audit.before.lines.find((l) => l.id === 'food')?.taxRateBp).toBe(810);
    expect(result.audit.after.lines.find((l) => l.id === 'food')?.taxRateBp).toBe(260);
  });

  it.each(['partial', 'paid', 'refunded'] as const)(
    'refuses to change the channel once the order is %s',
    (paymentStatus) => {
      expect(() =>
        changeOrderChannel(order(paymentStatus), {
          channel: 'takeaway',
          saleDate: '2026-10-06',
          rules: RULES,
          rates: RATES,
        }),
      ).toThrow(expect.objectContaining({ code: 'ORDER_ALREADY_PAID' }));
    },
  );

  it('rejects a no-op change', () => {
    expect(() =>
      changeOrderChannel(order(), {
        channel: 'table',
        saleDate: '2026-10-06',
        rules: RULES,
        rates: RATES,
      }),
    ).toThrow(OrderRuleError);
  });
});
