import type { OrderItemState } from '../orders/state';
import type { PaymentMethod } from '../payments/constants';
import type { ContentLanguage } from '../shared/languages';
import { type Rappen, rappen } from '../shared/money';
import { allocate, extractTax, summarizeByRate, type TaxSummaryLine } from '../tax/calculation';
import type { ReceiptContent } from './content';
import { flattenLabels, RECEIPT_LABELS } from './labels';

export type ReceiptErrorCode = 'CUSTOMER_NAME_REQUIRED' | 'VAT_UID_MISSING' | 'NOTHING_TO_RECEIPT';

export class ReceiptError extends Error {
  override readonly name = 'ReceiptError';
  constructor(
    readonly code: ReceiptErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Data of the location printed on every receipt (RF-A02, RN-08). */
export interface ReceiptLocation {
  name: string;
  legalName: string | null;
  street: string;
  postalCode: string;
  city: string;
  /** UID `CHE-123.456.789`; printed with the MWST/TVA/IVA suffix. */
  vatUid: string | null;
  header: string | null;
  footer: string | null;
}

/** The UID as printed (RN-08): `CHE-123.456.789 MWST` (TVA in French, IVA in Italian). */
export function formatVatNumber(vatUid: string, language: ContentLanguage): string {
  return `${vatUid} ${RECEIPT_LABELS[language].vatSuffix}`;
}

type TaxedLine = Pick<
  OrderItemState,
  'lineTotalRappen' | 'taxRappen' | 'taxRateCode' | 'taxRateBp'
>;

/**
 * MWST per rate of what one payment covers (DEC-024):
 * - a single payment of the whole order prints the sums of its lines (DEC-016);
 * - a partial payment splits its amount over the rates in proportion to the order's gross per
 *   rate (largest remainder) and extracts the tax per rate. Each receipt stands on its own, so
 *   the result does not depend on the order of the payments.
 */
export function receiptTaxes(
  lines: readonly TaxedLine[],
  orderTotalRappen: Rappen,
  amountRappen: Rappen,
): TaxSummaryLine[] {
  // A rate with nothing left (e.g. only 100 %-discounted lines) is not printed in either path.
  const summary = summarizeByRate(lines).filter((rate) => rate.grossRappen !== 0);
  if (amountRappen === orderTotalRappen || summary.length === 0) return summary;
  const shares = allocate(
    amountRappen,
    summary.map((rate) => Math.max(0, rate.grossRappen)),
  );
  return summary
    .map((rate, index) => {
      const gross = shares[index]!;
      const tax = extractTax(gross, rate.rateBp);
      return {
        rateCode: rate.rateCode,
        rateBp: rate.rateBp,
        grossRappen: gross,
        taxRappen: tax,
        netRappen: rappen(gross - tax),
      };
    })
    .filter((rate) => rate.grossRappen !== 0);
}

export interface ReceiptLineInput extends TaxedLine {
  name: string;
  variantName: string | null;
  quantity: number;
  unitPriceRappen: Rappen;
  modifiers: readonly { name: string; priceDeltaRappen: Rappen; quantity: number }[];
  discountRappen: Rappen;
}

/**
 * Builds the frozen content of the receipt of one payment (RF-D20, RN-08, RN-09, DEC-024).
 * `lines` are the valid lines of the order, already named in the receipt language.
 */
export function buildReceipt(input: {
  language: ContentLanguage;
  location: ReceiptLocation;
  receiptNumber: string;
  orderNumber: string;
  tableLabel: string | null;
  servedBy: string | null;
  timeZone: string;
  issuedAt: string;
  order: { subtotalRappen: Rappen; discountTotalRappen: Rappen; totalRappen: Rappen };
  lines: readonly ReceiptLineInput[];
  payment: {
    method: PaymentMethod;
    amountRappen: Rappen;
    tipRappen: Rappen;
    roundingRappen: Rappen;
    tenderedRappen: Rappen | null;
    changeRappen: Rappen;
    splitLabel: string | null;
  };
  /** Sale amount paid by earlier payments of the order, net of refunds. */
  paidBeforeRappen: Rappen;
  customer: { name: string; address: string | null } | null;
  /** RN-08 threshold from the location settings (DEC-009). */
  customerNameFromRappen: number;
}): ReceiptContent {
  const { language, location, payment, order } = input;
  if (!location.vatUid) {
    throw new ReceiptError('VAT_UID_MISSING', 'The location has no UID for the receipt (RN-08)');
  }
  if (input.lines.length === 0) {
    throw new ReceiptError('NOTHING_TO_RECEIPT', 'A receipt needs at least one line');
  }
  const customerName = input.customer?.name.trim() ?? '';
  if (payment.amountRappen >= input.customerNameFromRappen && customerName === '') {
    throw new ReceiptError(
      'CUSTOMER_NAME_REQUIRED',
      'From CHF 400 the receipt carries the customer name (RN-08)',
    );
  }

  const balanceAfter = rappen(order.totalRappen - input.paidBeforeRappen - payment.amountRappen);
  const isPartial = input.paidBeforeRappen > 0 || balanceAfter > 0;

  return {
    version: 1,
    language,
    labels: flattenLabels(RECEIPT_LABELS[language]),
    location: {
      name: location.name,
      legalName: location.legalName,
      street: location.street,
      postalCode: location.postalCode,
      city: location.city,
      vatNumber: formatVatNumber(location.vatUid, language),
      header: location.header,
      footer: location.footer,
    },
    receiptNumber: input.receiptNumber,
    orderNumber: input.orderNumber,
    tableLabel: input.tableLabel,
    issuedAt: input.issuedAt,
    timeZone: input.timeZone,
    servedBy: input.servedBy,
    lines: input.lines.map((line) => ({
      name: line.name,
      variantName: line.variantName,
      quantity: line.quantity,
      unitPriceRappen: line.unitPriceRappen,
      modifiers: line.modifiers.map((m) => ({ ...m })),
      discountRappen: line.discountRappen,
      totalRappen: line.lineTotalRappen,
      taxRateCode: line.taxRateCode,
      taxRateBp: line.taxRateBp,
    })),
    totals: {
      grossRappen: order.subtotalRappen,
      discountRappen: order.discountTotalRappen,
      totalRappen: order.totalRappen,
    },
    taxes: receiptTaxes(input.lines, order.totalRappen, payment.amountRappen),
    payment: {
      method: payment.method,
      amountRappen: payment.amountRappen,
      tipRappen: payment.tipRappen,
      roundingRappen: payment.roundingRappen,
      collectedRappen: rappen(payment.amountRappen + payment.tipRappen + payment.roundingRappen),
      tenderedRappen: payment.tenderedRappen,
      changeRappen: payment.changeRappen,
      splitLabel: payment.splitLabel,
    },
    partial: isPartial
      ? { paidBeforeRappen: input.paidBeforeRappen, balanceAfterRappen: balanceAfter }
      : null,
    customer:
      customerName === ''
        ? null
        : { name: customerName, address: input.customer?.address?.trim() || null },
  };
}
