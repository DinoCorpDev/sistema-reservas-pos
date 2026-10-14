import { createRoute, z } from '@hono/zod-openapi';
import { businessDayQuerySchema, dayCloseSchema } from '@pos/core';
import * as cash from '../../services/cash';
import { actorOf, type ApiApp } from '../env';
import { AUTHENTICATED, ERROR_RESPONSES, jsonBody, jsonResponse, UuidParam } from '../schemas';

/**
 * Cash (RF-D11…RF-D19, RF-F03, DEC-038): the Z closing of the business day with its blockers
 * and reconciliation, the closings already made and the daily cash book. Shifts and movements
 * are written by the devices through POST /sync/push; these routes read and close. Cloud only.
 */

const Totals = z
  .record(z.string(), z.unknown())
  .openapi({ description: 'Frozen totals of the Z (`DailyClosingTotals`, version 1), in rappen' });

const ClosingSchema = z
  .object({
    id: z.uuid(),
    businessDate: z.string().openapi({ example: '2026-10-06' }),
    closingNumber: z.number().int(),
    totals: Totals,
    contentHash: z.string().openapi({ description: 'SHA-256 sealing the closing (RN-10)' }),
    closedByUserId: z.uuid(),
    closedByName: z.string().nullable(),
    closedAt: z.string(),
  })
  .openapi('DailyClosing');

const ClosingDetailSchema = ClosingSchema.extend({
  intact: z.boolean().openapi({ description: 'The stored content still matches its hash' }),
  corrections: z
    .object({ count: z.number().int(), totals: Totals })
    .nullable()
    .openapi({ description: 'Money of the day that arrived after the Z (RN-21)' }),
}).openapi('DailyClosingDetail');

const PreviewSchema = z
  .object({
    businessDate: z.string(),
    closing: ClosingSchema.nullable(),
    blockers: z.object({
      openShifts: z.array(z.record(z.string(), z.unknown())),
      openOrders: z.array(z.record(z.string(), z.unknown())),
      previousDayOpen: z.string().nullable(),
      future: z.boolean(),
    }),
    canClose: z.boolean(),
    totals: Totals,
    toReconcile: z.array(z.object({ method: z.string(), posTotalRappen: z.number().int() })),
    warnings: z.object({
      unresolvedConflicts: z.number().int(),
      unassignedCashRappen: z.number().int(),
    }),
  })
  .openapi('DayClosePreview');

const CashBookSchema = z
  .object({
    businessDate: z.string(),
    shifts: z.array(z.object({ id: z.uuid(), ownerName: z.string() })),
    lines: z.array(
      z.object({
        at: z.string(),
        kind: z.string(),
        shiftId: z.string().nullable(),
        reference: z.string().nullable(),
        amountRappen: z.number().int(),
        balanceRappen: z.number().int(),
      }),
    ),
    inRappen: z.number().int(),
    outRappen: z.number().int(),
    endBalanceRappen: z.number().int(),
  })
  .openapi('CashBook');

export function registerCashRoutes(app: ApiApp) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/cash/day-close/preview',
      tags: ['Cash'],
      security: AUTHENTICATED,
      summary: 'What the Z of a business day would say, and what still stops it (RF-D19)',
      request: { query: businessDayQuerySchema },
      responses: { 200: jsonResponse(PreviewSchema, 'Preview'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await cash.previewDayClose(
          { db: c.get('db') },
          actorOf(c),
          c.req.valid('query').businessDate,
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/cash/day-close',
      tags: ['Cash'],
      security: AUTHENTICATED,
      summary: 'Close the business day: the immutable Z (RF-D15, RF-D11)',
      description:
        'Refused (409) while shifts or orders of the day are open or an earlier day has no Z. ' +
        'Every method paid through a payment terminal needs its terminal total; a difference ' +
        'needs a reason. Closing the same day again returns the closing already made.',
      request: { body: jsonBody(dayCloseSchema) },
      responses: { 200: jsonResponse(ClosingSchema, 'The Z'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(await cash.closeDay({ db: c.get('db') }, actorOf(c), c.req.valid('json')), 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/cash/closings',
      tags: ['Cash'],
      security: AUTHENTICATED,
      summary: 'The Z closings of the location, newest first (RF-F03)',
      responses: { 200: jsonResponse(z.array(ClosingSchema), 'Closings'), ...ERROR_RESPONSES },
    }),
    async (c) => c.json(await cash.listClosings({ db: c.get('db') }, actorOf(c)), 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/cash/closings/{id}',
      tags: ['Cash'],
      security: AUTHENTICATED,
      summary: 'A Z with its integrity check and the corrections that came after it (RN-21)',
      request: { params: UuidParam },
      responses: { 200: jsonResponse(ClosingDetailSchema, 'Closing'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(await cash.getClosing({ db: c.get('db') }, actorOf(c), c.req.valid('param').id), 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/cash/book',
      tags: ['Cash'],
      security: AUTHENTICATED,
      summary: 'The daily cash book (Kassenbuch, RF-D16)',
      request: { query: businessDayQuerySchema },
      responses: { 200: jsonResponse(CashBookSchema, 'Cash book'), ...ERROR_RESPONSES },
    }),
    async (c) =>
      c.json(
        await cash.getCashBook({ db: c.get('db') }, actorOf(c), c.req.valid('query').businessDate),
        200,
      ),
  );
}
