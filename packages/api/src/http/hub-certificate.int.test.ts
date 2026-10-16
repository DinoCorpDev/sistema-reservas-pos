import { parseLocationSettings } from '@pos/core';
import { schema as s } from '@pos/db';
import * as acme from 'acme-client';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CertificateAuthority, DnsProvider } from '../services/platform/hub-tls-providers';
import { processHubCertificates } from '../services/sync/hub-certificate';
import { createOtherOrganization, createTestApi, pairTerminal } from '../testing';

/**
 * HTTPS for the LAN hub (DEC-028) against MySQL, with a DNS zone and an ACME authority that
 * live in memory: the hub asks with its LAN address and CSR, the worker publishes the name and
 * the certificate, the location's devices get the hub's HTTPS address, failures wait longer
 * each time and certificates renew 30 days before their end.
 */

const api = createTestApi();
let place: Awaited<ReturnType<typeof createOtherOrganization>>;
let hub: { headers: Record<string, string>; id: string };
let pos: { headers: Record<string, string> };
let csr: string;

class MemoryDns implements DnsProvider {
  records = new Map<string, string>();
  async upsert(record: { type: string; name: string; content: string }) {
    this.records.set(`${record.type} ${record.name}`, record.content);
  }
  async remove(record: { type: string; name: string }) {
    this.records.delete(`${record.type} ${record.name}`);
  }
}

class FakeAuthority implements CertificateAuthority {
  calls: string[] = [];
  failNext = false;
  constructor(private readonly validUntil: () => Date) {}
  async issue({ hostname, dns }: { hostname: string; csrPem: string; dns: DnsProvider }) {
    this.calls.push(hostname);
    await dns.upsert({ type: 'TXT', name: `_acme-challenge.${hostname}`, content: 'proof' });
    await dns.remove({ type: 'TXT', name: `_acme-challenge.${hostname}` });
    if (this.failNext) {
      this.failNext = false;
      throw new Error('rate limited');
    }
    return { certificatePem: `CERT ${this.calls.length}`, notAfter: this.validUntil() };
  }
}

beforeAll(async () => {
  place = await createOtherOrganization(api.db, 'Hub TLS');
  const admin = api.as(place.session);
  const paired = await pairTerminal(api, admin, { prefix: 'HT', type: 'hub', name: 'Hub TLS' });
  hub = { headers: { 'x-terminal-token': paired.deviceToken }, id: paired.id };
  const till = await pairTerminal(api, admin, { prefix: 'KT', type: 'pos' });
  pos = { headers: { 'x-terminal-token': till.deviceToken } };
  const [, request] = await acme.crypto.createCsr({ commonName: 'placeholder.test' });
  csr = request.toString();
});

afterEach(() => {
  delete process.env.HUB_DNS_ZONE;
});

afterAll(async () => {
  await api.close();
});

const ask = (lanIp: string, headers = hub.headers) =>
  api.request('POST', '/sync/hub-certificate', { headers, body: { lanIp, csr } });

describe('hub certificates (DEC-028)', () => {
  it('without a DNS zone the hub stays on HTTP', async () => {
    const status = await api.request('GET', '/sync/hub-certificate', { headers: hub.headers });
    expect(await status.json()).toMatchObject({ enabled: false, hostname: null, status: 'none' });
    expect(await (await ask('192.168.1.20')).json()).toMatchObject({ enabled: false });
  });

  it('issues, publishes the HTTPS address, retries later and renews', async () => {
    process.env.HUB_DNS_ZONE = 'hub.test.example';
    const hostname = `h-${hub.id.replaceAll('-', '').slice(-12)}.hub.test.example`;

    // Only the hub asks, and only for a private LAN address.
    expect((await ask('192.168.1.20', pos.headers)).status).toBe(403);
    expect((await ask('85.1.2.3')).status).toBe(422);

    const asked = await ask('192.168.1.20');
    expect(asked.status).toBe(200);
    expect(await asked.json()).toMatchObject({
      enabled: true,
      hostname,
      url: `https://${hostname}:4443`,
      status: 'pending',
      certificatePem: null,
    });

    let clock = new Date('2026-10-15T12:00:00Z');
    const now = () => clock;
    const dns = new MemoryDns();
    const authority = new FakeAuthority(() => new Date(clock.getTime() + 90 * 86_400_000));
    const round = () => processHubCertificates({ db: api.db, dns, authority, now });

    expect(await round()).toEqual({ issued: 1, failed: 0 });
    expect(dns.records.get(`A ${hostname}`)).toBe('192.168.1.20');
    expect(dns.records.has(`TXT _acme-challenge.${hostname}`)).toBe(false);
    const issued = await api.request('GET', '/sync/hub-certificate', { headers: hub.headers });
    expect(await issued.json()).toMatchObject({
      status: 'issued',
      certificatePem: 'CERT 1',
      lanIp: '192.168.1.20',
    });

    // The location's devices now reach the hub over HTTPS.
    const [location] = await api.db
      .select({ settings: s.locations.settings })
      .from(s.locations)
      .where(eq(s.locations.id, place.locationId));
    expect(parseLocationSettings(location!.settings).sync.hubUrls[0]).toBe(
      `https://${hostname}:4443`,
    );
    const [audit] = await api.db
      .select()
      .from(s.auditEvents)
      .where(
        and(
          eq(s.auditEvents.organizationId, place.organizationId),
          eq(s.auditEvents.action, 'location.hub_url_published'),
        ),
      );
    expect(audit).toBeDefined();

    // The same request again changes nothing.
    expect(await (await ask('192.168.1.20')).json()).toMatchObject({ status: 'issued' });
    expect(await round()).toEqual({ issued: 0, failed: 0 });

    // A new LAN address: a new issue; a failure waits 5 minutes, then succeeds.
    expect(await (await ask('192.168.1.30')).json()).toMatchObject({ status: 'pending' });
    authority.failNext = true;
    expect(await round()).toEqual({ issued: 0, failed: 1 });
    expect(await (await ask('192.168.1.30')).json()).toMatchObject({
      status: 'failed',
      lastError: 'rate limited',
    });
    expect(await round()).toEqual({ issued: 0, failed: 0 });
    clock = new Date(clock.getTime() + 6 * 60_000);
    expect(await round()).toEqual({ issued: 1, failed: 0 });
    expect(dns.records.get(`A ${hostname}`)).toBe('192.168.1.30');

    // 30 days before the end it renews by itself.
    const calls = authority.calls.length;
    clock = new Date(clock.getTime() + 61 * 86_400_000);
    expect(await round()).toEqual({ issued: 1, failed: 0 });
    expect(authority.calls.length).toBe(calls + 1);
  });
});
