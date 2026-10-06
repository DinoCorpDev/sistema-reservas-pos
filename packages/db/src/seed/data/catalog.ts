import type { Allergen, Channel, OriginKind, TaxCategoryKey } from '@pos/core';

/**
 * Carta del "Restaurant Demo Zürich": 30 productos suizos en 6 categorías, con alérgenos,
 * origen de carne/ave/pescado y traducciones FR/IT/EN (RF-B05…RF-B07). Precios en CHF con MWST
 * incluida; el seed los convierte a rappen con `parseChf`.
 */

type I18n = { fr: string; it: string; en: string };

export type StationKey = 'kitchen' | 'bar' | 'dessert';
export type CategoryKey =
  'starters' | 'mains' | 'desserts' | 'soft_drinks' | 'beer_wine' | 'coffee';
export type ModifierGroupKey = 'doneness' | 'side' | 'extras' | 'milk';

export interface SeedCategory {
  key: CategoryKey;
  name: string;
  i18n: I18n;
}

export interface SeedModifierGroup {
  key: ModifierGroupKey;
  name: string;
  i18n: I18n;
  minSelect: number;
  maxSelect: number;
  modifiers: { name: string; i18n: I18n; priceChf: string; allergens?: Allergen[] }[];
}

export interface SeedProduct {
  key: string;
  category: CategoryKey;
  name: string;
  i18n: I18n;
  description?: { de: string } & I18n;
  priceChf: string;
  taxCategory: TaxCategoryKey;
  course: number;
  stations: StationKey[];
  allergens: Allergen[];
  mayContain?: Allergen[];
  origins?: { kind: OriginKind; species: string; country: string }[];
  variants?: { name: string; i18n: I18n; priceChf: string; isDefault?: boolean }[];
  modifierGroups?: ModifierGroupKey[];
  channelPrices?: { channel: Channel; priceChf: string }[];
  /** Disponibilidad restringida: días (bitmask lun=1…dom=64) y franja horaria (RF-B08). */
  availability?: { daysOfWeek: number; start: string; end: string };
}

export const SEED_CATEGORIES: SeedCategory[] = [
  {
    key: 'starters',
    name: 'Vorspeisen',
    i18n: { fr: 'Entrées', it: 'Antipasti', en: 'Starters' },
  },
  {
    key: 'mains',
    name: 'Hauptgerichte',
    i18n: { fr: 'Plats principaux', it: 'Piatti principali', en: 'Main courses' },
  },
  { key: 'desserts', name: 'Desserts', i18n: { fr: 'Desserts', it: 'Dessert', en: 'Desserts' } },
  {
    key: 'soft_drinks',
    name: 'Alkoholfreie Getränke',
    i18n: { fr: 'Boissons sans alcool', it: 'Bevande analcoliche', en: 'Soft drinks' },
  },
  {
    key: 'beer_wine',
    name: 'Bier & Wein',
    i18n: { fr: 'Bières & vins', it: 'Birre & vini', en: 'Beer & wine' },
  },
  {
    key: 'coffee',
    name: 'Kaffee & Tee',
    i18n: { fr: 'Café & thé', it: 'Caffè & tè', en: 'Coffee & tea' },
  },
];

export const SEED_MODIFIER_GROUPS: SeedModifierGroup[] = [
  {
    key: 'doneness',
    name: 'Garstufe',
    i18n: { fr: 'Cuisson', it: 'Cottura', en: 'Doneness' },
    minSelect: 1,
    maxSelect: 1,
    modifiers: [
      { name: 'Saignant', i18n: { fr: 'Saignant', it: 'Al sangue', en: 'Rare' }, priceChf: '0' },
      { name: 'Medium', i18n: { fr: 'À point', it: 'Media cottura', en: 'Medium' }, priceChf: '0' },
      {
        name: 'Durchgebraten',
        i18n: { fr: 'Bien cuit', it: 'Ben cotto', en: 'Well done' },
        priceChf: '0',
      },
    ],
  },
  {
    key: 'side',
    name: 'Beilage',
    i18n: { fr: 'Accompagnement', it: 'Contorno', en: 'Side dish' },
    minSelect: 0,
    maxSelect: 1,
    modifiers: [
      {
        name: 'Pommes frites',
        i18n: { fr: 'Frites', it: 'Patatine fritte', en: 'French fries' },
        priceChf: '0',
      },
      { name: 'Rösti', i18n: { fr: 'Rösti', it: 'Rösti', en: 'Rösti' }, priceChf: '3.00' },
      {
        name: 'Saisongemüse',
        i18n: { fr: 'Légumes de saison', it: 'Verdure di stagione', en: 'Seasonal vegetables' },
        priceChf: '0',
      },
    ],
  },
  {
    key: 'extras',
    name: 'Extras',
    i18n: { fr: 'Suppléments', it: 'Extra', en: 'Extras' },
    minSelect: 0,
    maxSelect: 3,
    modifiers: [
      {
        name: 'Ohne Zwiebeln',
        i18n: { fr: 'Sans oignons', it: 'Senza cipolle', en: 'No onions' },
        priceChf: '0',
      },
      {
        name: 'Extra Käse',
        i18n: { fr: 'Supplément fromage', it: 'Formaggio extra', en: 'Extra cheese' },
        priceChf: '2.50',
        allergens: ['milk'],
      },
      {
        name: 'Sauce separat',
        i18n: { fr: 'Sauce à part', it: 'Salsa a parte', en: 'Sauce on the side' },
        priceChf: '0',
      },
    ],
  },
  {
    key: 'milk',
    name: 'Milch',
    i18n: { fr: 'Lait', it: 'Latte', en: 'Milk' },
    minSelect: 0,
    maxSelect: 1,
    modifiers: [
      {
        name: 'Laktosefreie Milch',
        i18n: { fr: 'Lait sans lactose', it: 'Latte senza lattosio', en: 'Lactose-free milk' },
        priceChf: '0.50',
        allergens: ['milk'],
      },
      {
        name: 'Hafermilch',
        i18n: { fr: "Lait d'avoine", it: "Latte d'avena", en: 'Oat milk' },
        priceChf: '0.80',
        allergens: ['gluten'],
      },
    ],
  },
];

const MON_TO_FRI = 0b0011111;
const L = (fr: string, it: string, en: string): I18n => ({ fr, it, en });

export const SEED_PRODUCTS: SeedProduct[] = [
  // ── Vorspeisen ──────────────────────────────────────────────────────────────
  {
    key: 'nuesslisalat',
    category: 'starters',
    name: 'Nüsslisalat mit Ei',
    i18n: L(
      "Salade de doucette à l'œuf",
      'Insalata di songino con uovo',
      "Lamb's lettuce with egg",
    ),
    priceChf: '14.50',
    taxCategory: 'food',
    course: 1,
    stations: ['kitchen'],
    allergens: ['eggs', 'mustard'],
  },
  {
    key: 'gerstensuppe',
    category: 'starters',
    name: 'Bündner Gerstensuppe',
    i18n: L("Soupe d'orge grisonne", "Zuppa d'orzo grigionese", 'Grisons barley soup'),
    priceChf: '11.00',
    taxCategory: 'food',
    course: 1,
    stations: ['kitchen'],
    allergens: ['gluten', 'celery', 'milk'],
    origins: [{ kind: 'meat', species: 'Rind', country: 'CH' }],
  },
  {
    key: 'rindstatar',
    category: 'starters',
    name: 'Rindstatar',
    i18n: L('Tartare de bœuf', 'Tartare di manzo', 'Beef tartare'),
    priceChf: '24.00',
    taxCategory: 'food',
    course: 1,
    stations: ['kitchen'],
    allergens: ['eggs', 'mustard', 'gluten'],
    origins: [{ kind: 'meat', species: 'Rind', country: 'CH' }],
  },
  {
    key: 'tomatensuppe',
    category: 'starters',
    name: 'Tomatensuppe',
    i18n: L('Soupe de tomates', 'Zuppa di pomodoro', 'Tomato soup'),
    priceChf: '10.50',
    taxCategory: 'food',
    course: 1,
    stations: ['kitchen'],
    allergens: ['milk', 'celery'],
  },
  {
    key: 'crevettencocktail',
    category: 'starters',
    name: 'Crevetten-Cocktail',
    i18n: L('Cocktail de crevettes', 'Cocktail di gamberi', 'Prawn cocktail'),
    priceChf: '18.50',
    taxCategory: 'food',
    course: 1,
    stations: ['kitchen'],
    allergens: ['crustaceans', 'eggs', 'mustard'],
    origins: [{ kind: 'fish', species: 'Crevetten', country: 'VN' }],
  },
  // ── Hauptgerichte ───────────────────────────────────────────────────────────
  {
    key: 'geschnetzeltes',
    category: 'mains',
    name: 'Zürcher Geschnetzeltes mit Rösti',
    i18n: L(
      'Émincé de veau à la zurichoise et rösti',
      'Sminuzzato di vitello alla zurighese con rösti',
      'Zurich-style sliced veal with rösti',
    ),
    priceChf: '38.50',
    taxCategory: 'food',
    course: 2,
    stations: ['kitchen'],
    allergens: ['milk', 'gluten'],
    origins: [{ kind: 'meat', species: 'Kalb', country: 'CH' }],
    modifierGroups: ['extras'],
    channelPrices: [{ channel: 'takeaway', priceChf: '34.00' }],
  },
  {
    key: 'wienerschnitzel',
    category: 'mains',
    name: 'Wiener Schnitzel mit Pommes frites',
    i18n: L(
      'Escalope viennoise et frites',
      'Cotoletta alla viennese con patatine',
      'Wiener schnitzel with fries',
    ),
    priceChf: '36.00',
    taxCategory: 'food',
    course: 2,
    stations: ['kitchen'],
    allergens: ['gluten', 'eggs', 'milk'],
    origins: [{ kind: 'meat', species: 'Kalb', country: 'CH' }],
  },
  {
    key: 'rindsfilet',
    category: 'mains',
    name: 'Rindsfilet mit Kräuterbutter',
    i18n: L(
      'Filet de bœuf au beurre aux herbes',
      'Filetto di manzo al burro alle erbe',
      'Beef fillet with herb butter',
    ),
    priceChf: '52.00',
    taxCategory: 'food',
    course: 2,
    stations: ['kitchen'],
    allergens: ['milk'],
    origins: [{ kind: 'meat', species: 'Rind', country: 'CH' }],
    modifierGroups: ['doneness', 'side'],
  },
  {
    key: 'pouletbrust',
    category: 'mains',
    name: 'Pouletbrust an Rahmsauce',
    i18n: L(
      'Suprême de poulet sauce à la crème',
      'Petto di pollo in salsa alla panna',
      'Chicken breast in cream sauce',
    ),
    priceChf: '32.00',
    taxCategory: 'food',
    course: 2,
    stations: ['kitchen'],
    allergens: ['milk', 'celery'],
    origins: [{ kind: 'poultry', species: 'Poulet', country: 'CH' }],
    modifierGroups: ['side'],
  },
  {
    key: 'eglifilets',
    category: 'mains',
    name: 'Egli-Filets mit Salzkartoffeln',
    i18n: L(
      'Filets de perche et pommes vapeur',
      'Filetti di pesce persico con patate lesse',
      'Perch fillets with boiled potatoes',
    ),
    priceChf: '39.00',
    taxCategory: 'food',
    course: 2,
    stations: ['kitchen'],
    allergens: ['fish', 'milk', 'gluten'],
    origins: [{ kind: 'fish', species: 'Egli', country: 'EE' }],
  },
  {
    key: 'kaesespaetzle',
    category: 'mains',
    name: 'Käsespätzle',
    i18n: L('Spätzle au fromage', 'Spätzle al formaggio', 'Cheese spätzle'),
    priceChf: '27.50',
    taxCategory: 'food',
    course: 2,
    stations: ['kitchen'],
    allergens: ['gluten', 'eggs', 'milk'],
    modifierGroups: ['extras'],
    channelPrices: [{ channel: 'takeaway', priceChf: '24.00' }],
  },
  {
    key: 'aelplermagronen',
    category: 'mains',
    name: 'Älplermagronen mit Apfelmus',
    i18n: L(
      'Macaronis du chalet et compote de pommes',
      "Maccheroni dell'alpigiano con purea di mele",
      'Alpine macaroni with apple sauce',
    ),
    priceChf: '26.00',
    taxCategory: 'food',
    course: 2,
    stations: ['kitchen'],
    allergens: ['gluten', 'milk'],
    origins: [{ kind: 'meat', species: 'Schwein', country: 'CH' }],
    modifierGroups: ['extras'],
  },
  {
    key: 'tagesmenue',
    category: 'mains',
    name: 'Tagesmenü',
    i18n: L('Menu du jour', 'Menù del giorno', 'Daily menu'),
    description: {
      de: 'Suppe, Hauptgang und Dessert des Tages',
      fr: 'Soupe, plat et dessert du jour',
      it: 'Zuppa, piatto e dessert del giorno',
      en: 'Soup, main course and dessert of the day',
    },
    priceChf: '24.50',
    taxCategory: 'food',
    course: 2,
    stations: ['kitchen', 'dessert'],
    allergens: ['gluten', 'milk', 'celery', 'eggs'],
    origins: [{ kind: 'meat', species: 'Rind', country: 'CH' }],
    channelPrices: [{ channel: 'takeaway', priceChf: '19.50' }],
    availability: { daysOfWeek: MON_TO_FRI, start: '11:30:00', end: '14:00:00' },
  },
  // ── Desserts ────────────────────────────────────────────────────────────────
  {
    key: 'vermicelles',
    category: 'desserts',
    name: 'Vermicelles mit Meringue',
    i18n: L(
      'Vermicelles et meringue',
      'Vermicelles con meringa',
      'Chestnut vermicelli with meringue',
    ),
    priceChf: '12.50',
    taxCategory: 'food',
    course: 3,
    stations: ['dessert'],
    allergens: ['milk', 'eggs'],
  },
  {
    key: 'kirschtorte',
    category: 'desserts',
    name: 'Zuger Kirschtorte',
    i18n: L('Tourte au kirsch de Zoug', 'Torta al kirsch di Zugo', 'Zug cherry cake'),
    priceChf: '9.50',
    taxCategory: 'food',
    course: 3,
    stations: ['dessert'],
    allergens: ['gluten', 'eggs', 'milk', 'tree_nuts'],
  },
  {
    key: 'meringue',
    category: 'desserts',
    name: 'Meringue mit Doppelrahm',
    i18n: L('Meringue à la double crème', 'Meringa con doppia panna', 'Meringue with double cream'),
    priceChf: '11.00',
    taxCategory: 'food',
    course: 3,
    stations: ['dessert'],
    allergens: ['eggs', 'milk'],
  },
  {
    key: 'coupedaenemark',
    category: 'desserts',
    name: 'Coupe Dänemark',
    i18n: L('Coupe Danemark', 'Coppa Danimarca', 'Coupe Denmark'),
    priceChf: '12.00',
    taxCategory: 'food',
    course: 3,
    stations: ['dessert'],
    allergens: ['milk'],
    mayContain: ['tree_nuts', 'peanuts'],
  },
  // ── Alkoholfreie Getränke ───────────────────────────────────────────────────
  {
    key: 'mineralwasser',
    category: 'soft_drinks',
    name: 'Mineralwasser',
    i18n: L('Eau minérale', 'Acqua minerale', 'Mineral water'),
    priceChf: '4.50',
    taxCategory: 'non_alcoholic_beverage',
    course: 0,
    stations: ['bar'],
    allergens: [],
    variants: [
      { name: '3 dl', i18n: L('3 dl', '3 dl', '3 dl'), priceChf: '4.50', isDefault: true },
      { name: '5 dl', i18n: L('5 dl', '5 dl', '5 dl'), priceChf: '6.50' },
    ],
  },
  {
    key: 'rivella',
    category: 'soft_drinks',
    name: 'Rivella Rot 3.3 dl',
    i18n: L('Rivella rouge 3.3 dl', 'Rivella rossa 3.3 dl', 'Rivella red 3.3 dl'),
    priceChf: '5.20',
    taxCategory: 'non_alcoholic_beverage',
    course: 0,
    stations: ['bar'],
    allergens: ['milk'],
  },
  {
    key: 'apfelschorle',
    category: 'soft_drinks',
    name: 'Apfelschorle',
    i18n: L('Jus de pomme gazeux', 'Succo di mela frizzante', 'Apple spritzer'),
    priceChf: '4.80',
    taxCategory: 'non_alcoholic_beverage',
    course: 0,
    stations: ['bar'],
    allergens: [],
    variants: [
      { name: '3 dl', i18n: L('3 dl', '3 dl', '3 dl'), priceChf: '4.80', isDefault: true },
      { name: '5 dl', i18n: L('5 dl', '5 dl', '5 dl'), priceChf: '6.80' },
    ],
  },
  {
    key: 'eistee',
    category: 'soft_drinks',
    name: 'Hausgemachter Eistee',
    i18n: L('Thé froid maison', 'Tè freddo fatto in casa', 'Homemade iced tea'),
    priceChf: '5.50',
    taxCategory: 'non_alcoholic_beverage',
    course: 0,
    stations: ['bar'],
    allergens: [],
  },
  {
    key: 'orangensaft',
    category: 'soft_drinks',
    name: 'Frisch gepresster Orangensaft',
    i18n: L("Jus d'orange frais", "Spremuta d'arancia", 'Freshly squeezed orange juice'),
    priceChf: '7.50',
    taxCategory: 'non_alcoholic_beverage',
    course: 0,
    stations: ['bar'],
    allergens: [],
  },
  // ── Bier & Wein ─────────────────────────────────────────────────────────────
  {
    key: 'bier_vom_fass',
    category: 'beer_wine',
    name: 'Lager vom Fass',
    i18n: L('Bière pression', 'Birra alla spina', 'Draught lager'),
    priceChf: '5.50',
    taxCategory: 'alcoholic_beverage',
    course: 0,
    stations: ['bar'],
    allergens: ['gluten'],
    variants: [
      { name: '3 dl', i18n: L('3 dl', '3 dl', '3 dl'), priceChf: '5.50', isDefault: true },
      { name: '5 dl', i18n: L('5 dl', '5 dl', '5 dl'), priceChf: '7.50' },
    ],
  },
  {
    key: 'amber_bier',
    category: 'beer_wine',
    name: 'Amber Bier 3.3 dl',
    i18n: L('Bière ambrée 3.3 dl', 'Birra ambrata 3.3 dl', 'Amber beer 3.3 dl'),
    priceChf: '6.50',
    taxCategory: 'alcoholic_beverage',
    course: 0,
    stations: ['bar'],
    allergens: ['gluten'],
  },
  {
    key: 'raeuschling',
    category: 'beer_wine',
    name: 'Räuschling Zürichsee',
    i18n: L(
      'Räuschling du lac de Zurich',
      'Räuschling del lago di Zurigo',
      'Räuschling Lake Zurich',
    ),
    priceChf: '7.50',
    taxCategory: 'alcoholic_beverage',
    course: 0,
    stations: ['bar'],
    allergens: ['sulphites'],
    variants: [
      { name: '1 dl', i18n: L('1 dl', '1 dl', '1 dl'), priceChf: '7.50', isDefault: true },
      {
        name: 'Flasche 75 cl',
        i18n: L('Bouteille 75 cl', 'Bottiglia 75 cl', 'Bottle 75 cl'),
        priceChf: '54.00',
      },
    ],
  },
  {
    key: 'pinot_noir',
    category: 'beer_wine',
    name: 'Pinot Noir Graubünden',
    i18n: L('Pinot noir des Grisons', 'Pinot nero dei Grigioni', 'Pinot Noir Grisons'),
    priceChf: '8.50',
    taxCategory: 'alcoholic_beverage',
    course: 0,
    stations: ['bar'],
    allergens: ['sulphites'],
    variants: [
      { name: '1 dl', i18n: L('1 dl', '1 dl', '1 dl'), priceChf: '8.50', isDefault: true },
      {
        name: 'Flasche 75 cl',
        i18n: L('Bouteille 75 cl', 'Bottiglia 75 cl', 'Bottle 75 cl'),
        priceChf: '62.00',
      },
    ],
  },
  {
    key: 'prosecco',
    category: 'beer_wine',
    name: 'Prosecco 1 dl',
    i18n: L('Prosecco 1 dl', 'Prosecco 1 dl', 'Prosecco 1 dl'),
    priceChf: '9.00',
    taxCategory: 'alcoholic_beverage',
    course: 0,
    stations: ['bar'],
    allergens: ['sulphites'],
  },
  {
    // Cerveza sin alcohol: bebida sin alcohol para la MWST (tasa reducida para llevar). Caso límite de RN-03.
    key: 'alkoholfreies_bier',
    category: 'beer_wine',
    name: 'Alkoholfreies Bier 3.3 dl',
    i18n: L('Bière sans alcool 3.3 dl', 'Birra analcolica 3.3 dl', 'Alcohol-free beer 3.3 dl'),
    priceChf: '5.50',
    taxCategory: 'non_alcoholic_beverage',
    course: 0,
    stations: ['bar'],
    allergens: ['gluten'],
  },
  // ── Kaffee & Tee ────────────────────────────────────────────────────────────
  {
    key: 'kaffee_creme',
    category: 'coffee',
    name: 'Kaffee Crème',
    i18n: L('Café crème', 'Caffè crema', 'Coffee with cream'),
    priceChf: '4.80',
    taxCategory: 'non_alcoholic_beverage',
    course: 0,
    stations: ['bar'],
    allergens: ['milk'],
    modifierGroups: ['milk'],
  },
  {
    key: 'cappuccino',
    category: 'coffee',
    name: 'Cappuccino',
    i18n: L('Cappuccino', 'Cappuccino', 'Cappuccino'),
    priceChf: '5.50',
    taxCategory: 'non_alcoholic_beverage',
    course: 0,
    stations: ['bar'],
    allergens: ['milk'],
    modifierGroups: ['milk'],
  },
];
