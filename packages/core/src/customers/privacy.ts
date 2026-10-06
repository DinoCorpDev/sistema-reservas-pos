/**
 * revDSG (RF-E16, RN-23): a customer is anonymized on request. Personal data is wiped; the
 * customer row, its visits, orders and receipts stay so that sales keep their integrity.
 */
export interface CustomerPersonalData {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  declaredAllergies: string | null;
  tags: string[] | null;
}

export function anonymizedCustomerPatch(now: Date): CustomerPersonalData & { anonymizedAt: Date } {
  return {
    firstName: null,
    lastName: null,
    phone: null,
    email: null,
    notes: null,
    declaredAllergies: null,
    tags: null,
    anonymizedAt: now,
  };
}

/** Normalizes a Swiss/international phone number to E.164 (`+41…`), or null if it is not one. */
export function normalizePhone(input: string, defaultCountryCode = '41'): string | null {
  const compact = input.replace(/[\s\-./()]/g, '');
  let digits: string;
  if (compact.startsWith('+')) digits = compact.slice(1);
  else if (compact.startsWith('00')) digits = compact.slice(2);
  else if (compact.startsWith('0')) digits = defaultCountryCode + compact.slice(1);
  else return null;
  return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
}
