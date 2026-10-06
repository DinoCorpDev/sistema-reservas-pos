import {
  anonymizedCustomerPatch,
  type AnonymizeCustomerInput,
  type ConsentInput,
  type CreateCustomerInput,
  newId,
  normalizePhone,
  type UpdateCustomerInput,
} from '@pos/core';
import { type Database, inOrg, notDeleted, runCommand, schema as s } from '@pos/db';
import { asc, eq, isNull, like, ne, or, type SQL, sql } from 'drizzle-orm';
import { type Actor, assertPermission } from '../../actor';
import { ApiError, notFound } from '../../errors';
import { changedFields, definedOnly, iso, type ServiceDeps } from '../shared';
import { commandContext, escapeLike } from './common';

/**
 * Customers (RF-E14…RF-E16, RN-23): one customer per phone or email in the organization, always
 * created with a recorded consent. Personal data never goes into audit records or event payloads
 * (both are kept for years and cannot be anonymized), only ids and consent metadata.
 */

type CustomerRow = typeof s.customers.$inferSelect;
type ConsentRow = typeof s.consents.$inferSelect;

export interface CustomerDto {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  language: string | null;
  notes: string | null;
  declaredAllergies: string | null;
  tags: string[];
  anonymizedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConsentDto {
  id: string;
  locationId: string | null;
  purpose: string;
  source: string;
  textVersion: string;
  textSnapshot: string;
  grantedAt: string;
  revokedAt: string | null;
  recordedByUserId: string | null;
}

export interface CustomerDetailDto extends CustomerDto {
  consents: ConsentDto[];
}

/** Data export on the customer's request (RF-E16): personal data and consents as JSON. */
export interface CustomerExportDto {
  exportedAt: string;
  organizationId: string;
  customer: CustomerDto;
  consents: ConsentDto[];
}

export const toCustomerDto = (row: CustomerRow): CustomerDto => ({
  id: row.id,
  firstName: row.firstName,
  lastName: row.lastName,
  phone: row.phone,
  email: row.email,
  language: row.language,
  notes: row.notes,
  declaredAllergies: row.declaredAllergies,
  tags: row.tags ?? [],
  anonymizedAt: iso(row.anonymizedAt),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const toConsentDto = (row: ConsentRow): ConsentDto => ({
  id: row.id,
  locationId: row.locationId,
  purpose: row.purpose,
  source: row.source,
  textVersion: row.textVersion,
  textSnapshot: row.textSnapshot,
  grantedAt: row.grantedAt.toISOString(),
  revokedAt: iso(row.revokedAt),
  recordedByUserId: row.recordedByUserId,
});

async function loadCustomer(db: Database, actor: Actor, id: string) {
  const [row] = await db
    .select()
    .from(s.customers)
    .where(inOrg(s.customers, actor, eq(s.customers.id, id), notDeleted(s.customers)));
  if (!row) throw notFound('Customer');
  return row;
}

async function loadConsents(db: Database, actor: Actor, customerId: string) {
  const rows = await db
    .select()
    .from(s.consents)
    .where(inOrg(s.consents, actor, eq(s.consents.customerId, customerId), notDeleted(s.consents)))
    .orderBy(asc(s.consents.grantedAt));
  return rows.map(toConsentDto);
}

async function detail(db: Database, actor: Actor, id: string): Promise<CustomerDetailDto> {
  const row = await loadCustomer(db, actor, id);
  return { ...toCustomerDto(row), consents: await loadConsents(db, actor, id) };
}

function assertNotAnonymized(row: CustomerRow) {
  if (row.anonymizedAt) {
    throw new ApiError('CONFLICT', 'The customer was anonymized; their data can no longer change');
  }
}

/** E.164 phone and lower-case email, the forms the uniqueness checks rely on (RF-E14). */
function normalizeContact<T extends { phone?: string | null; email?: string | null }>(input: T) {
  let phone = input.phone;
  if (phone) {
    const normalized = normalizePhone(phone);
    if (!normalized) {
      throw new ApiError('VALIDATION_FAILED', 'Invalid phone number', { path: ['phone'] });
    }
    phone = normalized;
  }
  const email = input.email ? input.email.trim().toLowerCase() : input.email;
  return { ...input, phone, email };
}

/** The same phone or email already belongs to another customer of the organization → 409. */
async function assertUniqueContact(
  db: Database,
  actor: Actor,
  contact: { phone?: string | null; email?: string | null },
  exceptId?: string,
) {
  const matches: SQL[] = [];
  if (contact.phone) matches.push(eq(s.customers.phone, contact.phone));
  if (contact.email) matches.push(eq(s.customers.email, contact.email));
  if (matches.length === 0) return;
  // No soft-delete filter: the unique indexes cover every row.
  const [existing] = await db
    .select({ id: s.customers.id })
    .from(s.customers)
    .where(
      inOrg(
        s.customers,
        actor,
        or(...matches),
        exceptId ? ne(s.customers.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (existing) {
    throw new ApiError('CONFLICT', 'A customer with this phone number or email already exists', {
      existingCustomerId: existing.id,
    });
  }
}

const consentValues = (actor: Actor, customerId: string, consent: ConsentInput) => ({
  id: newId(),
  organizationId: actor.organizationId,
  locationId: actor.locationId ?? null,
  customerId,
  purpose: consent.purpose,
  source: consent.source,
  textVersion: consent.textVersion,
  textSnapshot: consent.textSnapshot,
  grantedAt: new Date(),
  recordedByUserId: actor.userId ?? null,
});

const consentMetadata = (consent: ConsentInput) => ({
  purpose: consent.purpose,
  source: consent.source,
  textVersion: consent.textVersion,
});

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * Quick search by name, phone or email (RF-E14, RF-E17). Anonymized customers are not listed:
 * their personal data is gone and they cannot be found by it any more (RN-23).
 */
export async function listCustomers(
  deps: ServiceDeps,
  actor: Actor,
  query: { search?: string; limit?: number } = {},
): Promise<CustomerDto[]> {
  assertPermission(actor, 'customer.manage');
  const search = query.search?.trim();
  let matches: SQL | undefined;
  if (search) {
    const term = `%${escapeLike(search)}%`;
    const compact = search.replace(/[\s\-./()]/g, '');
    const phone = normalizePhone(search);
    matches = or(
      sql`concat_ws(' ', ${s.customers.firstName}, ${s.customers.lastName}) like ${term}`,
      sql`concat_ws(' ', ${s.customers.lastName}, ${s.customers.firstName}) like ${term}`,
      like(s.customers.email, term),
      compact ? like(s.customers.phone, `%${escapeLike(compact)}%`) : undefined,
      phone ? eq(s.customers.phone, phone) : undefined,
    );
  }
  const rows = await deps.db
    .select()
    .from(s.customers)
    .where(
      inOrg(s.customers, actor, notDeleted(s.customers), isNull(s.customers.anonymizedAt), matches),
    )
    .orderBy(asc(s.customers.lastName), asc(s.customers.firstName), asc(s.customers.id))
    .limit(Math.min(Math.max(query.limit ?? 20, 1), 100));
  return rows.map(toCustomerDto);
}

export async function getCustomer(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
): Promise<CustomerDetailDto> {
  assertPermission(actor, 'customer.manage');
  return detail(deps.db, actor, id);
}

// ── Commands ────────────────────────────────────────────────────────────────

/** New customer with their consent (RN-23); duplicates by phone or email are refused (RF-E14). */
export async function createCustomer(
  deps: ServiceDeps,
  actor: Actor,
  input: CreateCustomerInput,
): Promise<CustomerDetailDto> {
  assertPermission(actor, 'customer.manage');
  const { consent, ...fields } = normalizeContact(input);
  if (!fields.phone && !fields.email) {
    throw new ApiError('VALIDATION_FAILED', 'A phone number or an email is required', {
      path: ['phone'],
    });
  }
  await assertUniqueContact(deps.db, actor, fields);

  const customerId = newId();
  await runCommand(deps.db, commandContext(actor), async (tx, recorder) => {
    await tx
      .insert(s.customers)
      .values({ ...fields, id: customerId, organizationId: actor.organizationId });
    const consentRow = consentValues(actor, customerId, consent);
    await tx.insert(s.consents).values(consentRow);
    recorder.audit({
      action: 'customer.created',
      entityType: 'customer',
      entityId: customerId,
      after: { consent: consentMetadata(consent) },
    });
    recorder.event({
      type: 'customer.created',
      aggregateType: 'customer',
      aggregateId: customerId,
      payload: { customerId, source: consent.source },
    });
    recorder.event({
      type: 'customer.consent_recorded',
      aggregateType: 'customer',
      aggregateId: customerId,
      payload: { customerId, consentId: consentRow.id, ...consentMetadata(consent) },
    });
  });
  return detail(deps.db, actor, customerId);
}

export async function updateCustomer(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: UpdateCustomerInput,
): Promise<CustomerDetailDto> {
  assertPermission(actor, 'customer.manage');
  const current = await loadCustomer(deps.db, actor, id);
  assertNotAnonymized(current);
  const patch = definedOnly(normalizeContact(input));
  const phone = patch.phone === undefined ? current.phone : patch.phone;
  const email = patch.email === undefined ? current.email : patch.email;
  if (!phone && !email) {
    throw new ApiError('VALIDATION_FAILED', 'A phone number or an email is required', {
      path: ['phone'],
    });
  }
  await assertUniqueContact(
    deps.db,
    actor,
    {
      phone: patch.phone === undefined ? null : phone,
      email: patch.email === undefined ? null : email,
    },
    id,
  );

  const changed = Object.keys(
    changedFields(current as unknown as Record<string, unknown>, patch).after,
  );
  if (changed.length > 0) {
    await runCommand(deps.db, commandContext(actor), async (tx, recorder) => {
      await tx
        .update(s.customers)
        .set(patch)
        .where(inOrg(s.customers, actor, eq(s.customers.id, id)));
      // Only the names of the changed fields: the values are personal data (RN-23).
      recorder.audit({
        action: 'customer.updated',
        entityType: 'customer',
        entityId: id,
        after: { fields: changed },
      });
    });
  }
  return detail(deps.db, actor, id);
}

/** Additional consent, e.g. marketing (RN-23: date, channel and accepted text). */
export async function recordConsent(
  deps: ServiceDeps,
  actor: Actor,
  customerId: string,
  input: ConsentInput,
): Promise<ConsentDto> {
  assertPermission(actor, 'customer.manage');
  assertNotAnonymized(await loadCustomer(deps.db, actor, customerId));
  const values = consentValues(actor, customerId, input);
  await runCommand(deps.db, commandContext(actor), async (tx, recorder) => {
    await tx.insert(s.consents).values(values);
    recorder.audit({
      action: 'customer.consent_recorded',
      entityType: 'customer',
      entityId: customerId,
      after: { consentId: values.id, ...consentMetadata(input) },
    });
    recorder.event({
      type: 'customer.consent_recorded',
      aggregateType: 'customer',
      aggregateId: customerId,
      payload: { customerId, consentId: values.id, ...consentMetadata(input) },
    });
  });
  const [row] = await deps.db
    .select()
    .from(s.consents)
    .where(inOrg(s.consents, actor, eq(s.consents.id, values.id)));
  return toConsentDto(row!);
}

/**
 * Erasure request (RF-E16, RN-23): personal data is wiped, the row stays so visits, orders and
 * receipts keep their integrity. Open consents end with it.
 */
export async function anonymizeCustomer(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: AnonymizeCustomerInput,
): Promise<CustomerDetailDto> {
  assertPermission(actor, 'customer.anonymize');
  assertNotAnonymized(await loadCustomer(deps.db, actor, id));
  const now = new Date();
  await runCommand(deps.db, commandContext(actor), async (tx, recorder) => {
    await tx
      .update(s.customers)
      .set(anonymizedCustomerPatch(now))
      .where(inOrg(s.customers, actor, eq(s.customers.id, id)));
    await tx
      .update(s.consents)
      .set({ revokedAt: now })
      .where(inOrg(s.consents, actor, eq(s.consents.customerId, id), isNull(s.consents.revokedAt)));
    recorder.audit({
      action: 'customer.anonymized',
      entityType: 'customer',
      entityId: id,
      reason: input.reason,
      after: { anonymizedAt: now.toISOString() },
    });
    recorder.event({
      type: 'customer.anonymized',
      aggregateType: 'customer',
      aggregateId: id,
      payload: { customerId: id, anonymizedAt: now.toISOString() },
    });
  });
  return detail(deps.db, actor, id);
}

/** Everything stored about the customer, as JSON (RF-E16). The export itself is audited. */
export async function exportCustomer(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
): Promise<CustomerExportDto> {
  assertPermission(actor, 'customer.manage');
  const row = await loadCustomer(deps.db, actor, id);
  const consents = await loadConsents(deps.db, actor, id);
  const exportedAt = new Date();
  await runCommand(deps.db, commandContext(actor), async (_tx, recorder) => {
    recorder.audit({
      action: 'customer.exported',
      entityType: 'customer',
      entityId: id,
      after: { exportedAt: exportedAt.toISOString() },
    });
  });
  return {
    exportedAt: exportedAt.toISOString(),
    organizationId: actor.organizationId,
    customer: toCustomerDto(row),
    consents,
  };
}
