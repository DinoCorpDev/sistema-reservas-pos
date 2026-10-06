import { describe, expect, it } from 'vitest';
import { ALLERGENS, ORIGIN_KINDS } from './constants';

describe('catalog reference data', () => {
  it('lists exactly the 14 EU/CH mandatory allergens (RF-B05)', () => {
    expect(ALLERGENS).toHaveLength(14);
    expect(new Set(ALLERGENS).size).toBe(14);
  });

  it('requires origin for meat, poultry and fish (RF-B06)', () => {
    expect([...ORIGIN_KINDS].sort()).toEqual(['fish', 'meat', 'poultry']);
  });
});
