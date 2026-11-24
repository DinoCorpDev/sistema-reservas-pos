import { createRoute, z } from '@hono/zod-openapi';
import {
  CONTENT_LANGUAGES,
  createAreaSchema,
  createTableSchema,
  locationSettingsSchema,
  QR_MODES,
  updateAreaSchema,
  updateLocationSchema,
  updateTableSchema,
  floorPhotoSchema,
  saveFloorLayoutSchema,
  TABLE_SHAPES,
} from '@pos/core';
import * as service from '../../services/locations';
import { actorOf, type ApiApp } from '../env';
import {
  AUTHENTICATED,
  ERROR_RESPONSES,
  jsonBody,
  jsonResponse,
  NoContent,
  UuidParam,
} from '../schemas';

// Schemas from @pos/core are plain Zod: use them as they are, never call `.openapi()` on them
// (Zod 4 attaches methods per instance, so the OpenAPI extension does not reach them).
const LocationSettingsSchema = locationSettingsSchema;

const LocationSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    legalName: z.string(),
    street: z.string(),
    postalCode: z.string(),
    city: z.string(),
    canton: z.string().nullable(),
    country: z.string(),
    vatUid: z.string().nullable().openapi({ example: 'CHE-123.456.788 MWST' }),
    currency: z.string(),
    timezone: z.string(),
    defaultLanguage: z.string(),
    kitchenLanguage: z.string(),
    languages: z.array(z.string().openapi({ enum: [...CONTENT_LANGUAGES] })),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    receiptHeader: z.string().nullable(),
    receiptFooter: z.string().nullable(),
    openingHours: z.record(z.string(), z.array(z.tuple([z.string(), z.string()]))).nullable(),
    settings: LocationSettingsSchema,
    operationActivatedAt: z.string().nullable(),
  })
  .openapi('Location');

const AreaSchema = z
  .object({
    id: z.uuid(),
    locationId: z.uuid(),
    name: z.string(),
    qrMode: z.string().openapi({ enum: [...QR_MODES] }),
    sortOrder: z.number().int(),
    isActive: z.boolean(),
  })
  .openapi('Area');

const TableSchema = z
  .object({
    id: z.uuid(),
    locationId: z.uuid(),
    areaId: z.uuid(),
    label: z.string(),
    qrCode: z.string().openapi({ description: 'Public code of the table QR menu (/qr/{qrCode})' }),
    capacity: z.number().int(),
    shape: z.string(),
    posX: z.number().int(),
    posY: z.number().int(),
    width: z.number().int(),
    height: z.number().int(),
    qrMode: z.string().nullable(),
    isActive: z.boolean(),
  })
  .openapi('Table');

const tags = ['Locations'];
const security = AUTHENTICATED;

export function registerLocationRoutes(app: ApiApp) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/locations',
      tags,
      security,
      summary: 'List the organization’s locations',
      responses: { 200: jsonResponse(z.array(LocationSchema), 'Locations'), ...ERROR_RESPONSES },
    }),
    async (c) => c.json(await service.listLocations({ db: c.get('db') }, actorOf(c)), 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/locations/{id}',
      tags,
      security,
      summary: 'Get a location',
      request: { params: UuidParam },
      responses: { 200: jsonResponse(LocationSchema, 'Location'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.getLocation({ db: c.get('db') }, actorOf(c), c.req.valid('param').id),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/locations/{id}',
      tags,
      security,
      summary: 'Update the location’s data (RF-A02)',
      description: 'Name, address, MWST UID, languages, opening hours and receipt texts. Audited.',
      request: { params: UuidParam, body: jsonBody(updateLocationSchema) },
      responses: { 200: jsonResponse(LocationSchema, 'Updated location'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.updateLocation(
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
      path: '/locations/{id}/settings',
      tags,
      security,
      summary: 'Replace the operating thresholds of the location (DEC-004)',
      description:
        'Manager approval thresholds, reservation timing, kitchen alert, PIN lockout. Audited.',
      request: { params: UuidParam, body: jsonBody(LocationSettingsSchema) },
      responses: {
        200: jsonResponse(LocationSettingsSchema, 'Saved settings'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await service.updateLocationSettings(
          { db: c.get('db') },
          actorOf(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
        200,
      ),
  );

  // Areas and tables act on the caller's current location (X-Location-Id, session or POS token).
  const areaTags = ['Areas & tables'];

  app.openapi(
    createRoute({
      method: 'get',
      path: '/areas',
      tags: areaTags,
      security,
      summary: 'List the areas of the current location',
      responses: { 200: jsonResponse(z.array(AreaSchema), 'Areas'), ...ERROR_RESPONSES },
    }),
    async (c) => c.json(await service.listAreas({ db: c.get('db') }, actorOf(c)), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/areas',
      tags: areaTags,
      security,
      summary: 'Create an area (RF-A03)',
      request: { body: jsonBody(createAreaSchema) },
      responses: { 201: jsonResponse(AreaSchema, 'Created area'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(await service.createArea({ db: c.get('db') }, actorOf(c), c.req.valid('json')), 201),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/areas/{id}',
      tags: areaTags,
      security,
      summary: 'Update or (de)activate an area (RF-C06)',
      request: { params: UuidParam, body: jsonBody(updateAreaSchema) },
      responses: { 200: jsonResponse(AreaSchema, 'Updated area'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.updateArea(
          { db: c.get('db') },
          actorOf(c),
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
        200,
      ),
  );

  const PlannedTableSchema = z
    .object({
      label: z.string(),
      shape: z.string().openapi({ enum: [...TABLE_SHAPES] }),
      capacity: z.number().int(),
      posX: z.number().int(),
      posY: z.number().int(),
      width: z.number().int(),
      height: z.number().int(),
    })
    .openapi('PlannedTable');

  app.openapi(
    createRoute({
      method: 'put',
      path: '/areas/{id}/layout',
      tags: areaTags,
      security,
      summary: 'Save the floor plan of an area: tables on a grid of 16 × 16 (DEC-056)',
      description:
        'Existing tables (with `id`) move or change; new ones are created with their QR code. ' +
        'A table left out keeps its place. 409 `label_taken` when another table of the location ' +
        'already has a label.',
      request: { params: UuidParam, body: jsonBody(saveFloorLayoutSchema) },
      responses: {
        200: jsonResponse(
          z.object({ created: z.number().int(), updated: z.number().int() }),
          'Saved',
        ),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await service.saveFloorLayout(
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
      path: '/areas/{id}/floor-photo',
      tags: areaTags,
      security,
      summary: 'Propose the plan of an area from a photo or sketch, read by the AI (DEC-056)',
      description:
        'Nothing is saved: the proposal goes back to the person, who adjusts and saves it with ' +
        '`PUT /areas/{id}/layout`. The photo is not stored. 422 `ai_not_configured` without an ' +
        'AI key, `ai_refused` or `ai_unreadable` when the photo could not be used.',
      request: { params: UuidParam, body: jsonBody(floorPhotoSchema) },
      responses: {
        200: jsonResponse(
          z.object({ tables: z.array(PlannedTableSchema), notes: z.string().nullable() }),
          'Proposal',
        ),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await service.readFloorPhoto(
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
      path: '/areas/{id}',
      tags: areaTags,
      security,
      summary: 'Remove an empty area (soft delete)',
      request: { params: UuidParam },
      responses: { 204: NoContent, ...ERROR_RESPONSES },
    }),
    async (c) => {
      await service.deleteArea({ db: c.get('db') }, actorOf(c), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/tables',
      tags: areaTags,
      security,
      summary: 'List the tables of the current location',
      responses: { 200: jsonResponse(z.array(TableSchema), 'Tables'), ...ERROR_RESPONSES },
    }),
    async (c) => c.json(await service.listTables({ db: c.get('db') }, actorOf(c)), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/tables',
      tags: areaTags,
      security,
      summary: 'Create a table with its QR code (RF-A03, RF-E06)',
      request: { body: jsonBody(createTableSchema) },
      responses: { 201: jsonResponse(TableSchema, 'Created table'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(await service.createTable({ db: c.get('db') }, actorOf(c), c.req.valid('json')), 201),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/tables/{id}',
      tags: areaTags,
      security,
      summary: 'Update a table',
      request: { params: UuidParam, body: jsonBody(updateTableSchema) },
      responses: { 200: jsonResponse(TableSchema, 'Updated table'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await service.updateTable(
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
      path: '/tables/{id}/qr-code',
      tags: areaTags,
      security,
      summary: 'Issue a new QR code for the table',
      request: { params: UuidParam },
      responses: {
        200: jsonResponse(TableSchema, 'Table with its new QR code'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await service.regenerateTableQr({ db: c.get('db') }, actorOf(c), c.req.valid('param').id),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/tables/{id}',
      tags: areaTags,
      security,
      summary: 'Remove a table (soft delete)',
      request: { params: UuidParam },
      responses: { 204: NoContent, ...ERROR_RESPONSES },
    }),
    async (c) => {
      await service.deleteTable({ db: c.get('db') }, actorOf(c), c.req.valid('param').id);
      return c.body(null, 204);
    },
  );
}
