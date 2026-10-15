import { createRoute, z } from '@hono/zod-openapi';
import * as sync from '../../services/sync';
import { actorOf, type ApiApp, type ApiContext } from '../env';
import { ERROR_RESPONSES, jsonBody, jsonResponse } from '../schemas';

/**
 * Sync API (docs/SYNC.md §6). The same routes answer in the cloud and on the LAN hub
 * (DEC-028). They authenticate the paired device only (X-Terminal-Token): the users of the
 * operations were authenticated with their PIN on the device (DEC-023).
 */

const tags = ['Sync'];
const DEVICE: Record<string, string[]>[] = [{ terminalToken: [] }];
const depsOf = (c: ApiContext) => ({ db: c.get('db'), node: c.get('node') });

const ConflictSchema = z.object({
  code: z.string().openapi({ example: 'overpayment' }),
  entityId: z.string().nullable(),
  stored: z.boolean().optional(),
});

const PushResultSchema = z.object({
  id: z.string().nullable(),
  status: z.enum(['applied', 'duplicate', 'conflict', 'rejected']),
  seq: z.number().int().nullable(),
  conflicts: z.array(ConflictSchema),
  error: z.string().optional(),
});

const PulledSchema = z.object({
  operation: z.record(z.string(), z.unknown()).openapi({ description: 'The operation as sent' }),
  seq: z.number().int(),
  status: z.string(),
  conflicts: z.array(ConflictSchema),
  cloudAcked: z.boolean(),
});

const OrderNumberSchema = z
  .object({
    businessDate: z.string(),
    number: z.number().int(),
    prefix: z.string(),
    display: z.string().openapi({ example: '0042' }),
  })
  .openapi('OrderNumber');

export function registerSyncRoutes(app: ApiApp) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/sync/ping',
      tags,
      summary: 'Heartbeat of the node and its clock (docs/SYNC.md §1, §3)',
      responses: {
        200: jsonResponse(
          z.object({ node: z.enum(['cloud', 'hub']), serverTime: z.string() }),
          'Reachable',
        ),
      },
    }),
    (c) => {
      c.header('Cache-Control', 'no-store');
      return c.json({ node: c.get('node').kind, serverTime: new Date().toISOString() }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sync/push',
      tags,
      security: DEVICE,
      summary: 'Send operations made on the device (idempotent by operation id)',
      description:
        'Each operation is stored once (its id is the idempotency key), folded with the rest of ' +
        'its group of orders and projected. Business rules never reject an operation: they ' +
        'become conflicts for the manager (RNF-04). Only malformed operations are `rejected`.',
      request: {
        body: jsonBody(
          z.object({ operations: z.array(z.unknown()).max(sync.MAX_PUSH_OPERATIONS) }),
        ),
      },
      responses: {
        200: jsonResponse(
          z.object({ results: z.array(PushResultSchema), serverTime: z.string() }),
          'One result per operation, in order',
        ),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(await sync.pushOperations(depsOf(c), actorOf(c), c.req.valid('json').operations), 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/sync/pull',
      tags,
      security: DEVICE,
      summary: 'Operations of the location after a cursor, with the configuration version',
      request: {
        query: z.object({
          after: z.coerce.number().int().min(0).default(0),
          limit: z.coerce.number().int().min(1).max(sync.MAX_PULL_OPERATIONS).optional(),
        }),
        headers: z.object({
          'x-presence': z.enum(['unlocked', 'locked']).optional().openapi({
            description: 'Whether someone is signed in on the device (DEC-033, DEC-040)',
          }),
          'x-presence-user': z.uuid().optional(),
          'x-presence-station': z.uuid().optional().openapi({
            description: 'The station a kitchen display chose at sign-in (DEC-042)',
          }),
        }),
      },
      responses: {
        200: jsonResponse(
          z.object({
            operations: z.array(PulledSchema),
            cursor: z.number().int(),
            hasMore: z.boolean(),
            configVersion: z.string(),
            serverTime: z.string(),
            presence: z.array(
              z.object({
                terminalId: z.uuid(),
                unlocked: z.boolean(),
                userId: z.uuid().nullable(),
                stationId: z.uuid().nullable(),
                lastSeenAt: z.string(),
                terminalName: z.string(),
              }),
            ),
          }),
          'A page of operations',
        ),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      const headers = c.req.valid('header');
      return c.json(
        await sync.pullOperations(depsOf(c), actorOf(c), {
          ...c.req.valid('query'),
          presence: headers['x-presence']
            ? {
                unlocked: headers['x-presence'] === 'unlocked',
                userId: headers['x-presence-user'] ?? null,
                stationId: headers['x-presence-station'] ?? null,
              }
            : null,
        }),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sync/order-numbers',
      tags,
      security: DEVICE,
      summary: 'Next short order number of the business day (only the location authority)',
      request: { body: jsonBody(z.object({ orderId: z.uuid() })) },
      responses: {
        200: jsonResponse(OrderNumberSchema, 'The number, the same on a repeated request'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(await sync.claimOrderNumber(depsOf(c), actorOf(c), c.req.valid('json')), 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/sync/hub-config',
      tags,
      security: DEVICE,
      summary: 'Organization, location and terminals for the LAN hub (docs/SYNC.md §11.2)',
      responses: {
        200: jsonResponse(z.record(z.string(), z.unknown()), 'Hub configuration'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      return c.json(await sync.getHubConfig({ db: c.get('db') }, actorOf(c)), 200);
    },
  );
}
