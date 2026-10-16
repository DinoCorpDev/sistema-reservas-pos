import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { type HubCertificateStatus, isPrivateLanAddress } from '@pos/core';
import type { Logger } from '@pos/db';
import * as acme from 'acme-client';
import { type CloudFetch, cloudJson } from './cloud';

/**
 * HTTPS of the hub on the LAN (DEC-028). The POS lives on HTTPS and the browser refuses plain
 * HTTP into the LAN, so the hub needs a name and a certificate. It keeps its private key here
 * and sends the cloud only its LAN address and a CSR; the cloud publishes the name and returns
 * the certificate, renewing it before its end. The stored certificate is served at once on a
 * restart, also without internet.
 */

interface CertificateView {
  enabled: boolean;
  hostname: string | null;
  status: HubCertificateStatus;
  certificatePem: string | null;
  notAfter: string | null;
  lastError: string | null;
}

export type TlsRefresh = 'disabled' | 'no_lan_ip' | HubCertificateStatus;

/** The LAN address to publish: `HUB_LAN_IP`, else the PC's first private IPv4. */
export function lanAddress(
  configured = process.env.HUB_LAN_IP,
  interfaces = networkInterfaces(),
): string | null {
  if (configured?.trim()) return configured.trim();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && isPrivateLanAddress(entry.address)) {
        return entry.address;
      }
    }
  }
  return null;
}

/** How long to wait before asking again, by the last answer. */
const NEXT_REFRESH_MS: Record<TlsRefresh, number> = {
  disabled: 6 * 60 * 60_000,
  no_lan_ip: 10 * 60_000,
  none: 2 * 60_000,
  pending: 2 * 60_000,
  failed: 30 * 60_000,
  issued: 6 * 60 * 60_000,
};

export class HubTls {
  private installed: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly options: {
      /** Where the key, the CSR and the certificate are kept. */
      dir: string;
      cloud: CloudFetch;
      lanIp: () => string | null;
      /** Serves (or swaps) the certificate. */
      install: (pem: { key: string; cert: string }) => Promise<unknown>;
      logger?: Logger;
    },
  ) {}

  private path(name: string): string {
    return join(this.options.dir, name);
  }

  private read(name: string): string | null {
    return existsSync(this.path(name)) ? readFileSync(this.path(name), 'utf8') : null;
  }

  private write(name: string, content: string, mode = 0o644): void {
    mkdirSync(this.options.dir, { recursive: true });
    writeFileSync(this.path(name), content, { mode });
  }

  private async install(key: string, cert: string): Promise<void> {
    if (cert === this.installed) return;
    await this.options.install({ key, cert });
    this.installed = cert;
  }

  /** Serves what is stored, asks the cloud, and keeps asking on its own schedule. */
  async start(): Promise<void> {
    const key = this.read('key.pem');
    const cert = this.read('cert.pem');
    if (key && cert) {
      await this.install(key, cert);
      this.options.logger?.info('hub HTTPS serving the stored certificate');
    }
    await this.tick();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    let result: TlsRefresh = 'pending';
    try {
      result = await this.refresh();
    } catch (error) {
      this.options.logger?.warn('hub certificate: the cloud is not reachable', {
        error: String(error),
      });
    }
    this.timer = setTimeout(() => void this.tick(), NEXT_REFRESH_MS[result]);
    this.timer.unref();
  }

  /** One round with the cloud: the name, the request, and the certificate once issued. */
  async refresh(): Promise<TlsRefresh> {
    const current = await cloudJson<CertificateView>(this.options.cloud, '/sync/hub-certificate');
    if (!current.enabled || !current.hostname) return 'disabled';
    const lanIp = this.options.lanIp();
    if (!lanIp || !isPrivateLanAddress(lanIp)) {
      this.options.logger?.warn('hub certificate: no private LAN address (set HUB_LAN_IP)', {
        lanIp,
      });
      return 'no_lan_ip';
    }

    // The key stays; a new name only needs a new CSR.
    let key = this.read('key.pem');
    let csr = this.read('csr.pem');
    if (!key || !csr || this.read('hostname') !== current.hostname) {
      const [newKey, newCsr] = await acme.crypto.createCsr(
        { commonName: current.hostname, altNames: [current.hostname] },
        key ?? undefined,
      );
      key = newKey.toString();
      csr = newCsr.toString();
      this.write('key.pem', key, 0o600);
      this.write('csr.pem', csr);
      this.write('hostname', current.hostname);
    }

    const answer = await cloudJson<CertificateView>(this.options.cloud, '/sync/hub-certificate', {
      method: 'POST',
      body: { lanIp, csr },
    });
    if (answer.status === 'issued' && answer.certificatePem) {
      if (answer.certificatePem !== this.read('cert.pem')) {
        this.write('cert.pem', answer.certificatePem);
        this.options.logger?.info('hub certificate received', {
          hostname: answer.hostname,
          notAfter: answer.notAfter,
        });
      }
      await this.install(key, answer.certificatePem);
    } else if (answer.status === 'failed') {
      this.options.logger?.warn('hub certificate: the cloud could not issue it yet', {
        error: answer.lastError,
      });
    }
    return answer.status;
  }
}
