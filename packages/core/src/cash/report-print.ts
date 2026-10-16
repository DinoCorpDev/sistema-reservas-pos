import type { PaymentMethod } from '../payments/constants';
import { type PrintDocument, type PrintLine, rule, wrapped } from '../printing/document';
import { formatChf, rappen } from '../shared/money';
import type { ContentLanguage } from '../shared/languages';
import type { CashMovementKind } from './constants';
import type { ShiftReport } from './report';

interface ShiftReportLabels {
  title: string;
  period: string;
  payments: string;
  refunds: string;
  taxes: string;
  tips: string;
  rounding: string;
  discounts: string;
  voids: string;
  cash: string;
  float: string;
  collected: string;
  paidOut: string;
  expected: string;
  counted: string;
  difference: string;
  comment: string;
  methods: Record<PaymentMethod, string>;
  movements: Record<CashMovementKind, string>;
}

/** Labels of the printed shift report, in the location's printing language. */
export const SHIFT_REPORT_LABELS: Readonly<Record<ContentLanguage, ShiftReportLabels>> = {
  de: {
    title: 'SCHICHTABSCHLUSS',
    period: 'Zeitraum',
    payments: 'Zahlungen',
    refunds: 'Rückerstattungen',
    taxes: 'MWST',
    tips: 'Trinkgeld',
    rounding: 'Rundung',
    discounts: 'Rabatte',
    voids: 'Stornos',
    cash: 'BARGELD',
    float: 'Wechselgeld',
    collected: 'Bar eingenommen',
    paidOut: 'Bar zurück',
    expected: 'Soll-Bestand',
    counted: 'Gezählt',
    difference: 'Differenz',
    comment: 'Begründung',
    methods: { cash: 'Bar', card: 'Karte', twint: 'TWINT', online: 'Online', voucher: 'Gutschein' },
    movements: {
      cash_in: 'Einlage',
      cash_out: 'Entnahme',
      expense: 'Ausgabe',
      correction: 'Korrektur',
    },
  },
  fr: {
    title: 'CLÔTURE DE SESSION',
    period: 'Période',
    payments: 'Paiements',
    refunds: 'Remboursements',
    taxes: 'TVA',
    tips: 'Pourboires',
    rounding: 'Arrondi',
    discounts: 'Rabais',
    voids: 'Annulations',
    cash: 'ESPÈCES',
    float: 'Fonds de caisse',
    collected: 'Espèces encaissées',
    paidOut: 'Espèces rendues',
    expected: 'Montant attendu',
    counted: 'Compté',
    difference: 'Écart',
    comment: 'Motif',
    methods: { cash: 'Espèces', card: 'Carte', twint: 'TWINT', online: 'En ligne', voucher: 'Bon' },
    movements: {
      cash_in: 'Apport',
      cash_out: 'Prélèvement',
      expense: 'Dépense',
      correction: 'Correction',
    },
  },
  it: {
    title: 'CHIUSURA TURNO',
    period: 'Periodo',
    payments: 'Pagamenti',
    refunds: 'Rimborsi',
    taxes: 'IVA',
    tips: 'Mance',
    rounding: 'Arrotondamento',
    discounts: 'Sconti',
    voids: 'Storni',
    cash: 'CONTANTI',
    float: 'Fondo cassa',
    collected: 'Contanti incassati',
    paidOut: 'Contanti resi',
    expected: 'Importo atteso',
    counted: 'Contato',
    difference: 'Differenza',
    comment: 'Motivo',
    methods: {
      cash: 'Contanti',
      card: 'Carta',
      twint: 'TWINT',
      online: 'Online',
      voucher: 'Buono',
    },
    movements: {
      cash_in: 'Versamento',
      cash_out: 'Prelievo',
      expense: 'Spesa',
      correction: 'Correzione',
    },
  },
  en: {
    title: 'SHIFT CLOSING',
    period: 'Period',
    payments: 'Payments',
    refunds: 'Refunds',
    taxes: 'VAT',
    tips: 'Tips',
    rounding: 'Rounding',
    discounts: 'Discounts',
    voids: 'Voids',
    cash: 'CASH',
    float: 'Float',
    collected: 'Cash taken',
    paidOut: 'Cash paid back',
    expected: 'Expected cash',
    counted: 'Counted',
    difference: 'Difference',
    comment: 'Reason',
    methods: { cash: 'Cash', card: 'Card', twint: 'TWINT', online: 'Online', voucher: 'Voucher' },
    movements: {
      cash_in: 'Cash in',
      cash_out: 'Cash out',
      expense: 'Expense',
      correction: 'Correction',
    },
  },
  es: {
    title: 'CIERRE DE TURNO',
    period: 'Periodo',
    payments: 'Pagos',
    refunds: 'Reembolsos',
    taxes: 'IVA',
    tips: 'Propinas',
    rounding: 'Redondeo',
    discounts: 'Descuentos',
    voids: 'Anulaciones',
    cash: 'EFECTIVO',
    float: 'Fondo de cambio',
    collected: 'Efectivo recibido',
    paidOut: 'Efectivo devuelto',
    expected: 'Efectivo esperado',
    counted: 'Contado',
    difference: 'Diferencia',
    comment: 'Motivo',
    methods: {
      cash: 'Efectivo',
      card: 'Tarjeta',
      twint: 'TWINT',
      online: 'En línea',
      voucher: 'Vale',
    },
    movements: {
      cash_in: 'Entrada',
      cash_out: 'Retiro',
      expense: 'Gasto',
      correction: 'Corrección',
    },
  },
};

/** "label ........ value" on one line of `width` columns. */
const pair = (label: string, value: string, width: number, bold = false): PrintLine => {
  const room = Math.max(1, width - value.length - 1);
  const left = label.length > room ? label.slice(0, room) : label;
  return { text: `${left}${' '.repeat(width - left.length - value.length)}${value}`, bold };
};

const money = (value: number) => formatChf(rappen(value), { currency: false });

function localTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('de-CH', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * The shift report on paper (RF-D15), from the report frozen in `shift.close`: the hub prints it
 * on the terminal's printer without folding anything (DEC-031).
 */
export function shiftReportDocument(
  report: ShiftReport,
  close: { countedRappen: number; expectedRappen: number; comment: string | null },
  options: { width: number; labels: ShiftReportLabels },
): PrintDocument {
  const { width, labels } = options;
  const lines: PrintLine[] = [
    { text: labels.title, bold: true, size: 'tall', align: 'center' },
    { text: report.ownerName, align: 'center' },
    ...wrapped(
      `${localTime(report.openedAt, report.timeZone)} – ${localTime(report.closedAt, report.timeZone)}`,
      width,
      { align: 'center' },
    ),
    rule(width),
    { text: labels.payments, bold: true },
  ];
  for (const p of report.payments) {
    lines.push(pair(`${labels.methods[p.method]} (${p.count})`, money(p.collectedRappen), width));
  }
  if (report.refunds.length > 0) {
    lines.push({ text: labels.refunds, bold: true });
    for (const r of report.refunds) {
      lines.push(pair(`${labels.methods[r.method]} (${r.count})`, money(-r.paidOutRappen), width));
    }
  }
  if (report.taxes.length > 0) {
    lines.push({ text: labels.taxes, bold: true });
    for (const rate of report.taxes) {
      lines.push(
        pair(
          `${(rate.rateBp / 100).toFixed(1)}% ${money(rate.grossRappen)}`,
          money(rate.taxRappen),
          width,
        ),
      );
    }
  }
  const tips =
    report.payments.reduce((s, p) => s + p.tipRappen, 0) -
    report.refunds.reduce((s, r) => s + r.tipRappen, 0);
  const rounding =
    report.payments.reduce((s, p) => s + p.roundingRappen, 0) -
    report.refunds.reduce((s, r) => s + r.roundingRappen, 0);
  lines.push(
    rule(width),
    pair(labels.tips, money(tips), width),
    pair(labels.rounding, money(rounding), width),
    pair(`${labels.discounts} (${report.discountCount})`, money(report.discountsRappen), width),
    pair(`${labels.voids} (${report.voidCount})`, money(report.voidsRappen), width),
    rule(width),
    { text: labels.cash, bold: true },
    pair(labels.float, money(report.cash.openingFloatRappen), width),
    pair(labels.collected, money(report.cash.collectedRappen), width),
  );
  if (report.cash.paidOutRappen !== 0)
    lines.push(pair(labels.paidOut, money(-report.cash.paidOutRappen), width));
  for (const m of report.movements) {
    lines.push(pair(`${labels.movements[m.kind]} (${m.count})`, money(m.amountRappen), width));
  }
  lines.push(
    pair(labels.expected, money(close.expectedRappen), width, true),
    pair(labels.counted, money(close.countedRappen), width, true),
    pair(labels.difference, money(close.countedRappen - close.expectedRappen), width, true),
  );
  if (close.comment) lines.push(...wrapped(`${labels.comment}: ${close.comment}`, width));
  return { lines, cut: true, openDrawer: false };
}
