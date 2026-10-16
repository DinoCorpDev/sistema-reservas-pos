import { isValidSwissUid } from '../organization/uid';
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

/** `900.123.456-7`, `900123456-7` or `9001234567` (the last digit is the check digit). */
const NIT_PATTERN = /^(\d{1,3}(?:\.?\d{3}){1,4})-?(\d)$/;
/** DIAN weights, from the rightmost digit of the number. */
const NIT_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71] as const;

/** The DIAN check digit (dígito de verificación) of a NIT number without it. */
export function nitCheckDigit(number: string): number {
  const digits = number.replaceAll('.', '').split('').reverse().map(Number);
  const sum = digits.reduce((acc, digit, index) => acc + digit * (NIT_WEIGHTS[index] ?? 0), 0);
  const remainder = sum % 11;
  return remainder > 1 ? 11 - remainder : remainder;
}

export function isValidNit(value: string): boolean {
  const match = NIT_PATTERN.exec(value.trim());
  if (!match) return false;
  const number = match[1]!.replaceAll('.', '');
  if (number.length < 6 || number.length > 15) return false;
  return nitCheckDigit(number) === Number(match[2]);
}

/** Canonical format: `900.123.456-7`. */
export function formatNit(value: string): string {
  const match = NIT_PATTERN.exec(value.trim());
  if (!match || !isValidNit(value)) throw new TypeError(`Invalid NIT: "${value}"`);
  const number = match[1]!.replaceAll('.', '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${number}-${match[2]}`;
}

// ── By country ───────────────────────────────────────────────────────────────

export function isValidTaxId(country: Country, value: string): boolean {
  return country === 'CO' ? isValidNit(value) : isValidSwissUid(value);
}

export function isValidPostalCode(country: Country, value: string): boolean {
  return COUNTRY_PROFILES[country].postalCode.test(value.trim());
}
