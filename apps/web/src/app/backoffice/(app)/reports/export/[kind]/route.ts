import { reports, toApiError } from '@pos/api';
import {
  csvFrancs,
  type DailyClosingTotals,
  reportPeriodSchema,
  type TaxSummaryLine,
  toCsv,
  VAT_GRANULARITIES,
  type VatGranularity,
} from '@pos/core';
import { getTranslations } from 'next-intl/server';
import { addDays, zurichStartOfDay } from '@/components/backoffice/admin/format';
import { currentActor, deps } from '@/server/actor';
import { auditExportFile } from '../../../audit/export-file';

/**
 * Files of a period for accounting, the fiduciary and the archive (RF-F03, RF-F04, RF-F12,
 * RF-F13, RNF-15): CSV (`;`, UTF-8 with BOM, CHF with two decimals, headers in the user's
 * language) and, for receipts, closings and the audit log, JSON as stored. The services check
 * the permissions (`report.view`, `audit.view`).
 */

const KINDS = ['accounting', 'vat', 'receipts', 'closings', 'cashbook', 'audit'] as const;
type Kind = (typeof KINDS)[number];
const WITH_JSON = new Set<Kind>(['receipts', 'closings', 'audit']);

const percent = (bp: number | null) => (bp === null ? '' : (bp / 100).toFixed(2));
const taxOf = (taxes: readonly TaxSummaryLine[]) => taxes.reduce((t, r) => t + r.taxRappen, 0);

function file(name: string, body: string, type: 'csv' | 'json') {
  return new Response(body, {
    headers: {
      'content-type':
        type === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${name}.${type}"`,
      'cache-control': 'no-store',
    },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!(KINDS as readonly string[]).includes(kind))
    return new Response('Not found', { status: 404 });
  const search = new URL(request.url).searchParams;
  const parsed = reportPeriodSchema.safeParse({ from: search.get('from'), to: search.get('to') });
  if (!parsed.success) return new Response('Invalid period', { status: 400 });
  const period = parsed.data;
  const format = search.get('format') === 'json' && WITH_JSON.has(kind as Kind) ? 'json' : 'csv';
  const name = `${kind}-${period.from}-${period.to}`;
  try {
    const actor = await currentActor();
    const c = await getTranslations('reports.export.columns');
    const t = await getTranslations('reports');

    switch (kind as Kind) {
      case 'accounting': {
        const { rows } = await reports.getAccountingRows(deps(), actor, period);
        return file(
          name,
          toCsv(
            [
              c('businessDate'),
              c('kind'),
              c('method'),
              c('rateCode'),
              c('ratePercent'),
              c('gross'),
              c('tax'),
              c('net'),
            ],
            rows.map((row) => [
              row.businessDate,
              c(`kinds.${row.kind}`),
              t(`methods.${row.method}`),
              row.rateCode ?? '',
              percent(row.rateBp),
              csvFrancs(row.grossRappen),
              csvFrancs(row.taxRappen),
              csvFrancs(row.netRappen),
            ]),
          ),
          'csv',
        );
      }
      case 'vat': {
        const requested = search.get('granularity') as VatGranularity;
        const granularity = VAT_GRANULARITIES.includes(requested) ? requested : 'month';
        const report = await reports.getVatReport(deps(), actor, { ...period, granularity });
        return file(
          name,
          toCsv(
            [c('period'), c('rateCode'), c('ratePercent'), c('gross'), c('tax'), c('net')],
            report.periods.flatMap((line) =>
              line.byTaxRate.map((rate) => [
                line.key,
                rate.rateCode,
                percent(rate.rateBp),
                csvFrancs(rate.grossRappen),
                csvFrancs(rate.taxRappen),
                csvFrancs(rate.netRappen),
              ]),
            ),
          ),
          'csv',
        );
      }
      case 'receipts': {
        const archive = await reports.archiveReceipts(deps(), actor, period);
        if (format === 'json') return file(name, JSON.stringify(archive, null, 2), 'json');
        return file(
          name,
          toCsv(
            [
              c('receiptNumber'),
              c('copy'),
              c('issuedAt'),
              c('businessDate'),
              c('order'),
              c('method'),
              c('amount'),
              c('tip'),
              c('rounding'),
              c('tax'),
              c('issuedBy'),
              c('hash'),
            ],
            archive.receipts.map((receipt) => [
              receipt.receiptNumber,
              receipt.copyNumber,
              receipt.issuedAt,
              receipt.businessDate,
              receipt.orderNumber,
              t(`methods.${receipt.method}`),
              csvFrancs(receipt.amountRappen),
              csvFrancs(receipt.tipRappen),
              csvFrancs(receipt.roundingRappen),
              csvFrancs(taxOf(receipt.taxes)),
              receipt.issuedBy,
              receipt.contentHash,
            ]),
          ),
          'csv',
        );
      }
      case 'closings': {
        const archive = await reports.archiveClosings(deps(), actor, period);
        if (format === 'json') return file(name, JSON.stringify(archive, null, 2), 'json');
        const totals = (closing: { totals: DailyClosingTotals }) => closing.totals;
        return file(
          name,
          toCsv(
            [
              c('closingNumber'),
              c('businessDate'),
              c('closedAt'),
              c('closedBy'),
              c('sales'),
              c('tax'),
              c('tips'),
              c('rounding'),
              c('refunds'),
              c('discounts'),
              c('voids'),
              c('cashDifference'),
              c('hash'),
            ],
            archive.closings.map((closing) => [
              closing.closingNumber,
              closing.businessDate,
              closing.closedAt,
              closing.closedBy,
              csvFrancs(totals(closing).grossSalesRappen),
              csvFrancs(taxOf(totals(closing).byTaxRate)),
              csvFrancs(totals(closing).tipsRappen),
              csvFrancs(totals(closing).roundingRappen),
              csvFrancs(totals(closing).refundsRappen),
              csvFrancs(totals(closing).discountsRappen),
              csvFrancs(totals(closing).voidsRappen),
              csvFrancs(totals(closing).cash.differenceRappen),
              closing.contentHash,
            ]),
          ),
          'csv',
        );
      }
      case 'cashbook': {
        const { books } = await reports.archiveCashBooks(deps(), actor, period);
        const tb = await getTranslations('cash.book');
        return file(
          name,
          toCsv(
            [
              c('businessDate'),
              c('time'),
              c('entry'),
              c('reference'),
              c('shift'),
              c('in'),
              c('out'),
              c('balance'),
            ],
            books.flatMap((book) => {
              const owner = new Map(book.shifts.map((shift) => [shift.id, shift.ownerName]));
              return book.lines.map((line) => [
                book.businessDate,
                line.at,
                tb(`kinds.${line.kind}`),
                line.reference,
                line.shiftId ? owner.get(line.shiftId) : '',
                line.amountRappen >= 0 ? csvFrancs(line.amountRappen) : '',
                line.amountRappen < 0 ? csvFrancs(-line.amountRappen) : '',
                csvFrancs(line.balanceRappen),
              ]);
            }),
          ),
          'csv',
        );
      }
      case 'audit':
        return auditExportFile(
          actor,
          {
            from: zurichStartOfDay(period.from),
            to: zurichStartOfDay(addDays(period.to, 1)),
          },
          format,
          name,
        );
    }
  } catch (error) {
    const apiError = toApiError(error);
    return new Response(apiError.message, { status: apiError.status });
  }
}
