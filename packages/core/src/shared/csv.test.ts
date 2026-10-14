import { describe, expect, it } from 'vitest';
import { csvFrancs, toCsv } from './csv';

describe('toCsv (RF-D16, RF-F04)', () => {
  it('writes a BOM, ; separators and CRLF lines', () => {
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe(`${String.fromCharCode(0xfeff)}a;b\r\n1;x\r\n`);
  });

  it('quotes separators, quotes and line breaks (RFC 4180)', () => {
    expect(
      toCsv(['t'], [['Bier; 5 dl'], ['Er sagte "gut"'], ['zwei\nZeilen']], { bom: false }),
    ).toBe('t\r\n"Bier; 5 dl"\r\n"Er sagte ""gut"""\r\n"zwei\nZeilen"\r\n');
  });

  it('never lets a text cell run as a formula', () => {
    expect(toCsv(['t'], [['=SUM(A1)'], ['-Rabatt']], { bom: false })).toBe(
      "t\r\n'=SUM(A1)\r\n'-Rabatt\r\n",
    );
    // Numbers stay numbers, negative ones included.
    expect(toCsv(['n'], [[-5], ['-12.50']], { bom: false })).toBe('n\r\n-5\r\n-12.50\r\n');
  });

  it('leaves empty cells empty', () => {
    expect(toCsv(['a', 'b', 'c'], [[null, undefined, '']], { bom: false })).toBe('a;b;c\r\n;;\r\n');
  });
});

describe('csvFrancs', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [1250, '12.50'],
    [-1250, '-12.50'],
    [123456, '1234.56'],
  ])('%i Rp → %s', (rappen, francs) => {
    expect(csvFrancs(rappen)).toBe(francs);
  });
});
