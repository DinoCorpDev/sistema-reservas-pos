import { createRoute, z } from '@hono/zod-openapi';
import { csvFrancs, reportPeriodSchema, toCsv, vatReportQuerySchema } from '@pos/core';
import * as reports from '../../services/reports';
import { actorOf, type ApiApp } from '../env';
import { AUTHENTICATED, ERROR_RESPONSES, jsonResponse } from '../schemas';

/**
 * Reports (RF-F01…RF-F10, RF-F13): the same figures as the backoffice, for an accounting tool or
 * the owner's own analysis. A period is `from`…`to` in business days (at most 366). Money in
 * rappen, with the rule of the Z: a period of whole days adds up to its closings (DEC-038).
 * Needs `report.view`. Cloud only.
 */

const tags = ['Reports'];

const Report = (name: string, description: string) =>
  z.record(z.string(), z.unknown()).openapi(name, { description });

const PERIOD_DOC = 'Business days `from`…`to` (ISO dates, both included, at most 366 days).';

/** The accounting export as CSV (RF-F04): `;`, UTF-8 with BOM, amounts in CHF. */
export const ACCOUNTING_CSV_HEADER = [
  'business_date',
  'kind',
  'payment_method',
  'vat_rate_code',
  'vat_rate_percent',
  'gross_chf',
  'vat_chf',
  'net_chf',
] as const;

export function registerReportRoutes(app: ApiApp) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/reports/sales',
      tags,
      security: AUTHENTICATED,
      summary: 'Sales by day, hour, waiter, channel, method, category and product (RF-F01)',
      description: `${PERIOD_DOC} Includes the previous period of the same length.`,
      request: { query: reportPeriodSchema },
      responses: {
        200: jsonResponse(Report('SalesReport', 'Sales of the period'), 'Sales'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await reports.getSalesReport({ db: c.get('db') }, actorOf(c), c.req.valid('query')),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/reports/vat',
      tags,
      security: AUTHENTICATED,
      summary: 'MWST by rate and period: turnover, tax and net (RF-F02)',
      description: `${PERIOD_DOC} \`granularity\`: day, month (default), quarter, half or year.`,
      request: { query: vatReportQuerySchema },
      responses: {
        200: jsonResponse(Report('VatReport', 'MWST of the period by rate'), 'MWST'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await reports.getVatReport({ db: c.get('db') }, actorOf(c), c.req.valid('query')),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/reports/accounting',
      tags,
      security: AUTHENTICATED,
      summary: 'Accounting rows: business day × payment method × MWST rate (RF-F04)',
      description: `${PERIOD_DOC} Tips and cash rounding are rows of their own, without MWST.`,
      request: { query: reportPeriodSchema },
      responses: {
        200: jsonResponse(Report('AccountingRows', 'Rows of the accounting export'), 'Rows'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await reports.getAccountingRows({ db: c.get('db') }, actorOf(c), c.req.valid('query')),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/reports/accounting.csv',
      tags,
      security: AUTHENTICATED,
      summary: 'The accounting export as CSV (RF-F04)',
      description: `${PERIOD_DOC} Separator \`;\`, UTF-8 with BOM, amounts in CHF with two decimals.`,
      request: { query: reportPeriodSchema },
      responses: {
        200: { description: 'CSV', content: { 'text/csv': { schema: z.string() } } },
        ...ERROR_RESPONSES,
      },
    }),
    async (c) => {
      const query = c.req.valid('query');
      const { rows } = await reports.getAccountingRows({ db: c.get('db') }, actorOf(c), query);
      const csv = toCsv(
        ACCOUNTING_CSV_HEADER,
        rows.map((row) => [
          row.businessDate,
          row.kind,
          row.method,
          row.rateCode ?? '',
          row.rateBp === null ? '' : (row.rateBp / 100).toFixed(2),
          csvFrancs(row.grossRappen),
          csvFrancs(row.taxRappen),
          csvFrancs(row.netRappen),
        ]),
      );
      return c.body(csv, 200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="accounting-${query.from}-${query.to}.csv"`,
      });
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/reports/tips',
      tags,
      security: AUTHENTICATED,
      summary: 'Tips by person, outside the sales and without MWST (RF-F07)',
      request: { query: reportPeriodSchema },
      responses: {
        200: jsonResponse(Report('TipsReport', 'Tips of the period by person'), 'Tips'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await reports.getTipsReport({ db: c.get('db') }, actorOf(c), c.req.valid('query')),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/reports/adjustments',
      tags,
      security: AUTHENTICATED,
      summary: 'Voids, discounts and refunds by person, reason and amount (RF-F06)',
      request: { query: reportPeriodSchema },
      responses: {
        200: jsonResponse(Report('AdjustmentsReport', 'Voids, discounts, refunds'), 'Report'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await reports.getAdjustmentsReport({ db: c.get('db') }, actorOf(c), c.req.valid('query')),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/reports/times',
      tags,
      security: AUTHENTICATED,
      summary: 'Kitchen times (send → ready) by station and product, and table times (RF-F08)',
      request: { query: reportPeriodSchema },
      responses: {
        200: jsonResponse(Report('TimesReport', 'Kitchen and table times'), 'Times'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await reports.getTimesReport({ db: c.get('db') }, actorOf(c), c.req.valid('query')),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/reports/dashboard',
      tags,
      security: AUTHENTICATED,
      summary: "The owner's view of today: sales, open orders and tables, shifts (RF-F10)",
      responses: {
        200: jsonResponse(Report('Dashboard', 'Today at the location'), 'Dashboard'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) => c.json(await reports.getDashboard({ db: c.get('db') }, actorOf(c)), 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/reports/archive/receipts',
      tags,
      security: AUTHENTICATED,
      summary: 'Every receipt of the period as issued, with its hash (RF-F13, RNF-15)',
      request: { query: reportPeriodSchema },
      responses: {
        200: jsonResponse(Report('ReceiptArchive', 'Receipts of the period'), 'Receipts'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await reports.archiveReceipts({ db: c.get('db') }, actorOf(c), c.req.valid('query')),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/reports/archive/closings',
      tags,
      security: AUTHENTICATED,
      summary: 'The Z closings of the period with their sealed totals (RF-F03, RF-F13)',
      request: { query: reportPeriodSchema },
      responses: {
        200: jsonResponse(Report('ClosingArchive', 'Closings of the period'), 'Closings'),
        ...ERROR_RESPONSES,
      },
    }),
    async (c) =>
      c.json(
        await reports.archiveClosings({ db: c.get('db') }, actorOf(c), c.req.valid('query')),
        200,
      ),
  );
}
