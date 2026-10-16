import { Resolver } from 'node:dns/promises';
import * as acme from 'acme-client';

/**
 * The outside world of hub HTTPS (DEC-028), behind two small interfaces so the provider can be
 * swapped and the use case tested without it: a DNS zone where the hubs' names live, and an
 * ACME authority that issues certificates with DNS-01.
 */

export interface DnsProvider {
  /** Creates or replaces the only record of this type and name. */
  upsert(record: { type: 'A' | 'TXT'; name: string; content: string }): Promise<void>;
  remove(record: { type: 'A' | 'TXT'; name: string }): Promise<void>;
}

export interface CertificateAuthority {
  /** Issues a certificate for the CSR, proving the name with a TXT record in `dns`. */
  issue(input: {
    hostname: string;
    csrPem: string;
    dns: DnsProvider;
  }): Promise<{ certificatePem: string; notAfter: Date }>;
}

// ── Cloudflare DNS ───────────────────────────────────────────────────────────

interface CloudflareRecord {
  id: string;
  type: string;
  name: string;
  content: string;
}

/**
 * DNS of a zone at Cloudflare (API token with «DNS edit» on that zone only). Free; another
 * provider only needs another `DnsProvider`.
 */
export function cloudflareDns(options: {
  apiToken: string;
  zoneId: string;
  fetch?: typeof fetch;
}): DnsProvider {
  const http = options.fetch ?? fetch;
  const base = `https://api.cloudflare.com/client/v4/zones/${options.zoneId}/dns_records`;
  const call = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
    const response = await http(url, {
      ...init,
      headers: {
        authorization: `Bearer ${options.apiToken}`,
        'content-type': 'application/json',
      },
    });
    const body = (await response.json().catch(() => null)) as {
      success?: boolean;
      result?: T;
      errors?: { message: string }[];
    } | null;
    if (!response.ok || !body?.success) {
      const detail = body?.errors?.map((e) => e.message).join('; ') ?? response.statusText;
      throw new Error(`Cloudflare DNS: ${response.status} ${detail}`);
    }
    return body.result as T;
  };
  const find = (type: string, name: string) =>
    call<CloudflareRecord[]>(`${base}?type=${type}&name=${encodeURIComponent(name)}`);

  return {
    async upsert({ type, name, content }) {
      const [existing, ...extra] = await find(type, name);
      // A LAN address is only reachable inside the LAN: never proxied, short TTL.
      const record = { type, name, content, ttl: 60, proxied: false };
      if (existing) {
        await call(`${base}/${existing.id}`, { method: 'PUT', body: JSON.stringify(record) });
      } else {
        await call(base, { method: 'POST', body: JSON.stringify(record) });
      }
      for (const stale of extra) await call(`${base}/${stale.id}`, { method: 'DELETE' });
    },
    async remove({ type, name }) {
      for (const record of await find(type, name)) {
        await call(`${base}/${record.id}`, { method: 'DELETE' });
      }
    },
  };
}

// ── ACME (Let's Encrypt) ─────────────────────────────────────────────────────

/** Waits until public resolvers see the TXT value, so the authority finds it at once. */
async function waitForTxt(name: string, value: string, timeoutMs = 180_000): Promise<void> {
  const resolver = new Resolver();
  resolver.setServers(['1.1.1.1', '8.8.8.8']);
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const records = await resolver.resolveTxt(name);
      if (records.some((chunks) => chunks.join('') === value)) return;
    } catch {
      // Not there yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`The TXT record ${name} did not appear within ${timeoutMs / 1000} s`);
}

/**
 * Let's Encrypt (or any ACME directory) with DNS-01. The account key is created once and kept
 * by the worker (`ACME_ACCOUNT_KEY_PATH`), so renewals use the same account.
 */
export function acmeAuthority(options: {
  directoryUrl: string;
  email: string;
  accountKeyPem: string;
}): CertificateAuthority {
  const client = new acme.Client({
    directoryUrl: options.directoryUrl,
    accountKey: options.accountKeyPem,
  });
  return {
    async issue({ hostname, csrPem, dns }) {
      const challengeName = `_acme-challenge.${hostname}`;
      const certificatePem = await client.auto({
        csr: csrPem,
        email: options.email,
        termsOfServiceAgreed: true,
        challengePriority: ['dns-01'],
        // waitForTxt checks the public resolvers itself.
        skipChallengeVerification: true,
        challengeCreateFn: async (_authz, _challenge, keyAuthorization) => {
          await dns.upsert({ type: 'TXT', name: challengeName, content: keyAuthorization });
          await waitForTxt(challengeName, keyAuthorization);
        },
        challengeRemoveFn: async () => {
          await dns.remove({ type: 'TXT', name: challengeName });
        },
      });
      const info = acme.crypto.readCertificateInfo(certificatePem);
      return { certificatePem, notAfter: info.notAfter };
    },
  };
}

/** The directory URL for `ACME_DIRECTORY`: `production`, `staging` or a URL. */
export function acmeDirectoryUrl(value: string | undefined): string {
  if (!value || value === 'production') return acme.directory.letsencrypt.production;
  if (value === 'staging') return acme.directory.letsencrypt.staging;
  return value;
}

export const createAccountKey = async (): Promise<string> =>
  (await acme.crypto.createPrivateEcdsaKey()).toString();
