import { describe, expect, it } from 'vitest';
import { formatSwissVatUid, isValidSwissUid } from './uid';

describe('Swiss UID', () => {
  it.each([
    'CHE-116.281.710',
    'CHE-109.322.551',
    'CHE-123.456.788',
    'CHE123456788',
    'che-123.456.788 MWST',
  ])('accepts %s', (uid) => {
    expect(isValidSwissUid(uid)).toBe(true);
  });

  it.each(['CHE-123.456.789', 'CHE-116.281.711', 'CHE-12.456.788', 'DE-123.456.788', ''])(
    'rejects %s',
    (uid) => {
      expect(isValidSwissUid(uid)).toBe(false);
    },
  );

  it('formats the receipt UID with the MWST suffix (RN-08)', () => {
    expect(formatSwissVatUid('CHE123456788')).toBe('CHE-123.456.788 MWST');
    expect(formatSwissVatUid('CHE-123.456.788', 'TVA')).toBe('CHE-123.456.788 TVA');
    expect(() => formatSwissVatUid('CHE-123.456.789')).toThrow(TypeError);
  });
});
