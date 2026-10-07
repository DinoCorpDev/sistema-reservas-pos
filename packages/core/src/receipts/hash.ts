import type { ReceiptContent } from './content';

// Web Crypto and TextEncoder exist in browsers and in Node 22; @pos/core has neither DOM nor
// Node typings (it stays platform-neutral), so the two pieces used here are declared locally.
declare const TextEncoder: new () => { encode(input: string): Uint8Array };
interface Sha256Digest {
  digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer>;
}
const subtle = () => (globalThis as unknown as { crypto: { subtle: Sha256Digest } }).crypto.subtle;

/**
 * Canonical JSON (object keys sorted at every level), so the same content always produces the
 * same text and the same hash on every node.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  // Like JSON.stringify, an undefined array entry is written as null.
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/**
 * SHA-256 of the canonical content (`receipts.content_hash`): proves a stored receipt is the one
 * printed (RN-10). Uses Web Crypto, available in browsers and in Node.
 */
export async function receiptContentHash(content: ReceiptContent): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(content));
  const digest = await subtle().digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
