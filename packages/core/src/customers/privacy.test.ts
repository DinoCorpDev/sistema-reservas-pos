import { describe, expect, it } from 'vitest';
import { anonymizedCustomerPatch, normalizePhone } from './privacy';

describe('RN-23 · anonymization keeps sales, wipes personal data', () => {
  it('clears every personal field and stamps the anonymization time', () => {
    const now = new Date('2026-10-06T12:00:00Z');
    const patch = anonymizedCustomerPatch(now);
    expect(patch.anonymizedAt).toBe(now);
    for (const field of ['firstName', 'lastName', 'phone', 'email', 'notes', 'declaredAllergies', 'tags'] as const) {
      expect(patch[field]).toBeNull();
    }
  });
});

describe('normalizePhone', () => {
  it.each([
    ['079 123 45 67', '+41791234567'],
    ['+41 79 123 45 67', '+41791234567'],
    ['0041791234567', '+41791234567'],
    ['+49 30 1234567', '+49301234567'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['12345', 'abc', '791234567'])('rejects %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});
