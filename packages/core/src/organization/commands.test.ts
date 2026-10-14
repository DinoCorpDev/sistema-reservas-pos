import { describe, expect, it } from 'vitest';
import { createTerminalSchema, pairTerminalSchema } from './commands';

describe('terminal commands', () => {
  const terminal = { name: 'Kasse 2', orderNumberPrefix: 'K2' };

  it('creates the terminals the backoffice manages by hand', () => {
    for (const type of ['pos', 'handheld', 'kds', 'hub']) {
      expect(createTerminalSchema.safeParse({ ...terminal, type }).success).toBe(true);
    }
  });

  it('never creates a waiter phone by hand: it appears by pairing (DEC-036)', () => {
    expect(createTerminalSchema.safeParse({ ...terminal, type: 'phone' }).success).toBe(false);
  });

  it('pairs with a code alone, or with a code and a 4-6 digit PIN for a phone', () => {
    expect(pairTerminalSchema.parse({ code: 'ABCD-EFGH' })).toEqual({ code: 'ABCD-EFGH' });
    expect(pairTerminalSchema.parse({ code: 'ABCD-EFGH', pin: '4001' }).pin).toBe('4001');
    expect(pairTerminalSchema.safeParse({ code: 'ABCD-EFGH', pin: '12' }).success).toBe(false);
    expect(pairTerminalSchema.safeParse({ code: 'ABCD-EFGH', pin: '12a4' }).success).toBe(false);
  });
});
