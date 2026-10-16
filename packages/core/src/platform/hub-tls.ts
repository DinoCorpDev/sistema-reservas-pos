import { z } from 'zod';

/**
 * HTTPS for the LAN hub (DEC-028): the POS lives on HTTPS and the browser blocks plain HTTP
 * calls into the LAN. Each hub gets a public DNS name pointing to its LAN address and a
 * certificate the cloud obtains with ACME DNS-01. The hub keeps its private key: it sends only
 * a certificate signing request. These are the rules both sides share.
 */

/** Port of the hub's HTTPS listener; HTTP stays on 4100 for health checks on the PC itself. */
export const HUB_TLS_PORT = 4443;

/** A certificate is renewed when it has fewer days left (Let's Encrypt issues 90 days). */
export const HUB_CERTIFICATE_RENEW_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * The hub's DNS name: stable for its terminal and saying nothing about the restaurant.
 * The last 12 hex digits of a UUID v7 are random.
 */
export function hubHostname(terminalId: string, zone: string): string {
  const label = terminalId.replaceAll('-', '').toLowerCase().slice(-12);
  return `h-${label}.${zone.toLowerCase().replace(/\.$/, '')}`;
}

export function hubTlsUrl(hostname: string, port = HUB_TLS_PORT): string {
  return `https://${hostname}:${port}`;
}

/** Private IPv4 of a LAN (RFC 1918). A public address would publish a route into the LAN. */
export function isPrivateLanAddress(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return false;
  const [a, b] = parts.map(Number) as [number, number, number, number];
  if (parts.some((part) => Number(part) > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Missing, or close enough to its end to ask for a new one. */
export function hubCertificateDue(notAfter: Date | null, now: Date): boolean {
  return (
    notAfter === null || notAfter.getTime() - now.getTime() < HUB_CERTIFICATE_RENEW_DAYS * DAY_MS
  );
}

/** Waiting time before the next attempt after `failures` failed ones: 5 min doubling, max 6 h. */
export function hubCertificateRetryDelayMs(failures: number): number {
  return Math.min(5 * 60_000 * 2 ** Math.max(0, failures - 1), 6 * 60 * 60_000);
}

/** What the hub sends: its LAN address and a CSR for its name. */
export const hubCertificateRequestSchema = z.object({
  lanIp: z.ipv4().refine(isPrivateLanAddress, 'A private LAN address (RFC 1918)'),
  csr: z
    .string()
    .max(10_000)
    .refine((pem) => pem.trim().startsWith('-----BEGIN CERTIFICATE REQUEST-----'), 'A PEM CSR'),
});
export type HubCertificateRequest = z.infer<typeof hubCertificateRequestSchema>;

export const HUB_CERTIFICATE_STATUSES = ['none', 'pending', 'issued', 'failed'] as const;
export type HubCertificateStatus = (typeof HUB_CERTIFICATE_STATUSES)[number];
