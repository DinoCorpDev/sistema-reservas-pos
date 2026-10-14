import { describe, expect, it } from 'vitest';
import { countTotal, denominationCountSchema } from './count';

describe('countTotal (RF-D14)', () => {
  it('adds up pieces × value of every denomination, in rappen', () => {
    // 2 × CHF 100 + 3 × CHF 20 + 1 × CHF 5 + 4 × 50 Rp + 7 × 5 Rp = 200 + 60 + 5 + 2 + 0.35
    expect(countTotal({ '10000': 2, '2000': 3, '500': 1, '50': 4, '5': 7 })).toBe(26735);
    expect(countTotal({ '100000': 1 })).toBe(100000);
  });

  it('is zero for an empty count or zero pieces', () => {
    expect(countTotal({})).toBe(0);
    expect(countTotal({ '1000': 0 })).toBe(0);
  });

  it('refuses negative or fractional pieces', () => {
    expect(() => countTotal({ '500': -1 })).toThrow(RangeError);
    expect(() => countTotal({ '500': 1.5 })).toThrow(RangeError);
  });

  it('accepts only CHF denominations and whole piece counts at the boundary', () => {
    expect(denominationCountSchema.safeParse({ '500': 3 }).success).toBe(true);
    expect(denominationCountSchema.safeParse({}).success).toBe(true);
    expect(denominationCountSchema.safeParse({ '300': 1 }).success).toBe(false);
    expect(denominationCountSchema.safeParse({ '500': -1 }).success).toBe(false);
    expect(denominationCountSchema.safeParse({ '500': 0.5 }).success).toBe(false);
  });
});
