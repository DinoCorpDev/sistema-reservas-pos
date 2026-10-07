import { describe, expect, it } from 'vitest';
import { rappen } from '../shared/money';
import { foldOperations } from './reducer';
import { CONTEXT, Device, freshId, line, TERMINAL, USER } from './test-kit';
import { discountAmount, lineGross, modifiersPerUnit, paymentStatusOf, percentOf } from './totals';

const modifier = (priceDeltaRappen: number, quantity = 1) => ({
  id: freshId(),
  modifierId: freshId(),
  name: 'Extra',
  priceDeltaRappen: rappen(priceDeltaRappen),
  quantity,
});

describe('percentOf (RF-C11)', () => {
  it.each([
    [1235, 1000, 124], // 10 % of 12.35 = 1.235 → 1.24 (half up)
    [2450, 1000, 245],
    [2450, 500, 123], // 5 % of 24.50 = 1.225 → 1.23
    [2450, 10000, 2450],
    [1, 5000, 1], // 0.5 Rp → 1
    [1, 4999, 0], // 0.4999 Rp → 0
    [0, 5000, 0],
    [3333, 3333, 1111], // 1110.89 → 1111
  ])('%i Rp × %i bp = %i Rp', (amount, bp, expected) => {
    expect(percentOf(rappen(amount), bp)).toBe(expected);
  });

  it('is symmetric for negative amounts', () => {
    expect(percentOf(rappen(-1235), 1000)).toBe(-124);
    expect(percentOf(rappen(-1), 5000)).toBe(-1);
    for (let amount = 1; amount <= 5000; amount += 17) {
      // `+ 0`: the negation of 0 is -0, and percentOf never returns -0.
      expect(percentOf(rappen(-amount), 1250)).toBe(-percentOf(rappen(amount), 1250) + 0);
    }
    expect(Object.is(percentOf(rappen(-3), 1000), -0)).toBe(false);
  });
});

describe('discountAmount (RF-C11)', () => {
  const base = rappen(2450);

  it('takes a percentage of the base', () => {
    expect(discountAmount({ kind: 'percent', value: 1000 }, base)).toBe(245);
  });

  it('caps a percentage at 100 %', () => {
    expect(discountAmount({ kind: 'percent', value: 15000 }, base)).toBe(2450);
    expect(discountAmount({ kind: 'percent', value: 10000 }, base)).toBe(2450);
  });

  it('takes a fixed amount, capped at the base', () => {
    expect(discountAmount({ kind: 'amount', value: 500 }, base)).toBe(500);
    expect(discountAmount({ kind: 'amount', value: 3000 }, base)).toBe(2450);
  });

  it.each([0, -100])('takes nothing off a base of %i', (value) => {
    expect(discountAmount({ kind: 'percent', value: 5000 }, rappen(value))).toBe(0);
    expect(discountAmount({ kind: 'amount', value: 500 }, rappen(value))).toBe(0);
  });
});

describe('line gross', () => {
  it('is (unit price + modifiers per unit) × quantity', () => {
    const item = {
      unitPriceRappen: rappen(2450),
      quantity: 2,
      modifiers: [modifier(250), modifier(400, 2)],
    };
    // Per unit: 250 + 2 × 400 = 1050; line: (2450 + 1050) × 2 = 7000.
    expect(modifiersPerUnit(item)).toBe(1050);
    expect(lineGross(item)).toBe(7000);
  });

  it('subtracts negative modifiers ("ohne Fleisch")', () => {
    const item = { unitPriceRappen: rappen(1000), quantity: 1, modifiers: [modifier(-100, 2)] };
    expect(lineGross(item)).toBe(800);
  });

  it('never goes below zero', () => {
    const item = { unitPriceRappen: rappen(500), quantity: 3, modifiers: [modifier(-800)] };
    // (500 − 800) × 3 = −900 → 0
    expect(modifiersPerUnit(item)).toBe(-800);
    expect(lineGross(item)).toBe(0);
  });
});

describe('paymentStatusOf (RF-C16, PA-05)', () => {
  it.each([
    // total, paid, payments, refunds, valid items → status
    [0, 0, 0, 0, 1, 'paid'], // 100 % courtesy: nothing to pay
    [0, 0, 0, 0, 0, 'unpaid'], // empty order: nothing sold, nothing paid
    [2450, 0, 0, 0, 1, 'unpaid'],
    [2450, 1000, 1, 0, 1, 'partial'],
    [2450, 2450, 1, 0, 1, 'paid'],
    [2450, 3000, 2, 0, 1, 'paid'], // overpaid is still paid; the reducer flags it
    [2450, 0, 1, 1, 1, 'refunded'], // fully refunded
    [2450, -100, 1, 1, 1, 'refunded'],
    [0, 0, 1, 1, 0, 'refunded'], // refunded, then the items were voided
    [2450, 1450, 1, 1, 1, 'partial'], // part of the payment refunded
    [2450, 2450, 2, 1, 1, 'paid'], // one of two payments refunded and paid again
  ] as const)(
    'total %i, paid %i, %i payment(s), %i refund(s), %i item(s) → %s',
    (total, paid, paymentCount, refundCount, validItemCount, status) => {
      expect(
        paymentStatusOf({
          totalRappen: rappen(total),
          paidRappen: rappen(paid),
          paymentCount,
          refundCount,
          validItemCount,
        }),
      ).toBe(status);
    },
  );

  it('a 100 % courtesy order is paid without any payment', () => {
    const d = new Device(TERMINAL.H1, USER.manager);
    const open = d.open();
    const state = foldOperations(
      [
        open,
        d.add(open.orderId, line()),
        d.op('discount.apply', open.orderId, {
          discountId: freshId(),
          itemId: null,
          kind: 'percent',
          value: 10000,
          reasonCode: 'courtesy',
          reasonText: null,
        }),
      ],
      CONTEXT,
    );
    expect(state.orders.get(open.orderId)).toMatchObject({
      totalRappen: 0,
      discountTotalRappen: 2450,
      paymentStatus: 'paid',
      // The item has not been served yet, so the order stays open (RN-12).
      status: 'open',
    });
  });
});
