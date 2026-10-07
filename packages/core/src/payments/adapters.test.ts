import { describe, expect, it } from 'vitest';
import { rappen } from '../shared/money';
import {
  cashAdapter,
  externalTerminalAdapter,
  onlineAdapter,
  PAYMENT_ADAPTER_REGISTRY,
  type PaymentRequest,
} from './adapters';
import { PAYMENT_ADAPTERS, PAYMENT_METHODS } from './constants';
import { PaymentRuleError } from './settlement';

/** A payment request written in plain numbers; every amount goes through `rappen()`. */
const request = (fields: { [K in keyof PaymentRequest]: number }): PaymentRequest => {
  const amounts = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, rappen(v)]));
  return amounts as unknown as PaymentRequest;
};

describe('cash adapter (RF-D03, RN-06)', () => {
  it('rounds what is handed over to CHF 0.05 and gives change', () => {
    expect(
      cashAdapter.settle(
        request({ balanceRappen: 4723, amountRappen: 4723, tenderedRappen: 5000 }),
      ),
    ).toEqual({
      amountRappen: 4723,
      tipRappen: 0,
      roundingRappen: 2, // 47.23 → 47.25
      collectedRappen: 4725,
      tenderedRappen: 5000,
      changeRappen: 275,
    });
  });

  it('rounds a partial cash payment down when the remainder is 1-2 Rp', () => {
    expect(cashAdapter.settle(request({ balanceRappen: 5000, amountRappen: 2222 }))).toMatchObject({
      amountRappen: 2222,
      roundingRappen: -2,
      collectedRappen: 2220,
      tenderedRappen: null,
      changeRappen: 0,
    });
  });

  it('rounds sale and tip together, never touching either', () => {
    // 38.50 + 1.48 tip = 39.98 → 40.00
    expect(
      cashAdapter.settle(request({ balanceRappen: 3850, amountRappen: 3850, tipRappen: 148 })),
    ).toMatchObject({
      amountRappen: 3850,
      tipRappen: 148,
      roundingRappen: 2,
      collectedRappen: 4000,
    });
  });

  it('refuses insufficient cash', () => {
    expect(() =>
      cashAdapter.settle(
        request({ balanceRappen: 4723, amountRappen: 4723, tenderedRappen: 4720 }),
      ),
    ).toThrow(expect.objectContaining({ code: 'INSUFFICIENT_TENDER' }));
  });

  it('accepts exactly the rounded amount', () => {
    expect(
      cashAdapter.settle(request({ balanceRappen: 4723, amountRappen: 4723, tenderedRappen: 4725 }))
        .changeRappen,
    ).toBe(0);
  });

  it('refuses a payment above the open balance', () => {
    expect(() => cashAdapter.settle(request({ balanceRappen: 2000, amountRappen: 2001 }))).toThrow(
      expect.objectContaining({ code: 'INVALID_AMOUNT' }),
    );
  });

  it.each([0, -5])('refuses an amount of %i Rp', (amountRappen) => {
    expect(() => cashAdapter.settle(request({ balanceRappen: 2000, amountRappen }))).toThrow(
      PaymentRuleError,
    );
  });
});

describe('external terminal adapter (RF-D04, RF-D06)', () => {
  it('treats what the terminal approved above the sale as the tip', () => {
    expect(
      externalTerminalAdapter.settle(
        request({ balanceRappen: 4723, amountRappen: 4723, approvedRappen: 5000 }),
      ),
    ).toEqual({
      amountRappen: 4723,
      tipRappen: 277,
      roundingRappen: 0,
      collectedRappen: 5000,
      tenderedRappen: null,
      changeRappen: 0,
    });
  });

  it('has no tip when the approved amount equals the sale, and never rounds', () => {
    expect(
      externalTerminalAdapter.settle(
        request({ balanceRappen: 4723, amountRappen: 4723, approvedRappen: 4723 }),
      ),
    ).toMatchObject({ tipRappen: 0, roundingRappen: 0, collectedRappen: 4723 });
  });

  it('without an approved amount uses sale + tip as typed on the POS', () => {
    expect(
      externalTerminalAdapter.settle(
        request({ balanceRappen: 4723, amountRappen: 4723, tipRappen: 300 }),
      ),
    ).toMatchObject({ tipRappen: 300, collectedRappen: 5023 });
    expect(
      externalTerminalAdapter.settle(request({ balanceRappen: 4723, amountRappen: 2000 })),
    ).toMatchObject({ amountRappen: 2000, tipRappen: 0, collectedRappen: 2000 });
  });

  it('refuses an approved amount below the sale', () => {
    expect(() =>
      externalTerminalAdapter.settle(
        request({ balanceRappen: 4723, amountRappen: 4723, approvedRappen: 4700 }),
      ),
    ).toThrow(expect.objectContaining({ code: 'INVALID_AMOUNT' }));
  });

  it('refuses a payment above the open balance or of nothing', () => {
    expect(() =>
      externalTerminalAdapter.settle(request({ balanceRappen: 1000, amountRappen: 1500 })),
    ).toThrow(PaymentRuleError);
    expect(() =>
      externalTerminalAdapter.settle(request({ balanceRappen: 1000, amountRappen: 0 })),
    ).toThrow(PaymentRuleError);
  });
});

describe('online adapter (DEC-003)', () => {
  it('is a stub that refuses every payment', () => {
    expect(() =>
      onlineAdapter.settle(request({ balanceRappen: 2450, amountRappen: 2450 })),
    ).toThrow(PaymentRuleError);
    expect(() =>
      onlineAdapter.settle(request({ balanceRappen: 2450, amountRappen: 2450 })),
    ).toThrow(/DEC-003/);
  });
});

describe('adapter registry (PA-04, RF-D10, RNF-02)', () => {
  it('has exactly one adapter per key, registered under its own key', () => {
    expect(Object.keys(PAYMENT_ADAPTER_REGISTRY).sort()).toEqual([...PAYMENT_ADAPTERS].sort());
    for (const key of PAYMENT_ADAPTERS) {
      expect(PAYMENT_ADAPTER_REGISTRY[key].key).toBe(key);
    }
  });

  it('cash and the external terminal work offline; online does not', () => {
    expect(PAYMENT_ADAPTER_REGISTRY.cash.availableOffline).toBe(true);
    expect(PAYMENT_ADAPTER_REGISTRY['external-terminal'].availableOffline).toBe(true);
    expect(PAYMENT_ADAPTER_REGISTRY.online.availableOffline).toBe(false);
  });

  it('declares the methods each adapter takes', () => {
    expect(PAYMENT_ADAPTER_REGISTRY.cash.methods).toEqual(['cash']);
    expect(PAYMENT_ADAPTER_REGISTRY['external-terminal'].methods).toEqual(['card', 'twint']);
    expect(PAYMENT_ADAPTER_REGISTRY.online.methods).toEqual(['online']);
    for (const adapter of Object.values(PAYMENT_ADAPTER_REGISTRY)) {
      for (const method of adapter.methods) expect(PAYMENT_METHODS).toContain(method);
    }
  });
});
