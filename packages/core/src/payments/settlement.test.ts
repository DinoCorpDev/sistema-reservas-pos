import { describe, expect, it } from 'vitest';
import { rappen } from '../shared/money';
import { priceLine, summarizeByRate } from '../tax/calculation';
import { PaymentRuleError, settleCash, settleNonCash, settleRefund } from './settlement';

describe('RN-06 · cash is rounded to CHF 0.05 and the difference is recorded as rounding', () => {
  it.each([
    [4720, 0, 4720, 0],
    [4722, 0, 4720, -2],
    [4723, 0, 4725, 2],
    [4723, 500, 5225, 2], // tip in cash is rounded together with the sale
    [1, 0, 0, -1],
  ])('due %i + tip %i → collect %i (rounding %i)', (amount, tip, collected, rounding) => {
    const result = settleCash({ amountRappen: rappen(amount), tipRappen: rappen(tip) });
    expect(result.collectedRappen).toBe(collected);
    expect(result.roundingRappen).toBe(rounding);
    // The sale amount itself is never changed by rounding: it is not a discount.
    expect(result.amountRappen).toBe(amount);
    expect(result.tipRappen).toBe(tip);
    expect(result.amountRappen + result.tipRappen + result.roundingRappen).toBe(collected);
  });

  it('computes the change from the tendered cash', () => {
    expect(settleCash({ amountRappen: rappen(4723), tenderedRappen: rappen(5000) })).toMatchObject({
      collectedRappen: 4725,
      tenderedRappen: 5000,
      changeRappen: 275,
    });
  });

  it('refuses insufficient cash and negative amounts', () => {
    expect(() => settleCash({ amountRappen: rappen(4723), tenderedRappen: rappen(4720) })).toThrow(
      expect.objectContaining({ code: 'INSUFFICIENT_TENDER' }),
    );
    expect(() => settleCash({ amountRappen: rappen(-5) })).toThrow(PaymentRuleError);
  });

  it.each([
    [4720, 0, 4720, 0],
    [4721, 0, 4720, -1],
    [4722, 0, 4720, -2],
    [4723, 0, 4725, 2],
    [4724, 0, 4725, 1],
    [4723, 500, 5225, 2],
  ])(
    'a cash refund of %i + tip %i pays out %i (rounding %i), like a cash payment (DEC-038)',
    (amount, tip, paidOut, rounding) => {
      const refund = settleRefund('cash', { amountRappen: rappen(amount), tipRappen: rappen(tip) });
      expect(refund).toEqual({
        amountRappen: amount,
        tipRappen: tip,
        roundingRappen: rounding,
        paidOutRappen: paidOut,
      });
      // Symmetric with the payment it gives back.
      const paid = settleCash({ amountRappen: rappen(amount), tipRappen: rappen(tip) });
      expect(refund.roundingRappen).toBe(paid.roundingRappen);
      expect(refund.paidOutRappen).toBe(paid.collectedRappen);
    },
  );

  it('never rounds a refund by card or TWINT, and refuses negative ones', () => {
    expect(settleRefund('other', { amountRappen: rappen(4723), tipRappen: rappen(2) })).toEqual({
      amountRappen: 4723,
      tipRappen: 2,
      roundingRappen: 0,
      paidOutRappen: 4725,
    });
    expect(() => settleRefund('cash', { amountRappen: rappen(-5) })).toThrow(PaymentRuleError);
  });

  it('never rounds non-cash payments', () => {
    expect(settleNonCash({ amountRappen: rappen(4723), tipRappen: rappen(277) })).toMatchObject({
      collectedRappen: 5000,
      roundingRappen: 0,
    });
  });
});

describe('RN-07 · the tip is outside the sale and carries no MWST', () => {
  it('keeps the tip out of the sale amount and of the tax summary', () => {
    const lines = [
      priceLine({
        unitPriceRappen: rappen(3850),
        modifiersRappen: rappen(0),
        quantity: 1,
        discountRappen: rappen(0),
        rate: { taxCategoryKey: 'food', rateCode: 'normal', rateBp: 810 },
      }),
    ];
    const sale = lines.reduce((sum, l) => sum + l.lineTotalRappen, 0);
    const payment = settleNonCash({ amountRappen: rappen(sale), tipRappen: rappen(650) });
    const taxBefore = summarizeByRate(lines);

    expect(payment.amountRappen).toBe(3850);
    expect(payment.tipRappen).toBe(650);
    expect(payment.collectedRappen).toBe(4500);
    // The tax base and tax amount are those of the sale only.
    expect(taxBefore).toEqual([
      { rateCode: 'normal', rateBp: 810, grossRappen: 3850, taxRappen: 288, netRappen: 3562 },
    ]);
  });

  it('keeps a cash tip out of the sale even when the total is rounded', () => {
    const payment = settleCash({ amountRappen: rappen(3850), tipRappen: rappen(148) });
    expect(payment.amountRappen).toBe(3850);
    expect(payment.tipRappen).toBe(148);
    expect(payment.roundingRappen).toBe(2);
    expect(payment.collectedRappen).toBe(4000);
  });
});
