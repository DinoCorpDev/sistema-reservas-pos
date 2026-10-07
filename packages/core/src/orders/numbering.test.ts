import { describe, expect, it } from 'vitest';
import { formatOrderNumber, formatReceiptNumber, orderNumber } from './numbering';
import { orderNumberSchema } from './operations';

describe('order numbers (RN-16, RF-C15, DEC-022)', () => {
  it.each([
    [42, '', '0042'],
    [1, '', '0001'],
    [9999, '', '9999'],
    [12345, '', '12345'], // a very busy day simply gets a fifth digit
    [7, 'K1', 'K1-0007'],
    [123, 'H2', 'H2-0123'],
  ])('number %i with prefix %j → %s', (number, prefix, display) => {
    expect(formatOrderNumber(number, prefix)).toBe(display);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses number %s', (number) => {
    expect(() => formatOrderNumber(number, '')).toThrow(RangeError);
  });

  it('builds the order number of `order.open` from the authority numbering', () => {
    const number = orderNumber('2026-10-06', 42);
    expect(number).toEqual({ businessDate: '2026-10-06', number: 42, prefix: '', display: '0042' });
    expect(orderNumberSchema.parse(number)).toEqual(number);
  });

  it('builds an offline terminal number with its own prefix', () => {
    const number = orderNumber('2026-10-06', 7, 'K1');
    expect(number).toEqual({
      businessDate: '2026-10-06',
      number: 7,
      prefix: 'K1',
      display: 'K1-0007',
    });
    expect(orderNumberSchema.parse(number)).toEqual(number);
  });
});

describe('receipt numbers (DEC-024)', () => {
  it('is <prefix>-<YYMMDD>-<counter>', () => {
    expect(formatReceiptNumber('K1', '2026-10-06', 12)).toBe('K1-261006-0012');
    expect(formatReceiptNumber('H2', '2026-12-31', 1)).toBe('H2-261231-0001');
    expect(formatReceiptNumber('BAR1', '2027-01-01', 12345)).toBe('BAR1-270101-12345');
  });

  it.each(['', 'k1', 'K1234', 'K-1', 'K 1'])('refuses the terminal prefix %j', (prefix) => {
    expect(() => formatReceiptNumber(prefix, '2026-10-06', 1)).toThrow(RangeError);
  });

  it.each([0, -3, 2.5, Number.NaN])('refuses the counter %s', (counter) => {
    expect(() => formatReceiptNumber('K1', '2026-10-06', counter)).toThrow(RangeError);
  });
});
