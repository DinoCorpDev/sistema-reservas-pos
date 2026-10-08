import { createRoute, z } from '@hono/zod-openapi';
import { presenceReportSchema, printerStatusReportSchema } from '@pos/core';
import * as orders from '../../services/orders';
import { getBootstrap } from '../../services/pos/bootstrap';
import * as sync from '../../services/sync';
import { actorOf, type ApiApp } from '../env';
import {
  AUTHENTICATED,
  ERROR_RESPONSES,
  jsonBody,
  jsonResponse,
  NoContent,
  UuidParam,
} from '../schemas';

/**
 * POS bootstrap and the read side of orders and receipts (RF-F14), plus the manager's list of
 * synchronization conflicts (RNF-04). Cloud only. Orders are written through POST /sync/push.
 */

const DEVICE: Record<string, string[]>[] = [{ terminalToken: [] }];

const OrderSummarySchema = z
  .object({
    id: z.uuid(),
    businessDate: z.string(),
    displayNumber: z.string().openapi({ example: '0042' }),
    channel: z.string(),
    consumptionType: z.string(),
    tableId: z.uuid().nullable(),
    joinedTableIds: z.array(z.uuid()),
    waiterUserId: z.uuid().nullable(),
    guestCount: z.number().int().nullable(),
    status: z.string().openapi({ enum: ['open', 'closed', 'voided'] }),
    paymentStatus: z.string().openapi({ enum: ['unpaid', 'partial', 'paid', 'refunded'] }),
    customerName: z.string().nullable(),
    subtotalRappen: z.number().int(),
    discountTotalRappen: z.number().int(),
    totalRappen: z.number().int(),
    taxTotalRappen: z.number().int(),
    paidRappen: z.number().int(),
    tipTotalRappen: z.number().int(),
    openedAt: z.string(),
    closedAt: z.string().nullable(),
    voidedAt: z.string().nullable(),
    mergedIntoOrderId: z.uuid().nullable(),
    splitFromOrderId: z.uuid().nullable(),
    terminalId: z.uuid().nullable(),
    version: z.number().int(),
  })
  .openapi('OrderSummary');

const ReceiptSchema = z
  .object({
    id: z.uuid(),
    orderId: z.uuid(),
    paymentId: z.uuid().nullable(),
    receiptNumber: z.string().openapi({ example: 'K1-261006-0012' }),
    copyNumber: z.number().int(),
    language: z.string(),
    content: z.record(z.string(), z.unknown()).openapi({
      description: 'Frozen receipt content exactly as printed (RN-08, DEC-024)',
    }),
    contentHash: z.string(),
    customerName: z.string().nullable(),
    issuedAt: z.string(),
  })
  .openapi('Receipt');

const OrderSchema = OrderSummarySchema.extend({
  note: z.string().nullable(),
  items: z.array(z.record(z.string(), z.unknown())),
  discounts: z.array(z.record(z.string(), z.unknown())),
  payments: z.array(z.record(z.string(), z.unknown())),
  refunds: z.array(z.record(z.string(), z.unknown())),
  receipts: z.array(ReceiptSchema),
}).openapi('Order');

const SyncConflictSchema = z
  .object({
    id: z.uuid(),
    operation: z.string(),
    orderId: z.uuid().nullable(),
    terminalId: z.uuid(),
    userId: z.uuid().nullable(),
    deviceAt: z.string(),
    receivedAt: z.string(),
    conflicts: z.array(
      z.object({
        code: z.string(),
        entityId: z.string().nullable(),
        stored: z.boolean().optional(),
      }),
    ),
    payload: z.unknown(),
    resolvedAt: z.string().nullable(),
    resolvedByUserId: z.uuid().nullable(),
  })
  .openapi('SyncConflict');

export function registerPosRoutes(app: ApiApp) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/pos/bootstrap',
      tags: ['Sync'],
      security: DEVICE,
      summary: 'Everything a paired terminal needs to operate offline',
      description:
        'Location with receipt data and settings, floor, stations, users, the raw catalog, tax ' +
        'categories with dated rates and rules, the configuration version and the counters this ' +
        'terminal used today (docs/SYNC.md §6.4).',
      responses: {
        200: jsonResponse(z.record(z.string(), z.unknown()), 'Bootstrap snapshot'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      return c.json(await getBootstrap({ db: c.get('db') }, actorOf(c)), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/orders',
      tags: ['Orders'],
      security: AUTHENTICATED,
      summary: 'Orders of the location',
      request: {
        query: z.object({
          businessDate: z.iso.date().optional(),
          status: z.enum(['open', 'closed', 'voided']).optional(),
        }),
      },
      responses: { 200: jsonResponse(z.array(OrderSummarySchema), 'Orders'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(await orders.listOrders({ db: c.get('db') }, actorOf(c), c.req.valid('query')), 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/orders/{id}',
      tags: ['Orders'],
      security: AUTHENTICATED,
      summary: 'An order with its items, discounts, payments, refunds and receipts',
      request: { params: UuidParam },
      responses: { 200: jsonResponse(OrderSchema, 'Order'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(await orders.getOrder({ db: c.get('db') }, actorOf(c), c.req.valid('param').id), 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/receipts/{id}',
      tags: ['Orders'],
      security: AUTHENTICATED,
      summary: 'A receipt with its frozen content',
      request: { params: UuidParam },
      responses: { 200: jsonResponse(ReceiptSchema, 'Receipt'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await orders.getReceipt({ db: c.get('db') }, actorOf(c), c.req.valid('param').id),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/sync/conflicts',
      tags: ['Sync'],
      security: AUTHENTICATED,
      summary: 'Synchronization conflicts for the manager (RNF-04)',
      request: {
        query: z.object({ includeResolved: z.enum(['true', 'false']).optional() }),
      },
      responses: {
        200: jsonResponse(z.array(SyncConflictSchema), 'Conflicts, newest first'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await sync.listConflicts({ db: c.get('db') }, actorOf(c), {
          includeResolved: c.req.valid('query').includeResolved === 'true',
        }),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sync/printer-status',
      tags: ['Sync'],
      security: DEVICE,
      summary: 'The location hub reports its printers and test pages (RF-F17)',
      request: { body: jsonBody(printerStatusReportSchema) },
      responses: {
        200: jsonResponse(z.object({ updated: z.number().int() }), 'Stored'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await sync.reportPrinterStatus({ db: c.get('db') }, actorOf(c), c.req.valid('json')),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sync/presence',
      tags: ['Sync'],
      security: DEVICE,
      summary: 'The location hub hands over who is at the kitchen displays (DEC-033)',
      request: { body: jsonBody(presenceReportSchema) },
      responses: {
        200: jsonResponse(z.object({ stored: z.number().int() }), 'Stored'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(await sync.reportPresence({ db: c.get('db') }, actorOf(c), c.req.valid('json')), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sync/conflicts/{id}/resolve',
      tags: ['Sync'],
      security: AUTHENTICATED,
      summary: 'Mark a conflict as resolved, with a note (audited)',
      request: {
        params: UuidParam,
        body: jsonBody(z.object({ note: z.string().trim().min(1).max(500) })),
      },
      responses: { 204: NoContent, ...ERROR_RESPONSES },
    }),
    async (c) => {
      await sync.resolveConflict(
        { db: c.get('db') },
        actorOf(c),
        c.req.valid('param').id,
        c.req.valid('json'),
      );
      return c.body(null, 204);
    },
  );
}
