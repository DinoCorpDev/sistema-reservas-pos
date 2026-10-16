import {
  type HubCertificateRequest,
  type HubCertificateStatus,
  hubCertificateDue,
  hubCertificateRetryDelayMs,
  hubHostname,
  hubTlsUrl,
  parseLocationSettings,
} from '@pos/core';
import { type Database, type Logger, loggableError, runCommand, schema as s } from '@pos/db';
import { and, asc, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { type Actor, requireTerminal } from '../../actor';
import { ApiError, notFound } from '../../errors';
import type { CertificateAuthority, DnsProvider } from '../platform/hub-tls-providers';
import type { ServiceDeps } from '../shared';
import { forgetConfigVersion } from './config-version';
import type { SyncNode } from './push';

/**
 * HTTPS for the LAN hub (DEC-028). The hub asks the cloud with its LAN address and a CSR; the
 * cloud's worker publishes `h-<id>.<zone>` → LAN address, obtains the certificate with ACME
 * DNS-01, renews it 30 days before the end, and adds the hub's HTTPS address to the location's
 * hubs so the POS and the KDS use it. Without `HUB_DNS_ZONE` the feature is off and the hub
 * keeps plain HTTP (development, a hub on `localhost`).
 */

export const hubDnsZone = (): string | null => process.env.HUB_DNS_ZONE?.trim() || null;

export interface HubCertificateDto {
  /** Off without a DNS zone in the cloud. */
  enabled: boolean;
  hostname: string | null;
  url: string | null;
  status: HubCertificateStatus;
  lanIp: string | null;
  certificatePem: string | null;
  notAfter: string | null;
  lastError: string | null;
}

type Row = typeof s.hubCertificates.$inferSelect;

function hubOf(deps: ServiceDeps & { node?: SyncNode }, actor: Actor) {
  const { terminalId, locationId } = requireTerminal(actor);
  if (actor.terminalType !== 'hub') {
    throw new ApiError('FORBIDDEN', 'Only the location hub asks for its certificate');
  }
  // The hub serves the same sync routes; the certificate lives in the cloud only.
  if (deps.node && deps.node.kind !== 'cloud') throw notFound('Route');
  return { terminalId, locationId };
}

const toDto = (
  zone: string | null,
  hostname: string | null,
  row: Row | null,
): HubCertificateDto => ({
  enabled: zone !== null,
  hostname,
  url: hostname ? hubTlsUrl(hostname) : null,
  status: (row?.status as HubCertificateStatus | undefined) ?? 'none',
  lanIp: row?.lanIp ?? null,
  certificatePem: row?.status === 'issued' ? row.certificatePem : null,
  notAfter: row?.notAfter?.toISOString() ?? null,
  lastError: row?.lastError ?? null,
});

async function loadRow(db: Database, terminalId: string) {
  const [row] = await db
    .select()
    .from(s.hubCertificates)
    .where(eq(s.hubCertificates.id, terminalId));
  return row ?? null;
}

/** `GET /sync/hub-certificate`: the hub's name and the state of its certificate. */
export async function getHubCertificate(
  deps: ServiceDeps & { node?: SyncNode },
  actor: Actor,
): Promise<HubCertificateDto> {
  const { terminalId } = hubOf(deps, actor);
  const zone = hubDnsZone();
  const row = await loadRow(deps.db, terminalId);
  return toDto(zone, zone ? hubHostname(terminalId, zone) : null, row);
}

/**
 * `POST /sync/hub-certificate`: the hub's LAN address and CSR. The same request again changes
 * nothing; a new address, a new key or a certificate close to its end queue a new issue.
 */
export async function requestHubCertificate(
  deps: ServiceDeps & { node?: SyncNode },
  actor: Actor,
  input: HubCertificateRequest,
  now = new Date(),
): Promise<HubCertificateDto> {
  const { terminalId, locationId } = hubOf(deps, actor);
  const zone = hubDnsZone();
  if (!zone) return toDto(null, null, null);
  const hostname = hubHostname(terminalId, zone);
  const csrPem = input.csr.trim();
  const current = await loadRow(deps.db, terminalId);
  const unchanged =
    current !== null &&
    current.hostname === hostname &&
    current.lanIp === input.lanIp &&
    current.csrPem === csrPem;
  const settled =
    unchanged &&
    (current.status === 'pending' ||
      current.status === 'failed' ||
      (current.status === 'issued' && !hubCertificateDue(current.notAfter, now)));
  if (settled) return toDto(zone, hostname, current);

  const pending = {
    hostname,
    lanIp: input.lanIp,
    csrPem,
    status: 'pending',
    failures: 0,
    lastError: null,
    nextAttemptAt: null,
    requestedAt: now,
  };
  if (current) {
    await deps.db
      .update(s.hubCertificates)
      .set(pending)
      .where(eq(s.hubCertificates.id, terminalId));
  } else {
    await deps.db.insert(s.hubCertificates).values({
      id: terminalId,
      organizationId: actor.organizationId,
      locationId,
      ...pending,
    });
  }
  // Meanwhile the hub keeps serving the certificate it has.
  return toDto(zone, hostname, await loadRow(deps.db, terminalId));
}

/** Puts the hub's HTTPS address first among the location's hubs (docs/SYNC.md §11). */
async function publishHubUrl(db: Database, row: Row, url: string): Promise<void> {
  const [location] = await db
    .select({ settings: s.locations.settings })
    .from(s.locations)
    .where(
      and(eq(s.locations.id, row.locationId), eq(s.locations.organizationId, row.organizationId)),
    );
  if (!location) return;
  const settings = parseLocationSettings(location.settings);
  const host = new URL(url).hostname;
  const others = settings.sync.hubUrls.filter((existing) => {
    try {
      return new URL(existing).hostname !== host;
    } catch {
      return true;
    }
  });
  const hubUrls = [url, ...others].slice(0, 3);
  if (JSON.stringify(hubUrls) === JSON.stringify(settings.sync.hubUrls)) return;
  const ctx = {
    organizationId: row.organizationId,
    locationId: row.locationId,
    userId: null,
    terminalId: row.id,
    requestId: `hub-certificate:${row.id}`,
  };
  await runCommand(db, ctx, async (tx, recorder) => {
    await tx
      .update(s.locations)
      .set({ settings: { ...settings, sync: { ...settings.sync, hubUrls } } })
      .where(eq(s.locations.id, row.locationId));
    recorder.audit({
      action: 'location.hub_url_published',
      entityType: 'location',
      entityId: row.locationId,
      before: { hubUrls: settings.sync.hubUrls },
      after: { hubUrls },
    });
  });
  forgetConfigVersion({ organizationId: row.organizationId, locationId: row.locationId });
}

/**
 * The worker's round: issues what is pending (and due again after a failure) and queues the
 * renewals. A failure is kept with its reason and retried later, doubling the wait.
 */
export async function processHubCertificates(options: {
  db: Database;
  dns: DnsProvider;
  authority: CertificateAuthority;
  logger?: Logger;
  now?: () => Date;
}): Promise<{ issued: number; failed: number }> {
  const now = options.now ?? (() => new Date());
  const { db } = options;
  const result = { issued: 0, failed: 0 };

  // Renewals: an issued certificate close to its end goes back to pending with the same CSR.
  const issued = await db
    .select()
    .from(s.hubCertificates)
    .where(eq(s.hubCertificates.status, 'issued'));
  const due = issued.filter((row) => hubCertificateDue(row.notAfter, now())).map((row) => row.id);
  if (due.length > 0) {
    await db
      .update(s.hubCertificates)
      .set({ status: 'pending', failures: 0, nextAttemptAt: null })
      .where(inArray(s.hubCertificates.id, due));
  }

  const queue = await db
    .select()
    .from(s.hubCertificates)
    .where(
      or(
        and(eq(s.hubCertificates.status, 'pending'), isNull(s.hubCertificates.nextAttemptAt)),
        and(
          inArray(s.hubCertificates.status, ['pending', 'failed']),
          lte(s.hubCertificates.nextAttemptAt, now()),
        ),
      ),
    )
    .orderBy(asc(s.hubCertificates.requestedAt))
    .limit(20);

  for (const row of queue) {
    try {
      await options.dns.upsert({ type: 'A', name: row.hostname, content: row.lanIp });
      const certificate = await options.authority.issue({
        hostname: row.hostname,
        csrPem: row.csrPem,
        dns: options.dns,
      });
      await db
        .update(s.hubCertificates)
        .set({
          status: 'issued',
          certificatePem: certificate.certificatePem,
          notAfter: certificate.notAfter,
          issuedAt: now(),
          failures: 0,
          lastError: null,
          nextAttemptAt: null,
        })
        .where(eq(s.hubCertificates.id, row.id));
      await publishHubUrl(db, row, hubTlsUrl(row.hostname));
      options.logger?.info('hub certificate issued', {
        organizationId: row.organizationId,
        locationId: row.locationId,
        terminalId: row.id,
        hostname: row.hostname,
        notAfter: certificate.notAfter.toISOString(),
      });
      result.issued += 1;
    } catch (error) {
      const failures = row.failures + 1;
      await db
        .update(s.hubCertificates)
        .set({
          status: 'failed',
          failures,
          lastError: String(error instanceof Error ? error.message : error).slice(0, 500),
          nextAttemptAt: new Date(now().getTime() + hubCertificateRetryDelayMs(failures)),
        })
        .where(eq(s.hubCertificates.id, row.id));
      options.logger?.warn('hub certificate failed', {
        organizationId: row.organizationId,
        locationId: row.locationId,
        terminalId: row.id,
        hostname: row.hostname,
        failures,
        error: loggableError(error),
      });
      result.failed += 1;
    }
  }
  return result;
}
