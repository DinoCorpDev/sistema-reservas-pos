import { cash, toApiError } from '@pos/api';
import { csvFrancs, toCsv } from '@pos/core';
import { getTranslations } from 'next-intl/server';
import { currentActor, deps } from '@/server/actor';

/** The daily cash book as CSV for the fiduciary (RF-D16): `;`, UTF-8 with BOM, francs. */
export async function GET(request: Request) {
  const day = new URL(request.url).searchParams.get('day') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return new Response('Invalid day', { status: 400 });
  try {
    const actor = await currentActor();
    const book = await cash.getCashBook(deps(), actor, day);
    const t = await getTranslations('cash.book');
    const owner = new Map(book.shifts.map((shift) => [shift.id, shift.ownerName]));
    const csv = toCsv(
      [t('time'), t('kind'), t('reference'), t('shift'), t('in'), t('out'), t('balance')],
      book.lines.map((line) => [
        line.at,
        t(`kinds.${line.kind}`),
        line.reference,
        line.shiftId ? owner.get(line.shiftId) : '',
        line.amountRappen >= 0 ? csvFrancs(line.amountRappen) : '',
        line.amountRappen < 0 ? csvFrancs(-line.amountRappen) : '',
        csvFrancs(line.balanceRappen),
      ]),
    );
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="kassenbuch-${day}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    const apiError = toApiError(error);
    return new Response(apiError.message, { status: apiError.status });
  }
}
