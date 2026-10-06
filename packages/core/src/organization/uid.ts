/**
 * Número UID suizo de empresa (CHE-123.456.789), que va en el recibo con el sufijo MWST
 * (RF-A02, RF-D20, RN-08). Dígito verificador módulo 11 con pesos 5,4,3,2,7,6,5,4 (eCH-0097).
 */
const UID_PATTERN = /^CHE-?(\d{3})\.?(\d{3})\.?(\d{3})(?:\s*(MWST|TVA|IVA))?$/i;
const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4] as const;

function checkDigit(digits: readonly number[]): number | null {
  const sum = WEIGHTS.reduce((acc, weight, index) => acc + weight * (digits[index] ?? 0), 0);
  const check = 11 - (sum % 11);
  if (check === 11) return 0;
  if (check === 10) return null;
  return check;
}

export function isValidSwissUid(value: string): boolean {
  const match = UID_PATTERN.exec(value.trim());
  if (!match) return false;
  const digits = `${match[1]}${match[2]}${match[3]}`.split('').map(Number);
  const expected = checkDigit(digits.slice(0, 8));
  return expected !== null && expected === digits[8];
}

/** Formato canónico para el recibo: `CHE-123.456.788 MWST`. */
export function formatSwissVatUid(value: string, suffix: 'MWST' | 'TVA' | 'IVA' = 'MWST'): string {
  const match = UID_PATTERN.exec(value.trim());
  if (!match || !isValidSwissUid(value)) {
    throw new TypeError(`Invalid Swiss UID: "${value}"`);
  }
  return `CHE-${match[1]}.${match[2]}.${match[3]} ${suffix}`;
}
