import type { PaymentMethod } from '../payments/constants';
import type { ContentLanguage } from '../shared/languages';

/**
 * Words printed on customer receipts, per receipt language (RF-D23). They are document
 * content, not UI: each receipt stores them resolved, so a copy prints the same words (RN-10).
 */
export interface ReceiptLabels {
  receipt: string;
  receiptNumber: string;
  order: string;
  table: string;
  date: string;
  servedBy: string;
  subtotal: string;
  discount: string;
  total: string;
  vat: string;
  vatRate: string;
  net: string;
  gross: string;
  paidWith: string;
  tip: string;
  rounding: string;
  tendered: string;
  change: string;
  paidBefore: string;
  balance: string;
  partialPayment: string;
  customer: string;
  copy: string;
  thankYou: string;
  /** Suffix of the UID on the receipt (RN-08): MWST, TVA or IVA. */
  vatSuffix: string;
  methods: Record<PaymentMethod, string>;
}

export const RECEIPT_LABELS: Readonly<Record<ContentLanguage, ReceiptLabels>> = {
  de: {
    receipt: 'Quittung',
    receiptNumber: 'Beleg-Nr.',
    order: 'Bestellung',
    table: 'Tisch',
    date: 'Datum',
    servedBy: 'Bedient von',
    subtotal: 'Zwischensumme',
    discount: 'Rabatt',
    total: 'Total',
    vat: 'MWST',
    vatRate: 'Satz',
    net: 'Netto',
    gross: 'Brutto',
    paidWith: 'Bezahlt mit',
    tip: 'Trinkgeld',
    rounding: 'Rundung',
    tendered: 'Gegeben',
    change: 'Rückgeld',
    paidBefore: 'Bereits bezahlt',
    balance: 'Offener Betrag',
    partialPayment: 'Teilzahlung',
    customer: 'Kunde',
    copy: 'KOPIE',
    thankYou: 'Vielen Dank für Ihren Besuch',
    vatSuffix: 'MWST',
    methods: { cash: 'Bar', card: 'Karte', twint: 'TWINT', online: 'Online', voucher: 'Gutschein' },
  },
  fr: {
    receipt: 'Quittance',
    receiptNumber: 'N° de ticket',
    order: 'Commande',
    table: 'Table',
    date: 'Date',
    servedBy: 'Servi par',
    subtotal: 'Sous-total',
    discount: 'Rabais',
    total: 'Total',
    vat: 'TVA',
    vatRate: 'Taux',
    net: 'Net',
    gross: 'Brut',
    paidWith: 'Payé par',
    tip: 'Pourboire',
    rounding: 'Arrondi',
    tendered: 'Reçu',
    change: 'Monnaie rendue',
    paidBefore: 'Déjà payé',
    balance: 'Solde dû',
    partialPayment: 'Paiement partiel',
    customer: 'Client',
    copy: 'COPIE',
    thankYou: 'Merci de votre visite',
    vatSuffix: 'TVA',
    methods: { cash: 'Espèces', card: 'Carte', twint: 'TWINT', online: 'En ligne', voucher: 'Bon' },
  },
  it: {
    receipt: 'Ricevuta',
    receiptNumber: 'N. scontrino',
    order: 'Ordine',
    table: 'Tavolo',
    date: 'Data',
    servedBy: 'Servito da',
    subtotal: 'Subtotale',
    discount: 'Sconto',
    total: 'Totale',
    vat: 'IVA',
    vatRate: 'Aliquota',
    net: 'Netto',
    gross: 'Lordo',
    paidWith: 'Pagato con',
    tip: 'Mancia',
    rounding: 'Arrotondamento',
    tendered: 'Ricevuto',
    change: 'Resto',
    paidBefore: 'Già pagato',
    balance: 'Saldo aperto',
    partialPayment: 'Pagamento parziale',
    customer: 'Cliente',
    copy: 'COPIA',
    thankYou: 'Grazie per la visita',
    vatSuffix: 'IVA',
    methods: {
      cash: 'Contanti',
      card: 'Carta',
      twint: 'TWINT',
      online: 'Online',
      voucher: 'Buono',
    },
  },
  en: {
    receipt: 'Receipt',
    receiptNumber: 'Receipt no.',
    order: 'Order',
    table: 'Table',
    date: 'Date',
    servedBy: 'Served by',
    subtotal: 'Subtotal',
    discount: 'Discount',
    total: 'Total',
    vat: 'VAT',
    vatRate: 'Rate',
    net: 'Net',
    gross: 'Gross',
    paidWith: 'Paid with',
    tip: 'Tip',
    rounding: 'Rounding',
    tendered: 'Tendered',
    change: 'Change',
    paidBefore: 'Already paid',
    balance: 'Balance due',
    partialPayment: 'Partial payment',
    customer: 'Customer',
    copy: 'COPY',
    thankYou: 'Thank you for your visit',
    vatSuffix: 'MWST',
    methods: { cash: 'Cash', card: 'Card', twint: 'TWINT', online: 'Online', voucher: 'Voucher' },
  },
  es: {
    receipt: 'Recibo',
    receiptNumber: 'Recibo n.º',
    order: 'Pedido',
    table: 'Mesa',
    date: 'Fecha',
    servedBy: 'Le atendió',
    subtotal: 'Subtotal',
    discount: 'Descuento',
    total: 'Total',
    vat: 'IVA',
    vatRate: 'Tasa',
    net: 'Neto',
    gross: 'Bruto',
    paidWith: 'Pagado con',
    tip: 'Propina',
    rounding: 'Redondeo',
    tendered: 'Recibido',
    change: 'Cambio',
    paidBefore: 'Ya pagado',
    balance: 'Saldo pendiente',
    partialPayment: 'Pago parcial',
    customer: 'Cliente',
    copy: 'COPIA',
    thankYou: 'Gracias por su visita',
    vatSuffix: 'IVA',
    methods: {
      cash: 'Efectivo',
      card: 'Tarjeta',
      twint: 'TWINT',
      online: 'En línea',
      voucher: 'Vale',
    },
  },
};

/**
 * Mark of a receipt printed in a training organization (RF-F22): stored with the receipt only
 * when it is one, so real receipts keep their labels.
 */
export const TRAINING_RECEIPT_LABELS: Readonly<Record<ContentLanguage, string>> = {
  de: 'ÜBUNG — KEIN GÜLTIGER BELEG',
  fr: 'EXERCICE — PAS UN JUSTIFICATIF VALABLE',
  it: 'ESERCITAZIONE — RICEVUTA NON VALIDA',
  en: 'TRAINING — NOT A VALID RECEIPT',
  es: 'PRÁCTICA — NO ES UN RECIBO VÁLIDO',
};

/** Labels as stored in the frozen content: a flat map (`methods.cash`, `total`…). */
export function flattenLabels(labels: ReceiptLabels): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (typeof value === 'string') flat[key] = value;
    else {
      for (const [method, text] of Object.entries(value as Record<string, string>)) {
        flat[`methods.${method}`] = text;
      }
    }
  }
  return flat;
}
