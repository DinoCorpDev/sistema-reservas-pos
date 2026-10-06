import { describe, expect, it } from 'vitest';
import { asUuid, isUuid, newId, uuidV7Timestamp } from './ids';

describe('newId', () => {
  it('generates RFC 9562 version 7 UUIDs', () => {
    const id = newId();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
  });

  it('is unique and time-ordered', () => {
    const ids = Array.from({ length: 1000 }, () => newId());
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it('encodes the creation time', () => {
    const before = Date.now();
    const id = newId();
    const after = Date.now();
    expect(uuidV7Timestamp(id)).toBeGreaterThanOrEqual(before);
    expect(uuidV7Timestamp(id)).toBeLessThanOrEqual(after);
  });
});

describe('asUuid', () => {
  it('normalizes to lowercase', () => {
    expect(asUuid('0192F1E2-7A3B-7C4D-8E5F-0123456789AB')).toBe(
      '0192f1e2-7a3b-7c4d-8e5f-0123456789ab',
    );
  });

  it.each(['', 'not-a-uuid', '0192f1e2-7a3b-7c4d-8e5f-0123456789a'])('rejects "%s"', (value) => {
    expect(() => asUuid(value)).toThrow(TypeError);
  });
});
