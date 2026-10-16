import { describe, expect, it } from 'vitest';
import {
  asCountry,
  COUNTRY_PROFILES,
  formatNit,
  isValidNit,
  isValidPostalCode,
  isValidTaxId,
  nitCheckDigit,
} from './countries';

describe('countries (DEC-047)', () => {
  it('computes the DIAN check digit of a NIT', () => {
    // The DIAN's own NIT: 800.197.268-4.
    expect(nitCheckDigit('800197268')).toBe(4);
    expect(nitCheckDigit('800.197.268')).toBe(4);
  });

  it('accepts a NIT with its check digit, in any usual writing', () => {
    for (const nit of ['800.197.268-4', '800197268-4', '8001972684', ' 800.197.268-4 ']) {
      expect(isValidNit(nit)).toBe(true);
    }
  });

  it('rejects a wrong check digit, letters or a too short number', () => {
    for (const nit of [
      '800.197.268-5',
      '800197268',
      'ABC.197.268-4',
      '123-4',
      '',
      'CHE-123.456.788',
    ]) {
      expect(isValidNit(nit)).toBe(false);
    }
  });

  it('formats a NIT for the receipt', () => {
    expect(formatNit('8001972684')).toBe('800.197.268-4');
    expect(() => formatNit('800197268-5')).toThrow(TypeError);
  });

  it('validates the tax id and the postal code of each country', () => {
    expect(isValidTaxId('CO', '800.197.268-4')).toBe(true);
    expect(isValidTaxId('CH', '800.197.268-4')).toBe(false);
    expect(isValidTaxId('CH', 'CHE-123.456.788')).toBe(true);
    expect(isValidPostalCode('CH', '8001')).toBe(true);
    expect(isValidPostalCode('CO', '110111')).toBe(true);
    expect(isValidPostalCode('CO', '8001')).toBe(false);
  });

  it('knows the currency and the time zone of each country; unknown is Switzerland', () => {
    expect(COUNTRY_PROFILES.CO).toMatchObject({ currency: 'COP', timezone: 'America/Bogota' });
    expect(COUNTRY_PROFILES.CH).toMatchObject({ currency: 'CHF', timezone: 'Europe/Zurich' });
    expect(asCountry('XX')).toBe('CH');
    expect(asCountry(null)).toBe('CH');
  });
});
