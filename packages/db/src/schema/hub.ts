import { index, int, mysqlTable, text, varchar } from 'drizzle-orm/mysql-core';
import { locationId, organizationId, utcDatetime, uuid } from '../columns';

/**
 * Certificate of a LAN hub (DEC-028): the hub asks with its LAN address and a CSR (its private
 * key never leaves it); the cloud's worker publishes the DNS name and obtains the certificate
 * with ACME DNS-01, and renews it 30 days before the end. `id` is the hub's terminal id.
 * Cloud only, out of the configuration version.
 */
export const hubCertificates = mysqlTable(
  'hub_certificates',
  {
    id: uuid('id').primaryKey(),
    organizationId: organizationId(),
    locationId: locationId(),
    hostname: varchar('hostname', { length: 253 }).notNull(),
    lanIp: varchar('lan_ip', { length: 45 }).notNull(),
    csrPem: text('csr_pem').notNull(),
    /** pending (to issue), issued or failed (retried later); see HUB_CERTIFICATE_STATUSES. */
    status: varchar('status', { length: 16 }).notNull(),
    certificatePem: text('certificate_pem'),
    notAfter: utcDatetime('not_after'),
    issuedAt: utcDatetime('issued_at'),
    failures: int('failures').notNull().default(0),
    lastError: varchar('last_error', { length: 500 }),
    nextAttemptAt: utcDatetime('next_attempt_at'),
    requestedAt: utcDatetime('requested_at').notNull(),
  },
  (t) => [index('idx_hub_certificates_status').on(t.status, t.nextAttemptAt)],
);
