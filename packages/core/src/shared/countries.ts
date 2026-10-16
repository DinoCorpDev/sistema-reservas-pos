import { formatSwissVatUid, isValidSwissUid } from '../organization/uid';
import type { Currency } from './money';

/**
 * Countries a location can be in (DEC-047): what the country decides about money, time, the
 * address and the tax id. Tax rates are never here: they are data with validity (RN-02), seeded
 * per country by the organization template.
 */
export const COUNTRIES = ['CH', 'CO'] as const;
export type Country = (typeof COUNTRIES)[number];

export function isCountry(value: unknown): value is Country {
  return typeof value === 'string' && (COUNTRIES as readonly string[]).includes(value);
}

/** The country stored for a location; anything unknown is Switzerland, as before DEC-047. */
export const asCountry = (value: unknown): Country => (isCountry(value) ? value : 'CH');

/** Colombian tax regimes of a restaurant (DEC-047). */
export const CO_TAX_REGIMES = ['inc', 'iva', 'none'] as const;
export type CoTaxRegime = (typeof CO_TAX_REGIMES)[number];

export interface CountryProfile {
  currency: Currency;
  timezone: string;
  /** Postal code format; Colombia's is optional on the form. */
  postalCode: RegExp;
  postalCodeRequired: boolean;
  /** Name of the tax id on screens and receipts: UID (CHE) or NIT. */
  taxIdName: 'UID' | 'NIT';
  /** Swiss cantons are two letters; Colombia has none on the receipt. */
  hasCanton: boolean;
}

export const COUNTRY_PROFILES: Readonly<Record<Country, CountryProfile>> = {
  CH: {
    currency: 'CHF',
    timezone: 'Europe/Zurich',
    postalCode: /^\d{4}$/,
    postalCodeRequired: true,
    taxIdName: 'UID',
    hasCanton: true,
  },
  CO: {
    currency: 'COP',
    timezone: 'America/Bogota',
    postalCode: /^\d{6}$/,
    postalCodeRequired: false,
    taxIdName: 'NIT',
    hasCanton: false,
  },
};

// ── NIT (Colombia) ───────────────────────────────────────────────────────────

/** DIAN weights, from the rightmost digit of the number. */
const NIT_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71] as const;

/** The DIAN check digit (dígito de verificación) of a NIT number without it. */
export function nitCheckDigit(number: string): number {
  const digits = number.replaceAll('.', '').split('').reverse().map(Number);
  const sum = digits.reduce((acc, digit, index) => acc + digit * (NIT_WEIGHTS[index] ?? 0), 0);
  const remainder = sum % 11;
  return remainder > 1 ? 11 - remainder : remainder;
}

const groupNit = (number: string) => number.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/**
 * How a typed NIT reads (DEC-047):
 * - with a dash, the digit after it is the check digit (`900.123.456-7`, `900123456-7`);
 * - without a dash, ten digits or more end with the check digit (`9001234567`);
 * - up to nine digits without a dash are the number alone, as often printed without its check
 *   digit (`900.123.456`): the check digit is computed.
 * `expected` is the right check digit, to tell the user when the typed one is wrong.
 */
export function readNit(
  value: string,
): { valid: boolean; number: string; checkDigit: number; expected: number } | null {
  const text = value.trim().replace(/\s+/g, '');
  const withDash = /^([\d.]+)-(\d)$/.exec(text);
  const plain = /^[\d.]+$/.test(text) ? text.replaceAll('.', '') : null;
  let number: string;
  let checkDigit: number | null;
  if (withDash) {
    number = withDash[1]!.replaceAll('.', '');
    checkDigit = Number(withDash[2]);
  } else if (plain && plain.length >= 10) {
    number = plain.slice(0, -1);
    checkDigit = Number(plain.slice(-1));
  } else if (plain) {
    number = plain;
    checkDigit = null;
  } else {
    return null;
  }
  if (!/^\d+$/.test(number) || number.length < 6 || number.length > 15) return null;
  const expected = nitCheckDigit(number);
  return {
    valid: checkDigit === null || checkDigit === expected,
    number,
    checkDigit: checkDigit ?? expected,
    expected,
  };
}

export function isValidNit(value: string): boolean {
  return readNit(value)?.valid ?? false;
}

/** Canonical format: `900.123.456-7`. */
export function formatNit(value: string): string {
  const nit = readNit(value);
  if (!nit?.valid) throw new TypeError(`Invalid NIT: "${value}"`);
  return `${groupNit(nit.number)}-${nit.checkDigit}`;
}

/**
 * Why a NIT is refused, in the user's words: the right check digit when only it is wrong
 * (`901.234.567-7`), else null (not a NIT at all).
 */
export function nitSuggestion(value: string): string | null {
  const nit = readNit(value);
  return nit && !nit.valid ? `${groupNit(nit.number)}-${nit.expected}` : null;
}

// ── By country ───────────────────────────────────────────────────────────────

export function isValidTaxId(country: Country, value: string): boolean {
  return country === 'CO' ? isValidNit(value) : isValidSwissUid(value);
}

/** How the tax id is stored: `CHE-123.456.789 MWST` or `900.123.456-7`. */
export function formatTaxId(country: Country, value: string): string {
  return country === 'CO' ? formatNit(value) : formatSwissVatUid(value);
}

/** The tax's name on receipts in Colombia (DEC-047); null keeps the language's label. */
export function coTaxLabel(regime: CoTaxRegime): string | null {
  return regime === 'inc' ? 'INC' : regime === 'iva' ? 'IVA' : null;
}

/**
 * From this amount the receipt asks for the customer's name (RN-08). In Switzerland CHF 400;
 * in Colombia $1.000.000 by default (DEC-047), editable per location.
 */
export const CUSTOMER_NAME_FROM: Readonly<Record<Country, number>> = {
  CH: 40_000,
  CO: 100_000_000,
};

export function isValidPostalCode(country: Country, value: string): boolean {
  return COUNTRY_PROFILES[country].postalCode.test(value.trim());
}
