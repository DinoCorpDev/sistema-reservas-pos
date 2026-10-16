import { describe, expect, it } from 'vitest';
import {
  HUB_TLS_PORT,
  hubCertificateDue,
  hubCertificateRequestSchema,
  hubCertificateRetryDelayMs,
  hubHostname,
  hubTlsUrl,
  isPrivateLanAddress,
} from './hub-tls';

const CSR = '-----BEGIN CERTIFICATE REQUEST-----\nMIIC\n-----END CERTIFICATE REQUEST-----';

describe('hub HTTPS (DEC-028)', () => {
  it('names a hub after the random end of its terminal id, in the zone', () => {
    expect(hubHostname('01920000-0000-7abc-8def-0123456789AB', 'Hub.Example.CH.')).toBe(
      'h-0123456789ab.hub.example.ch',
    );
    expect(hubTlsUrl('h-0123456789ab.hub.example.ch')).toBe(
      `https://h-0123456789ab.hub.example.ch:${HUB_TLS_PORT}`,
    );
  });

  it('accepts only private LAN addresses (RFC 1918)', () => {
    for (const ip of ['10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.20']) {
      expect(isPrivateLanAddress(ip)).toBe(true);
    }
    for (const ip of [
      '8.8.8.8',
      '172.15.0.1',
      '172.32.0.1',
      '192.169.0.1',
      '127.0.0.1',
      '10.0.0',
      '10.0.0.256',
      'fe80::1',
      '',
    ]) {
      expect(isPrivateLanAddress(ip)).toBe(false);
    }
  });

  it('renews 30 days before the end, and asks when there is none', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    expect(hubCertificateDue(null, now)).toBe(true);
    expect(hubCertificateDue(new Date('2026-11-14T13:00:00Z'), now)).toBe(false);
    expect(hubCertificateDue(new Date('2026-11-14T11:00:00Z'), now)).toBe(true);
  });

  it('waits longer after each failure, at most 6 hours', () => {
    expect(hubCertificateRetryDelayMs(1)).toBe(5 * 60_000);
    expect(hubCertificateRetryDelayMs(2)).toBe(10 * 60_000);
    expect(hubCertificateRetryDelayMs(20)).toBe(6 * 60 * 60_000);
  });

  it('validates what the hub sends', () => {
    expect(hubCertificateRequestSchema.safeParse({ lanIp: '192.168.1.20', csr: CSR }).success).toBe(
      true,
    );
    expect(hubCertificateRequestSchema.safeParse({ lanIp: '85.1.2.3', csr: CSR }).success).toBe(
      false,
    );
    expect(
      hubCertificateRequestSchema.safeParse({ lanIp: '192.168.1.20', csr: 'hello' }).success,
    ).toBe(false);
  });
});
