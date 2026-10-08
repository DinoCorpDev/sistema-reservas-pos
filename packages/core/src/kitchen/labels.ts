import type { Allergen } from '../catalog/constants';
import type { Channel } from '../shared/channels';
import type { ContentLanguage } from '../shared/languages';

/**
 * Words of the kitchen ticket in the kitchen language (RF-C25): the KDS shows them and the hub
 * prints them. Content, not UI, like the receipt labels; allergen names are short for the paper.
 */
export interface KitchenLabels {
  table: string;
  order: string;
  course: string;
  /** Course 0 (DEC-011). */
  drinks: string;
  seat: string;
  note: string;
  allergens: string;
  /** "May contain" (traces). */
  traces: string;
  storno: string;
  reprint: string;
  sentBy: string;
  /** Before the name of the station an item comes from (DEC-033). */
  fromStation: string;
  testPage: string;
  testPageBody: string;
  channels: Record<Channel, string>;
  allergenNames: Record<Allergen, string>;
}

export const KITCHEN_LABELS: Readonly<Record<ContentLanguage, KitchenLabels>> = {
  de: {
    table: 'Tisch',
    order: 'Bestellung',
    course: 'Gang',
    drinks: 'Getränke',
    seat: 'Platz',
    note: 'Notiz',
    allergens: 'Allergene',
    traces: 'Spuren',
    storno: 'STORNO',
    reprint: 'NACHDRUCK',
    sentBy: 'Service',
    fromStation: 'für',
    testPage: 'TESTDRUCK',
    testPageBody: 'Der Drucker ist bereit.',
    channels: {
      table: 'Tisch',
      bar: 'Theke',
      takeaway: 'Mitnehmen',
      qr: 'QR',
      web: 'Web',
      delivery: 'Lieferung',
    },
    allergenNames: {
      gluten: 'Gluten',
      crustaceans: 'Krebstiere',
      eggs: 'Ei',
      fish: 'Fisch',
      peanuts: 'Erdnuss',
      soy: 'Soja',
      milk: 'Milch',
      tree_nuts: 'Nüsse',
      celery: 'Sellerie',
      mustard: 'Senf',
      sesame: 'Sesam',
      sulphites: 'Sulfite',
      lupin: 'Lupinen',
      molluscs: 'Weichtiere',
    },
  },
  fr: {
    table: 'Table',
    order: 'Commande',
    course: 'Service',
    drinks: 'Boissons',
    seat: 'Place',
    note: 'Note',
    allergens: 'Allergènes',
    traces: 'Traces',
    storno: 'ANNULÉ',
    reprint: 'RÉIMPRESSION',
    sentBy: 'Serveur',
    fromStation: 'pour',
    testPage: 'PAGE DE TEST',
    testPageBody: 'L’imprimante est prête.',
    channels: {
      table: 'Table',
      bar: 'Comptoir',
      takeaway: 'À emporter',
      qr: 'QR',
      web: 'Web',
      delivery: 'Livraison',
    },
    allergenNames: {
      gluten: 'Gluten',
      crustaceans: 'Crustacés',
      eggs: 'Œufs',
      fish: 'Poisson',
      peanuts: 'Arachides',
      soy: 'Soja',
      milk: 'Lait',
      tree_nuts: 'Fruits à coque',
      celery: 'Céleri',
      mustard: 'Moutarde',
      sesame: 'Sésame',
      sulphites: 'Sulfites',
      lupin: 'Lupin',
      molluscs: 'Mollusques',
    },
  },
  it: {
    table: 'Tavolo',
    order: 'Ordine',
    course: 'Portata',
    drinks: 'Bevande',
    seat: 'Posto',
    note: 'Nota',
    allergens: 'Allergeni',
    traces: 'Tracce',
    storno: 'STORNO',
    reprint: 'RISTAMPA',
    sentBy: 'Servizio',
    fromStation: 'per',
    testPage: 'STAMPA DI PROVA',
    testPageBody: 'La stampante è pronta.',
    channels: {
      table: 'Tavolo',
      bar: 'Banco',
      takeaway: 'Da asporto',
      qr: 'QR',
      web: 'Web',
      delivery: 'Consegna',
    },
    allergenNames: {
      gluten: 'Glutine',
      crustaceans: 'Crostacei',
      eggs: 'Uova',
      fish: 'Pesce',
      peanuts: 'Arachidi',
      soy: 'Soia',
      milk: 'Latte',
      tree_nuts: 'Frutta a guscio',
      celery: 'Sedano',
      mustard: 'Senape',
      sesame: 'Sesamo',
      sulphites: 'Solfiti',
      lupin: 'Lupini',
      molluscs: 'Molluschi',
    },
  },
  en: {
    table: 'Table',
    order: 'Order',
    course: 'Course',
    drinks: 'Drinks',
    seat: 'Seat',
    note: 'Note',
    allergens: 'Allergens',
    traces: 'Traces',
    storno: 'VOID',
    reprint: 'REPRINT',
    sentBy: 'Server',
    fromStation: 'for',
    testPage: 'TEST PAGE',
    testPageBody: 'The printer is ready.',
    channels: {
      table: 'Table',
      bar: 'Bar',
      takeaway: 'Takeaway',
      qr: 'QR',
      web: 'Web',
      delivery: 'Delivery',
    },
    allergenNames: {
      gluten: 'Gluten',
      crustaceans: 'Crustaceans',
      eggs: 'Egg',
      fish: 'Fish',
      peanuts: 'Peanut',
      soy: 'Soy',
      milk: 'Milk',
      tree_nuts: 'Tree nuts',
      celery: 'Celery',
      mustard: 'Mustard',
      sesame: 'Sesame',
      sulphites: 'Sulphites',
      lupin: 'Lupin',
      molluscs: 'Molluscs',
    },
  },
};

/** Course heading: "Getränke" for course 0, "Gang 2" otherwise. */
export function courseLabel(labels: KitchenLabels, course: number): string {
  return course === 0 ? labels.drinks : `${labels.course} ${course}`;
}

export function allergenName(labels: KitchenLabels, allergen: string): string {
  return labels.allergenNames[allergen as Allergen] ?? allergen;
}
