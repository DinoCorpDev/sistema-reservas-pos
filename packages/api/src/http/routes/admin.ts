import { createRoute, z } from '@hono/zod-openapi';
import {
  anonymizeCustomerSchema,
  consentInputSchema,
  CONSUMPTION_TYPES,
  createCustomerSchema,
  createSupportGrantSchema,
  createTaxRateSchema,
  createTaxRuleSchema,
  onboardOrganizationSchema,
  SETUP_CHECKS,
  TAX_CATEGORY_KEYS,
  TAX_RATE_CODES,
  updateCustomerSchema,
  updateTaxCategorySchema,
} from '@pos/core';
import * as service from '../../services/admin';
import { actorOf, type ApiApp, staffOf } from '../env';
import {
  AUTHENTICATED,
  ERROR_RESPONSES,
  jsonBody,
  jsonResponse,
  NoContent,
  UuidParam,
} from '../schemas';

// Schemas from @pos/core (and the plain Zod inputs of the services) are used as they are, never
// with `.openapi()`: Zod 4 attaches methods per instance, so the OpenAPI extension does not reach them.

// ── MWST ────────────────────────────────────────────────────────────────────

const TaxCategorySchema = z
  .object({
    id: z.uuid(),
    key: z.string().openapi({ enum: [...TAX_CATEGORY_KEYS] }),
    name: z.string(),
  })
  .openapi('TaxCategory');

const TaxRateSchema = z
  .object({
    id: z.uuid(),
    code: z.string().openapi({ enum: [...TAX_RATE_CODES] }),
    rateBp: z.number().int().openapi({ description: 'Basis points: 8.1 % = 810', example: 810 }),
    validFrom: z.string().openapi({ example: '2024-01-01' }),
    validTo: z.string().nullable().openapi({ description: 'Inclusive; null = open-ended' }),
  })
  .openapi('TaxRate');

const TaxRuleSchema = z
  .object({
    id: z.uuid(),
    taxCategoryId: z.uuid(),
    taxCategoryKey: z.string().openapi({ enum: [...TAX_CATEGORY_KEYS] }),
    consumptionType: z.string().openapi({ enum: [...CONSUMPTION_TYPES] }),
    rateCode: z.string().openapi({ enum: [...TAX_RATE_CODES] }),
    validFrom: z.string(),
    validTo: z.string().nullable(),
  })
  .openapi('TaxRule');

const TaxMatrixEntrySchema = z
  .union([
    z.object({
      taxCategoryKey: z.string(),
      consumptionType: z.string(),
      rateCode: z.string(),
      rateBp: z.number().int(),
    }),
    z.object({
      taxCategoryKey: z.string(),
      consumptionType: z.string(),
      error: z.string().openapi({ example: 'NO_RULE' }),
      message: z.string(),
    }),
  ])
  .openapi('TaxMatrixEntry');

const TaxOverviewSchema = z
  .object({
    date: z
      .string()
      .openapi({ description: 'Date the matrix was resolved for', example: '2026-10-06' }),
    categories: z.array(TaxCategorySchema),
    rates: z.array(TaxRateSchema),
    rules: z.array(TaxRuleSchema),
    matrix: z.array(TaxMatrixEntrySchema),
  })
  .openapi('TaxOverview');

const TaxQuery = z.object({
  date: z.iso.date().optional().openapi({
    description: 'Resolve the matrix on this date (default: today in the location time zone)',
    example: '2026-10-06',
  }),
});

// ── Customers ───────────────────────────────────────────────────────────────

const CustomerSchema = z
  .object({
    id: z.uuid(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    phone: z.string().nullable().openapi({ description: 'E.164', example: '+41791234567' }),
    email: z.string().nullable(),
    language: z.string().nullable(),
    notes: z.string().nullable(),
    declaredAllergies: z.string().nullable(),
    tags: z.array(z.string()),
    anonymizedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Customer');

const ConsentSchema = z
  .object({
    id: z.uuid(),
    locationId: z.uuid().nullable(),
    purpose: z.string(),
    source: z.string(),
    textVersion: z.string(),
    textSnapshot: z.string(),
    grantedAt: z.string(),
    revokedAt: z.string().nullable(),
    recordedByUserId: z.uuid().nullable(),
  })
  .openapi('Consent');

const CustomerDetailSchema = CustomerSchema.extend({ consents: z.array(ConsentSchema) }).openapi(
  'CustomerDetail',
);

const CustomerExportSchema = z
  .object({
    exportedAt: z.string(),
    organizationId: z.uuid(),
    customer: CustomerSchema,
    consents: z.array(ConsentSchema),
  })
  .openapi('CustomerExport');

const CustomerQuery = z.object({
  search: z.string().trim().max(100).optional().openapi({ description: 'Name, phone or email' }),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ── Audit ───────────────────────────────────────────────────────────────────

const AuditEventSchema = z
  .object({
    id: z.uuid(),
    locationId: z.uuid().nullable(),
    action: z.string().openapi({ example: 'tax.rule_changed' }),
    entityType: z.string(),
    entityId: z.uuid().nullable(),
    userId: z.uuid().nullable(),
    authorizedByUserId: z.uuid().nullable(),
    terminalId: z.uuid().nullable(),
    reason: z.string().nullable(),
    before: z.unknown(),
    after: z.unknown(),
    requestId: z.string().nullable(),
    occurredAt: z.string(),
    recordedAt: z.string(),
  })
  .openapi('AuditEvent');

const AuditPageSchema = z
  .object({ items: z.array(AuditEventSchema), nextCursor: z.string().nullable() })
  .openapi('AuditPage');

const instant = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

const AuditQuery = z.object({
  from: instant.optional().openapi({ description: 'Inclusive lower bound of the event time' }),
  to: instant.optional().openapi({ description: 'Exclusive upper bound of the event time' }),
  userId: z.uuid().optional(),
  terminalId: z.uuid().optional(),
  action: z.string().max(64).optional().openapi({ example: 'order.item_voided' }),
  entityType: z.string().max(48).optional(),
  entityId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z
    .string()
    .max(200)
    .optional()
    .openapi({ description: '`nextCursor` of the previous page' }),
});

// ── Setup checklist ─────────────────────────────────────────────────────────

const SetupChecklistSchema = z
  .object({
    locationId: z.uuid(),
    checks: z.array(
      z.object({
        key: z.string().openapi({ enum: [...SETUP_CHECKS] }),
        done: z.boolean(),
        missing: z.number().int().optional(),
      }),
    ),
    done: z.number().int(),
    total: z.number().int(),
    complete: z.boolean(),
    operationActivatedAt: z.string().nullable(),
  })
  .openapi('SetupChecklist');

// ── DINOLABS support ────────────────────────────────────────────────────────

const PlatformOrganizationSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    legalName: z.string().nullable(),
    defaultLanguage: z.string(),
    status: z.string(),
    isTraining: z.boolean(),
    createdAt: z.string(),
    locationsCount: z.number().int(),
    supportGrantExpiresAt: z.string().nullable(),
  })
  .openapi('PlatformOrganization');

const OnboardingResultSchema = z
  .object({
    organizationId: z.uuid(),
    locationId: z.uuid(),
    ownerUserId: z.uuid(),
    ownerEmail: z.string(),
    temporaryPassword: z
      .string()
      .openapi({ description: 'Shown once; must be changed at first sign-in' }),
  })
  .openapi('OnboardingResult');

const SupportGrantSchema = z
  .object({
    id: z.uuid(),
    staffId: z.uuid().nullable(),
    staffDisplayName: z.string().nullable(),
    reason: z.string().nullable(),
    grantedByUserId: z.uuid(),
    expiresAt: z.string(),
    revokedAt: z.string().nullable(),
    createdAt: z.string(),
    active: z.boolean(),
  })
  .openapi('SupportGrant');

const security = AUTHENTICATED;
/** Platform console: DINOLABS support session without an open organization. */
const platformSecurity: Record<string, string[]>[] = [{ session: [] }];

/** Tax, customers, audit, setup checklist and DINOLABS support. */
export function registerAdminRoutes(app: ApiApp) {
  const taxTags = ['MWST'];

  app.openapi(
    createRoute({
      method: 'get',
      path: '/tax',
      tags: taxTags,
      security,
      summary: 'MWST categories, rates, rules and the rate matrix in force (RF-B12, RN-03)',
      request: { query: TaxQuery },
      responses: { 200: jsonResponse(TaxOverviewSchema, 'MWST setup'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.getTaxOverview({ db: c.get('db') }, actorOf(c), c.req.valid('query')),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/tax/categories/{id}',
      tags: taxTags,
      security,
      summary: 'Rename a tax category',
      request: { params: UuidParam, body: jsonBody(updateTaxCategorySchema) },
      responses: { 200: jsonResponse(TaxCategorySchema, 'Renamed category'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.renameTaxCategory(
          { db: c.get('db') },
          actorOf(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/tax/rates',
      tags: taxTags,
      security,
      summary: 'Add a MWST rate from a start date (RF-B13, RN-02)',
      description:
        'Periods of the same code cannot overlap (409). With `closePrevious`, the open rate of the code ' +
        'ends the day before `validFrom`. Past sales keep their frozen rate (RN-04). Audited.',
      request: { body: jsonBody(createTaxRateSchema) },
      responses: { 201: jsonResponse(TaxRateSchema, 'Created rate'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.createTaxRate({ db: c.get('db') }, actorOf(c), c.req.valid('json')),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/tax/rules',
      tags: taxTags,
      security,
      summary:
        'Add a MWST rule (category + consumption type → rate code) from a start date (RN-03)',
      description:
        'Periods of the same category and consumption type cannot overlap (409). With `closePrevious`, ' +
        'the open rule ends the day before `validFrom`. Audited.',
      request: { body: jsonBody(createTaxRuleSchema) },
      responses: { 201: jsonResponse(TaxRuleSchema, 'Created rule'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.createTaxRule({ db: c.get('db') }, actorOf(c), c.req.valid('json')),
        201,
      ),
  );

  const customerTags = ['Customers'];

  app.openapi(
    createRoute({
      method: 'get',
      path: '/customers',
      tags: customerTags,
      security,
      summary: 'Search customers by name, phone or email (RF-E14)',
      description: 'Anonymized customers are not listed (RN-23).',
      request: { query: CustomerQuery },
      responses: { 200: jsonResponse(z.array(CustomerSchema), 'Customers'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.listCustomers({ db: c.get('db') }, actorOf(c), c.req.valid('query')),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/customers',
      tags: customerTags,
      security,
      summary: 'Create a customer with their consent (RF-E14, RF-E16, RN-23)',
      description:
        'Requires the consent and a phone or an email. A phone or email already used in the ' +
        'organization returns 409 with `details.existingCustomerId`.',
      request: { body: jsonBody(createCustomerSchema) },
      responses: {
        201: jsonResponse(CustomerDetailSchema, 'Created customer'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await service.createCustomer({ db: c.get('db') }, actorOf(c), c.req.valid('json')),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/customers/{id}',
      tags: customerTags,
      security,
      summary: 'Get a customer with their consents',
      request: { params: UuidParam },
      responses: { 200: jsonResponse(CustomerDetailSchema, 'Customer'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.getCustomer({ db: c.get('db') }, actorOf(c), c.req.valid('param').id),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/customers/{id}',
      tags: customerTags,
      security,
      summary: 'Update a customer (RF-E15)',
      request: { params: UuidParam, body: jsonBody(updateCustomerSchema) },
      responses: {
        200: jsonResponse(CustomerDetailSchema, 'Updated customer'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await service.updateCustomer(
          { db: c.get('db') },
          actorOf(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/customers/{id}/consents',
      tags: customerTags,
      security,
      summary: 'Record another consent of the customer (RN-23)',
      request: { params: UuidParam, body: jsonBody(consentInputSchema) },
      responses: { 201: jsonResponse(ConsentSchema, 'Recorded consent'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.recordConsent(
          { db: c.get('db') },
          actorOf(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/customers/{id}/anonymize',
      tags: customerTags,
      security,
      summary: 'Anonymize a customer on request (RF-E16, RN-23)',
      description:
        'Wipes the personal data and keeps the row, so sales and receipts stay intact. Audited. ' +
        'Needs `customer.anonymize`.',
      request: { params: UuidParam, body: jsonBody(anonymizeCustomerSchema) },
      responses: {
        200: jsonResponse(CustomerDetailSchema, 'Anonymized customer'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await service.anonymizeCustomer(
          { db: c.get('db') },
          actorOf(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/customers/{id}/export',
      tags: customerTags,
      security,
      summary: 'Export the customer’s data as JSON (RF-E16)',
      request: { params: UuidParam },
      responses: {
        200: jsonResponse(CustomerExportSchema, 'Personal data and consents'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const data = await service.exportCustomer({ db: c.get('db') }, actorOf(c), id);
      c.header('content-disposition', `attachment; filename="customer-${id}.json"`);
      return c.json(data, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/audit-events',
      tags: ['Audit'],
      security,
      summary: 'Query the audit log, newest first (RF-F11, RF-F12)',
      request: { query: AuditQuery },
      responses: {
        200: jsonResponse(AuditPageSchema, 'One page of audit events'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await service.listAuditEvents({ db: c.get('db') }, actorOf(c), c.req.valid('query')),
        200,
      ),
  );

  const setupTags = ['Setup'];

  app.openapi(
    createRoute({
      method: 'get',
      path: '/setup-checklist',
      tags: setupTags,
      security,
      summary: 'What is still missing before the current location can operate (RF-A11)',
      responses: { 200: jsonResponse(SetupChecklistSchema, 'Checklist'), ...ERROR_RESPONSES },
    }),
    async (c) => c.json(await service.getSetupChecklist({ db: c.get('db') }, actorOf(c)), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/setup-checklist/activate',
      tags: setupTags,
      security,
      summary: 'Activate real operation at the current location (RF-A11, Flujo 7)',
      description:
        'Only when every check is done; otherwise 422 RULE_VIOLATION with `details.missing`.',
      responses: { 200: jsonResponse(SetupChecklistSchema, 'Activated'), ...ERROR_RESPONSES },
    }),
    async (c) => c.json(await service.activateOperation({ db: c.get('db') }, actorOf(c)), 200),
  );

  const supportTags = ['DINOLABS support'];

  app.openapi(
    createRoute({
      method: 'get',
      path: '/platform/organizations',
      tags: supportTags,
      security: platformSecurity,
      summary: 'Organizations on the platform (support console, RF-A10)',
      responses: {
        200: jsonResponse(z.array(PlatformOrganizationSchema), 'Organizations'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(await service.listPlatformOrganizations({ db: c.get('db') }, staffOf(c)), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/platform/organizations',
      tags: supportTags,
      security: platformSecurity,
      summary:
        'Onboard a new restaurant: organization, location and owner (Flujo 7, RF-A01, RF-A02)',
      description:
        'Copies the roles and the Swiss MWST setup into the organization. The owner’s temporary ' +
        'password is returned once and must be changed at the first sign-in. Audited.',
      request: { body: jsonBody(onboardOrganizationSchema) },
      responses: {
        201: jsonResponse(OnboardingResultSchema, 'Created organization'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await service.onboardOrganization({ db: c.get('db') }, staffOf(c), c.req.valid('json')),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/support-grants',
      tags: supportTags,
      security,
      summary: 'Support access granted by the organization (RF-A10)',
      responses: { 200: jsonResponse(z.array(SupportGrantSchema), 'Grants'), ...ERROR_RESPONSES },
    }),
    async (c) => c.json(await service.listSupportGrants({ db: c.get('db') }, actorOf(c)), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/support-grants',
      tags: supportTags,
      security,
      summary: 'Let DINOLABS support in for a limited time (RF-A10)',
      description: 'Between 1 and 72 hours. Everything support does is audited.',
      request: { body: jsonBody(createSupportGrantSchema) },
      responses: { 201: jsonResponse(SupportGrantSchema, 'Granted access'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.grantSupportAccess({ db: c.get('db') }, actorOf(c), c.req.valid('json')),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/support-grants/{id}',
      tags: supportTags,
      security,
      summary: 'Revoke support access now (RF-A10)',
      request: { params: UuidParam },
      responses: { 204: NoContent, ...ERROR_RESPONSES },
    }),
    async (c) => {
      await service.revokeSupportGrant({ db: c.get('db') }, actorOf(c), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );
}
