import { describe, expect, it } from 'vitest';
import {
  addRappen,
  cashRoundingStep,
  formatChf,
  formatMoney,
  MoneyError,
  multiplyRappen,
  parseChf,
  parseMoney,
  rappen,
  roundCash,
  roundCashTo5,
  subtractRappen,
} from './money';

describe('rappen', () => {
  it('accepts safe integers', () => {
    expect(rappen(1250)).toBe(1250);
    expect(rappen(-5)).toBe(-5);
  });

  it.each([12.5, 0.1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects non-integer or unsafe value %s',
    (value) => {
      expect(() => rappen(value)).toThrow(MoneyError);
    },
  );
});

describe('arithmetic', () => {
  it('adds, subtracts and multiplies in integers', () => {
    expect(addRappen(rappen(1050), rappen(250), rappen(1))).toBe(1301);
    expect(addRappen()).toBe(0);
    expect(subtractRappen(rappen(1000), rappen(1250))).toBe(-250);
    expect(multiplyRappen(rappen(650), 3)).toBe(1950);
  });

  it('rejects fractional quantities', () => {
    expect(() => multiplyRappen(rappen(650), 1.5)).toThrow(MoneyError);
  });
});

describe('parseChf', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12.50', 1250],
    ['12,50', 1250],
    ['0.05', 5],
    ["1'234.50", 123450],
    ["1'000'000", 100000000],
    ['CHF 18.90', 1890],
    ['-3.05', -305],
    ['  7.1 ', 710],
  ])('parses "%s" as %i Rp', (input, expected) => {
    expect(parseChf(input)).toBe(expected);
  });

  it.each(['', 'abc', '12.505', '1.2.3', "12'34", '--1', '12.'])('rejects "%s"', (input) => {
    expect(() => parseChf(input)).toThrow(MoneyError);
  });

  it('never goes through floating point (0.1 + 0.2 trap)', () => {
    expect(addRappen(parseChf('0.10'), parseChf('0.20'))).toBe(30);
  });
});

describe('formatChf', () => {
  it.each([
    [0, 'CHF 0.00'],
    [5, 'CHF 0.05'],
    [1250, 'CHF 12.50'],
    [123450, "CHF 1'234.50"],
    [100000000, "CHF 1'000'000.00"],
    [-305, 'CHF -3.05'],
  ])('formats %i Rp as "%s"', (amount, expected) => {
    expect(formatChf(rappen(amount))).toBe(expected);
  });

  it('can omit the currency', () => {
    expect(formatChf(rappen(123450), { currency: false })).toBe("1'234.50");
  });

  it('round-trips with parseChf', () => {
    for (const amount of [0, 1, 99, 100, 123456789, -42]) {
      expect(parseChf(formatChf(rappen(amount)))).toBe(amount);
    }
  });
});

describe('roundCashTo5 (RN-06)', () => {
  it.each([
    [1250, 1250, 0],
    [1251, 1250, -1],
    [1252, 1250, -2],
    [1253, 1255, 2],
    [1254, 1255, 1],
    [1255, 1255, 0],
    [1256, 1255, -1],
    [1257, 1255, -2],
    [1258, 1260, 2],
    [1259, 1260, 1],
    [0, 0, 0],
    [2, 0, -2],
    [3, 5, 2],
  ])('rounds %i Rp to %i Rp (rounding %i)', (amount, payable, rounding) => {
    const result = roundCashTo5(rappen(amount));
    expect(result.payable).toBe(payable);
    expect(result.rounding).toBe(rounding);
  });

  it('is symmetric for refunds', () => {
    expect(roundCashTo5(rappen(-1253))).toEqual({ payable: -1255, rounding: -2 });
    expect(roundCashTo5(rappen(-1251))).toEqual({ payable: -1250, rounding: 1 });
  });

  it('always returns a multiple of 5 and a rounding within ±2 Rp', () => {
    for (let amount = -500; amount <= 500; amount++) {
      const { payable, rounding } = roundCashTo5(rappen(amount));
      expect(Math.abs(payable % 5)).toBe(0);
      expect(Math.abs(rounding)).toBeLessThanOrEqual(2);
      expect(payable - rounding).toBe(amount);
    }
  });
});

describe('money by currency (DEC-047)', () => {
  it('formats pesos the Colombian way, centavos only when there are any', () => {
    expect(formatMoney(rappen(1_500_000), 'COP')).toBe('$ 15.000');
    expect(formatMoney(rappen(111_111), 'COP')).toBe('$ 1.111,11');
    expect(formatMoney(rappen(-500_000), 'COP')).toBe('$ -5.000');
    expect(formatMoney(rappen(12_345_600), 'COP', { symbol: false })).toBe('123.456');
    expect(formatMoney(rappen(123_450), 'CHF')).toBe("CHF 1'234.50");
    expect(formatMoney(rappen(123_450))).toBe("CHF 1'234.50");
  });

  it('reads pesos as typed, without floats', () => {
    expect(parseMoney('15000', 'COP')).toBe(1_500_000);
    expect(parseMoney('15.000', 'COP')).toBe(1_500_000);
    expect(parseMoney('$ 1.111,11', 'COP')).toBe(111_111);
    expect(parseMoney('-5.000', 'COP')).toBe(-500_000);
    expect(() => parseMoney('15.5', 'COP')).toThrow(MoneyError);
    expect(parseMoney("1'234.50", 'CHF')).toBe(123_450);
  });

  it('rounds cash in pesos to $50: below $25 down, from $25 up (RN-06)', () => {
    const step = cashRoundingStep('COP');
    expect(step).toBe(5_000);
    expect(roundCash(rappen(1_502_499), step)).toEqual({ payable: 1_500_000, rounding: -2_499 });
    expect(roundCash(rappen(1_502_500), step)).toEqual({ payable: 1_505_000, rounding: 2_500 });
    expect(roundCash(rappen(1_500_000), step)).toEqual({ payable: 1_500_000, rounding: 0 });
    expect(roundCash(rappen(-1_502_600), step)).toEqual({ payable: -1_505_000, rounding: -2_400 });
    expect(() => roundCash(rappen(100), 0)).toThrow(MoneyError);
  });

  it('keeps the Swiss 5 Rp rule as a step of 5', () => {
    for (const amount of [1, 2, 3, 4, 7, 8, -2, -3, 1234]) {
      expect(roundCash(rappen(amount), cashRoundingStep('CHF'))).toEqual(
        roundCashTo5(rappen(amount)),
      );
    }
  });
});
