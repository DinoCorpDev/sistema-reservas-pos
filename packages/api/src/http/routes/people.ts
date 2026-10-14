import { createRoute, z } from '@hono/zod-openapi';
import {
  approvalRequestSchema,
  CONTENT_LANGUAGES,
  createApiKeySchema,
  createKitchenStationSchema,
  createPrinterSchema,
  createTerminalSchema,
  createUserSchema,
  PERMISSIONS,
  PRINTER_KINDS,
  PRINTER_PROTOCOLS,
  pairTerminalSchema,
  ROLE_KEYS,
  setPasswordSchema,
  setPinSchema,
  setRolePermissionsSchema,
  TERMINAL_TYPES,
  UI_LANGUAGES,
  unlockSchema,
  updateKitchenStationSchema,
  updatePrinterSchema,
  updateTerminalSchema,
  updateUserSchema,
} from '@pos/core';
import { API_KEY_SCOPE_NAMES } from '../../auth/api-keys';
import * as service from '../../services/people';
import { actorOf, type ApiApp } from '../env';
import {
  AUTHENTICATED,
  ERROR_RESPONSES,
  ErrorSchema,
  jsonBody,
  jsonResponse,
  NoContent,
  UuidParam,
} from '../schemas';

// Request bodies are the plain Zod schemas of @pos/core (never `.openapi()` on them).

const PrinterSchema = z
  .object({
    id: z.uuid(),
    locationId: z.uuid(),
    name: z.string(),
    kind: z.string().openapi({ enum: [...PRINTER_KINDS] }),
    protocol: z.string().openapi({ enum: [...PRINTER_PROTOCOLS] }),
    host: z.string().openapi({ example: '192.168.1.50' }),
    port: z.number().int(),
    paperWidthMm: z
      .number()
      .int()
      .openapi({ enum: [58, 80] }),
    hasCashDrawer: z.boolean(),
    isActive: z.boolean(),
    lastTestAt: z.string().nullable(),
    lastTestOk: z.boolean().nullable(),
    testRequestedAt: z.string().nullable().openapi({
      description: 'A test page is pending at the location hub until lastTestAt passes this time',
    }),
    lastOkAt: z.string().nullable().openapi({ description: 'Last job the hub printed' }),
    lastError: z.string().nullable(),
    lastErrorAt: z.string().nullable(),
  })
  .openapi('Printer');

const KitchenStationSchema = z
  .object({
    id: z.uuid(),
    locationId: z.uuid(),
    name: z.string(),
    alertAfterMinutes: z.number().int().nullable().openapi({
      description: 'null = the location default (settings.kitchen.alertAfterMinutes)',
    }),
    language: z
      .string()
      .nullable()
      .openapi({
        enum: [...CONTENT_LANGUAGES],
        description: 'null = the location kitchen language',
      }),
    printerId: z.uuid().nullable(),
    fallbackStationId: z.uuid().nullable().openapi({
      description: 'If nobody is at this station, its tickets go there (DEC-033)',
    }),
    sortOrder: z.number().int(),
    isActive: z.boolean(),
  })
  .openapi('KitchenStation');

const TerminalSchema = z
  .object({
    id: z.uuid(),
    locationId: z.uuid(),
    name: z.string(),
    type: z.string().openapi({ enum: [...TERMINAL_TYPES] }),
    orderNumberPrefix: z.string().openapi({ description: 'Offline order-number prefix (RN-16)' }),
    kitchenStationId: z.uuid().nullable(),
    receiptPrinterId: z.uuid().nullable(),
    appVersion: z.string().nullable(),
    lastSeenAt: z.string().nullable(),
    isPaired: z.boolean(),
    pairedAt: z.string().nullable(),
    pairingExpiresAt: z
      .string()
      .nullable()
      .openapi({ description: 'Expiry of the pending pairing code' }),
    isActive: z.boolean(),
    deactivatedAt: z.string().nullable(),
    userId: z
      .uuid()
      .nullable()
      .openapi({ description: 'The waiter who owns this phone (type phone, DEC-036)' }),
    userName: z.string().nullable().openapi({ description: 'Name of that waiter, in lists' }),
  })
  .openapi('Terminal');

const PairingCodeSchema = z
  .object({
    code: z.string().openapi({ example: 'K7QM-4XPA', description: 'Shown once; valid 15 minutes' }),
    expiresAt: z.string(),
  })
  .openapi('PairingCode');

const PairedTerminalSchema = z
  .object({
    deviceToken: z.string().openapi({ description: 'Returned once; send it as X-Terminal-Token' }),
    terminal: TerminalSchema,
    location: z.object({
      id: z.uuid(),
      name: z.string(),
      timezone: z.string(),
      defaultLanguage: z.string(),
      kitchenLanguage: z.string(),
    }),
    organizationId: z.uuid(),
    user: z
      .object({
        id: z.uuid(),
        displayName: z.string(),
        uiLanguage: z.string().openapi({ enum: [...UI_LANGUAGES] }),
        permissions: z.array(z.string().openapi({ enum: [...PERMISSIONS] })),
      })
      .optional()
      .openapi({ description: 'For a waiter phone: its owner, already unlocked (DEC-036)' }),
  })
  .openapi('PairedTerminal');

const PosSessionSchema = z
  .object({
    token: z
      .string()
      .openapi({ description: 'POS session: Authorization: Bearer <token> + X-Terminal-Token' }),
    expiresAt: z.string(),
    user: z.object({
      id: z.uuid(),
      displayName: z.string(),
      uiLanguage: z.string().openapi({ enum: [...UI_LANGUAGES] }),
      permissions: z.array(z.string().openapi({ enum: [...PERMISSIONS] })),
    }),
  })
  .openapi('PosSession');

const ApprovalSchema = z
  .object({
    approvalToken: z
      .string()
      .openapi({ description: 'Send it as X-Approval with the approved action' }),
    expiresAt: z.string(),
    approver: z.object({ id: z.uuid(), displayName: z.string() }),
  })
  .openapi('Approval');

const OfflineCredentialsSchema = z
  .object({
    pinKey: z
      .string()
      .nullable()
      .openapi({ description: 'HMAC key that turns a PIN into its lookup' }),
    users: z.array(
      z.object({
        id: z.uuid(),
        displayName: z.string(),
        uiLanguage: z.string(),
        pinHash: z.string().openapi({ description: 'argon2id hash of the PIN' }),
        pinBucket: z.number().int().min(0).max(15).openapi({
          description:
            'First 4 bits of HMAC(pinKey, PIN): picks the candidates to verify (DEC-023)',
        }),
        permissions: z.array(z.string().openapi({ enum: [...PERMISSIONS] })),
      }),
    ),
  })
  .openapi('OfflineCredentials');

const UserSchema = z
  .object({
    id: z.uuid(),
    displayName: z.string(),
    email: z.string().nullable(),
    uiLanguage: z.string().openapi({ enum: [...UI_LANGUAGES] }),
    roles: z.array(z.string().openapi({ enum: [...ROLE_KEYS] })),
    locationIds: z.array(z.uuid()),
    hasPin: z.boolean(),
    hasPassword: z.boolean(),
    twoFactorEnabled: z.boolean(),
    mustChangePassword: z.boolean(),
    isActive: z.boolean(),
    lastLoginAt: z.string().nullable(),
    deactivatedAt: z.string().nullable(),
  })
  .openapi('User');

const RoleSchema = z
  .object({
    id: z.uuid(),
    key: z.string(),
    name: z.string(),
    isSystem: z.boolean(),
    permissions: z.array(z.string().openapi({ enum: [...PERMISSIONS] })),
  })
  .openapi('Role');

const ApiKeyFields = {
  id: z.uuid(),
  name: z.string(),
  keyPrefix: z.string().openapi({ example: 'pos_live_ab12cd34' }),
  scopes: z.array(z.string().openapi({ enum: [...API_KEY_SCOPE_NAMES] })),
  createdByUserId: z.uuid().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
};
const ApiKeySchema = z.object(ApiKeyFields).openapi('ApiKey');
const CreatedApiKeySchema = z
  .object({
    ...ApiKeyFields,
    key: z.string().openapi({ description: 'The full key, shown only once' }),
  })
  .openapi('CreatedApiKey');

const UsersQuery = z.object({
  currentLocation: z
    .enum(['true', 'false'])
    .optional()
    .openapi({
      param: { name: 'currentLocation', in: 'query' },
      description: 'Only the users who work at the current location',
    }),
});

const LOCKED_RESPONSE = {
  423: {
    description: 'Too many wrong PINs on this terminal (LOCKED, details.retryAfterSeconds)',
    content: { 'application/json': { schema: ErrorSchema } },
  },
} as const;

const security = AUTHENTICATED;
const DEVICE: Record<string, string[]>[] = [{ terminalToken: [] }];
const POS: Record<string, string[]>[] = [{ posSession: [], terminalToken: [] }];

export function registerPeopleRoutes(app: ApiApp) {
  registerDeviceRoutes(app);
  registerTerminalRoutes(app);
  registerUserRoutes(app);
  registerApiKeyRoutes(app);
}

/** Printers and kitchen stations of the caller's current location (RF-A03, RF-F17). */
function registerDeviceRoutes(app: ApiApp) {
  const tags = ['Kitchen stations & printers'];

  app.openapi(
    createRoute({
      method: 'get',
      path: '/printers',
      tags,
      security,
      summary: 'List the printers of the current location',
      responses: { 200: jsonResponse(z.array(PrinterSchema), 'Printers'), ...ERROR_RESPONSES },
    }),
    async (c) => c.json(await service.listPrinters({ db: c.get('db') }, actorOf(c)), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/printers',
      tags,
      security,
      summary: 'Add a network printer (RF-F17)',
      description:
        'ESC/POS, Epson ePOS or Star CloudPRNT. The test print comes with the location hub.',
      request: { body: jsonBody(createPrinterSchema) },
      responses: { 201: jsonResponse(PrinterSchema, 'Created printer'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.createPrinter({ db: c.get('db') }, actorOf(c), c.req.valid('json')),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/printers/{id}',
      tags,
      security,
      summary: 'Update or (de)activate a printer',
      request: { params: UuidParam, body: jsonBody(updatePrinterSchema) },
      responses: { 200: jsonResponse(PrinterSchema, 'Updated printer'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.updatePrinter(
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
      path: '/printers/{id}/test',
      tags,
      security,
      summary: 'Print a test page through the location hub (RF-F17)',
      description:
        'The request reaches the hub with the next configuration; the hub prints and reports the ' +
        'result, visible as lastTestAt / lastTestOk (DEC-032).',
      request: { params: UuidParam },
      responses: { 202: jsonResponse(PrinterSchema, 'Test page requested'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.requestPrinterTest({ db: c.get('db') }, actorOf(c), c.req.valid('param').id),
        202,
      ),
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/printers/{id}',
      tags,
      security,
      summary: 'Remove a printer no station or terminal uses (soft delete)',
      request: { params: UuidParam },
      responses: { 204: NoContent, ...ERROR_RESPONSES },
    }),
    async (c) => {
      await service.deletePrinter({ db: c.get('db') }, actorOf(c), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/kitchen-stations',
      tags,
      security,
      summary: 'List the kitchen stations of the current location',
      responses: {
        200: jsonResponse(z.array(KitchenStationSchema), 'Kitchen stations'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) => c.json(await service.listKitchenStations({ db: c.get('db') }, actorOf(c)), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/kitchen-stations',
      tags,
      security,
      summary: 'Create a kitchen station (RF-A03, RF-C24, RF-C25)',
      description:
        'Own delay alert and kitchen language, optional ticket printer of the same location.',
      request: { body: jsonBody(createKitchenStationSchema) },
      responses: { 201: jsonResponse(KitchenStationSchema, 'Created station'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.createKitchenStation({ db: c.get('db') }, actorOf(c), c.req.valid('json')),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/kitchen-stations/{id}',
      tags,
      security,
      summary: 'Update or (de)activate a kitchen station',
      request: { params: UuidParam, body: jsonBody(updateKitchenStationSchema) },
      responses: { 200: jsonResponse(KitchenStationSchema, 'Updated station'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.updateKitchenStation(
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
      method: 'delete',
      path: '/kitchen-stations/{id}',
      tags,
      security,
      summary: 'Remove a station without products or KDS (soft delete)',
      request: { params: UuidParam },
      responses: { 204: NoContent, ...ERROR_RESPONSES },
    }),
    async (c) => {
      await service.deleteKitchenStation({ db: c.get('db') }, actorOf(c), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );
}

/** Terminals: setup, pairing, PIN unlock, manager approval and offline credentials (RF-A06). */
function registerTerminalRoutes(app: ApiApp) {
  const tags = ['Terminals'];

  // Device calls first: static paths before `/terminals/{id}`.
  app.openapi(
    createRoute({
      method: 'post',
      path: '/terminals/pair',
      tags,
      security: [],
      summary: 'Pair a device with the code from the backoffice',
      description:
        'Anonymous: the one-time code is the credential. Returns the device token once and the location ' +
        'the terminal belongs to. 401 for a wrong or expired code. A code for a waiter phone (DEC-036) ' +
        'also needs the waiter PIN: 400 with `details.reason = pin_required` without it, 401 ' +
        '`wrong_pin` (5 wrong PINs kill the code), 403 `not_waiter` or `phone_deactivated`.',
      request: { body: jsonBody(pairTerminalSchema) },
      responses: { 200: jsonResponse(PairedTerminalSchema, 'Paired terminal'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.pairTerminal({ db: c.get('db') }, c.req.valid('json'), c.get('requestId')),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/terminals/unlock',
      tags,
      security: DEVICE,
      summary: 'Unlock the terminal with a PIN (RF-A06)',
      description:
        'The PIN alone identifies the user (DEC-015). Needs X-Terminal-Token. Wrong PINs are counted per ' +
        'terminal; at `settings.security.maxPinAttempts` the terminal answers 423 for ' +
        '`pinLockMinutes` (RNF-10).',
      request: { body: jsonBody(unlockSchema) },
      responses: {
        200: jsonResponse(PosSessionSchema, 'POS session'),
        ...ERROR_RESPONSES,
        ...LOCKED_RESPONSE,
      },
    }),
    async (c) =>
      c.json(
        await service.unlockTerminal(
          { db: c.get('db') },
          { deviceToken: c.req.header('x-terminal-token') ?? null, requestId: c.get('requestId') },
          c.req.valid('json'),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/terminals/approve',
      tags,
      security: POS,
      summary: 'Manager approval with PIN on the same device (RF-A05, RN-15)',
      description:
        'The approver, identified by PIN, needs every requested permission at this location. The token ' +
        'is valid 60 seconds, once, for exactly `action`: send it as X-Approval.',
      request: { body: jsonBody(approvalRequestSchema) },
      responses: {
        200: jsonResponse(ApprovalSchema, 'Approval token'),
        ...ERROR_RESPONSES,
        ...LOCKED_RESPONSE,
      },
    }),
    async (c) =>
      c.json(
        await service.approveAction({ db: c.get('db') }, actorOf(c), c.req.valid('json')),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/terminals/offline-credentials',
      tags,
      security: [...DEVICE, ...POS],
      summary: 'Credentials to unlock without network (RF-A06, DEC-015)',
      description:
        'For a paired terminal only: the PIN key and, for each active user of its location with a PIN, ' +
        'the argon2 hash and the permissions there.',
      responses: {
        200: jsonResponse(OfflineCredentialsSchema, 'Offline credentials'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      return c.json(
        await service.getOfflineCredentials(
          { db: c.get('db') },
          { deviceToken: c.req.header('x-terminal-token') ?? null, requestId: c.get('requestId') },
        ),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/terminals/phone-pairing-code',
      tags,
      security: [...DEVICE, ...security],
      summary: 'Issue a code for waiter phones (DEC-036)',
      description:
        'From the cashier POS (X-Terminal-Token of a `pos` terminal) or the backoffice ' +
        '(`location.manage`). Valid 5 minutes for any number of phones; each phone also needs the ' +
        "waiter's PIN.",
      responses: {
        201: jsonResponse(PairingCodeSchema, 'Phone pairing code'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) => c.json(await service.issuePhonePairingCode({ db: c.get('db') }, actorOf(c)), 201),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/terminals/logout',
      tags,
      security: DEVICE,
      summary: 'Sign out of a waiter phone: it unpairs itself (DEC-036)',
      description:
        'Only a `phone` terminal. Its device token stops working at once; the terminal stays active ' +
        'for the next pairing.',
      responses: { 204: NoContent, ...ERROR_RESPONSES },
    }),
    async (c) => {
      await service.logoutPhone({ db: c.get('db') }, actorOf(c));
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/terminals',
      tags,
      security,
      summary: 'List the terminals of the current location',
      responses: { 200: jsonResponse(z.array(TerminalSchema), 'Terminals'), ...ERROR_RESPONSES },
    }),
    async (c) => c.json(await service.listTerminals({ db: c.get('db') }, actorOf(c)), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/terminals',
      tags,
      security,
      summary: 'Create a terminal: POS, handheld or KDS (RF-A03)',
      description: 'The order-number prefix is unique per location (RN-16): 409 otherwise.',
      request: { body: jsonBody(createTerminalSchema) },
      responses: { 201: jsonResponse(TerminalSchema, 'Created terminal'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.createTerminal({ db: c.get('db') }, actorOf(c), c.req.valid('json')),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/terminals/{id}',
      tags,
      security,
      summary: 'Update or deactivate a terminal (RF-A12)',
      description: 'Deactivating unpairs the device at once; terminals are never deleted.',
      request: { params: UuidParam, body: jsonBody(updateTerminalSchema) },
      responses: { 200: jsonResponse(TerminalSchema, 'Updated terminal'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.updateTerminal(
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
      path: '/terminals/{id}/pairing-code',
      tags,
      security,
      summary: 'Issue a one-time pairing code (valid 15 minutes)',
      request: { params: UuidParam },
      responses: {
        201: jsonResponse(PairingCodeSchema, 'Pairing code, shown once'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await service.issuePairingCode({ db: c.get('db') }, actorOf(c), c.req.valid('param').id),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/terminals/{id}/unpair',
      tags,
      security,
      summary: 'Unpair a device without deactivating it (DEC-036)',
      description: 'Its device token stops working at once; it can be paired again.',
      request: { params: UuidParam },
      responses: { 200: jsonResponse(TerminalSchema, 'Unpaired terminal'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.unpairTerminal({ db: c.get('db') }, actorOf(c), c.req.valid('param').id),
        200,
      ),
  );
}

/** Users, PIN, passwords and role permissions (RF-A04…RF-A08, RF-A12). */
function registerUserRoutes(app: ApiApp) {
  const tags = ['Users & roles'];

  app.openapi(
    createRoute({
      method: 'get',
      path: '/users',
      tags,
      security,
      summary: 'List the organization’s users with roles and locations',
      request: { query: UsersQuery },
      responses: { 200: jsonResponse(z.array(UserSchema), 'Users'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.listUsers({ db: c.get('db') }, actorOf(c), {
          currentLocation: c.req.valid('query').currentLocation === 'true',
        }),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/users',
      tags,
      security,
      summary: 'Create a user (RF-A04)',
      description:
        'Several roles and locations. Email and password give backoffice access; the PIN, POS access. ' +
        '409 when the email or the PIN is already used (details.field).',
      request: { body: jsonBody(createUserSchema) },
      responses: { 201: jsonResponse(UserSchema, 'Created user'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(await service.createUser({ db: c.get('db') }, actorOf(c), c.req.valid('json')), 201),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/users/{id}',
      tags,
      security,
      summary: 'Get a user',
      request: { params: UuidParam },
      responses: { 200: jsonResponse(UserSchema, 'User'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(await service.getUser({ db: c.get('db') }, actorOf(c), c.req.valid('param').id), 200),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/users/{id}',
      tags,
      security,
      summary: 'Update, change roles and locations, or deactivate a user (RF-A12)',
      description:
        'Roles and locations are replaced as a whole. Nobody can deactivate themselves, and the ' +
        'organization keeps at least one active administrator (409). Audited.',
      request: { params: UuidParam, body: jsonBody(updateUserSchema) },
      responses: { 200: jsonResponse(UserSchema, 'Updated user'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.updateUser(
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
      method: 'put',
      path: '/users/{id}/pin',
      tags,
      security,
      summary: 'Set the POS PIN (4-6 digits, unique in the organization)',
      request: { params: UuidParam, body: jsonBody(setPinSchema) },
      responses: { 204: NoContent, ...ERROR_RESPONSES },
    }),
    async (c) => {
      await service.setUserPin(
        { db: c.get('db') },
        actorOf(c),
        c.req.valid('param').id,
        c.req.valid('json'),
      );
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/users/{id}/password',
      tags,
      security,
      summary: 'Set the backoffice password (RF-A07)',
      request: { params: UuidParam, body: jsonBody(setPasswordSchema) },
      responses: { 204: NoContent, ...ERROR_RESPONSES },
    }),
    async (c) => {
      await service.setUserPassword(
        { db: c.get('db') },
        actorOf(c),
        c.req.valid('param').id,
        c.req.valid('json'),
      );
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/roles',
      tags,
      security,
      summary: 'List the roles with their permissions',
      responses: { 200: jsonResponse(z.array(RoleSchema), 'Roles'), ...ERROR_RESPONSES },
    }),
    async (c) => c.json(await service.listRoles({ db: c.get('db') }, actorOf(c)), 200),
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/roles/{id}/permissions',
      tags,
      security,
      summary: 'Replace the permissions of a role (RF-A05)',
      description: 'Not allowed for the administrator role (409). Audited.',
      request: { params: UuidParam, body: jsonBody(setRolePermissionsSchema) },
      responses: { 200: jsonResponse(RoleSchema, 'Updated role'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.setRolePermissions(
          { db: c.get('db') },
          actorOf(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
        200,
      ),
  );
}

/** Organization API keys for the website and other apps (RF-F14). */
function registerApiKeyRoutes(app: ApiApp) {
  const tags = ['API keys'];

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api-keys',
      tags,
      security,
      summary: 'List the organization’s API keys (never the key itself)',
      responses: { 200: jsonResponse(z.array(ApiKeySchema), 'API keys'), ...ERROR_RESPONSES },
    }),
    async (c) => c.json(await service.listApiKeys({ db: c.get('db') }, actorOf(c)), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api-keys',
      tags,
      security,
      summary: 'Create an API key (RF-F14)',
      description: `Scopes: ${API_KEY_SCOPE_NAMES.join(', ')}. The full key is returned only in this response.`,
      request: { body: jsonBody(createApiKeySchema) },
      responses: { 201: jsonResponse(CreatedApiKeySchema, 'Created key'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(await service.createApiKey({ db: c.get('db') }, actorOf(c), c.req.valid('json')), 201),
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/api-keys/{id}',
      tags,
      security,
      summary: 'Revoke an API key',
      request: { params: UuidParam },
      responses: { 204: NoContent, ...ERROR_RESPONSES },
    }),
    async (c) => {
      await service.revokeApiKey({ db: c.get('db') }, actorOf(c), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );
}
