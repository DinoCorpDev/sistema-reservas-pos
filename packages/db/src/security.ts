import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/**
 * Credential primitives shared by the seed, the API and the backoffice (RNF-10).
 * Passwords and PINs: argon2id. One-time codes and device/API tokens: SHA-256 of a random value
 * (they are long and random, so a slow hash adds nothing).
 */

export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  return verify(hashed, plain).catch(() => false);
}

/**
 * Identifies a user from the PIN alone (DEC-015): HMAC-SHA256 with the organization's secret
 * key. The unique index on (organization_id, pin_lookup) keeps PINs unique per organization.
 */
export function pinLookup(pinKeyHex: string, pin: string): string {
  return createHmac('sha256', Buffer.from(pinKeyHex, 'hex')).update(pin, 'utf8').digest('hex');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** URL-safe random token, e.g. device tokens and API keys. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Short human-friendly code without ambiguous characters (no 0/O, 1/I), e.g. `K7QM-4XPA`. */
export function pairingCode(length = 8): string {
  const bytes = randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += PAIRING_ALPHABET[bytes[i]! % PAIRING_ALPHABET.length];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Normalizes what a person typed (`k7qm 4xpa`) into the stored form (`K7QM-4XPA`). */
export function normalizePairingCode(input: string): string {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}
