import { randomBytes } from 'node:crypto';
import {
  type ConsumptionType,
  type ContentLanguage,
  DEFAULT_ROLE_PERMISSIONS,
  newId,
  ROLE_KEYS,
  type RoleKey,
  type TaxCategoryKey,
  type TaxRateCode,
} from '@pos/core';
import type { Transaction } from '../unit-of-work';
import * as s from '../schema';

/**
 * Starting template of every new organization (Flujo 7, PA-11): the five predefined roles with
 * their default permissions and the Swiss MWST setup. It is DATA copied into the organization;
 * the owner edits it from the backoffice afterwards (RF-B13).
 */

export const ROLE_NAMES: Record<ContentLanguage, Record<RoleKey, string>> = {
  de: {
    admin: 'Administrator',
    manager: 'Geschäftsführung',
    cashier: 'Kasse',
    waiter: 'Service',
    kitchen: 'Küche',
  },
  fr: {
    admin: 'Administrateur',
    manager: 'Gérance',
    cashier: 'Caisse',
    waiter: 'Service',
    kitchen: 'Cuisine',
  },
  it: {
    admin: 'Amministratore',
    manager: 'Gerenza',
    cashier: 'Cassa',
    waiter: 'Servizio',
    kitchen: 'Cucina',
  },
  en: {
    admin: 'Administrator',
    manager: 'Manager',
    cashier: 'Cashier',
    waiter: 'Service',
    kitchen: 'Kitchen',
  },
  es: {
    admin: 'Administrador',
    manager: 'Gerencia',
    cashier: 'Caja',
    waiter: 'Mesero',
    kitchen: 'Cocina',
  },
};

export const SWISS_TAX_CATEGORY_NAMES: Record<ContentLanguage, Record<TaxCategoryKey, string>> = {
  de: {
    food: 'Speisen',
    non_alcoholic_beverage: 'Alkoholfreie Getränke',
    alcoholic_beverage: 'Alkoholische Getränke',
    accommodation: 'Beherbergung',
    other: 'Übrige',
  },
  fr: {
    food: 'Mets',
    non_alcoholic_beverage: 'Boissons sans alcool',
    alcoholic_beverage: 'Boissons alcoolisées',
    accommodation: 'Hébergement',
    other: 'Autres',
  },
  it: {
    food: 'Cibi',
    non_alcoholic_beverage: 'Bevande analcoliche',
    alcoholic_beverage: 'Bevande alcoliche',
    accommodation: 'Alloggio',
    other: 'Altro',
  },
  en: {
    food: 'Food',
    non_alcoholic_beverage: 'Soft drinks',
    alcoholic_beverage: 'Alcoholic drinks',
    accommodation: 'Accommodation',
    other: 'Other',
  },
  es: {
    food: 'Comida',
    non_alcoholic_beverage: 'Bebidas sin alcohol',
    alcoholic_beverage: 'Bebidas alcohólicas',
    accommodation: 'Alojamiento',
    other: 'Otros',
  },
};

/** Swiss rates since 2024 plus the previous ones, so validity periods can be checked (RN-02). */
export const SWISS_TAX_RATES: {
  code: TaxRateCode;
  rateBp: number;
  validFrom: string;
  validTo: string | null;
}[] = [
  { code: 'normal', rateBp: 770, validFrom: '2018-01-01', validTo: '2023-12-31' },
  { code: 'reduced', rateBp: 250, validFrom: '2018-01-01', validTo: '2023-12-31' },
  { code: 'accommodation', rateBp: 370, validFrom: '2018-01-01', validTo: '2023-12-31' },
  { code: 'normal', rateBp: 810, validFrom: '2024-01-01', validTo: null },
  { code: 'reduced', rateBp: 260, validFrom: '2024-01-01', validTo: null },
  { code: 'accommodation', rateBp: 380, validFrom: '2024-01-01', validTo: null },
];

/** RN-03: on premise, normal rate; food and soft drinks for takeaway or delivery, reduced; alcohol always normal. */
export const SWISS_TAX_RULES: Record<TaxCategoryKey, Record<ConsumptionType, TaxRateCode>> = {
  food: { on_premise: 'normal', takeaway: 'reduced', delivery: 'reduced' },
  non_alcoholic_beverage: { on_premise: 'normal', takeaway: 'reduced', delivery: 'reduced' },
  alcoholic_beverage: { on_premise: 'normal', takeaway: 'normal', delivery: 'normal' },
  accommodation: {
    on_premise: 'accommodation',
    takeaway: 'accommodation',
    delivery: 'accommodation',
  },
  other: { on_premise: 'normal', takeaway: 'normal', delivery: 'normal' },
};

const SWISS_RULES_VALID_FROM = '2018-01-01';

/** Fresh secret for `organizations.pin_key` (DEC-015). */
export function newPinKey(): string {
  return randomBytes(32).toString('hex');
}

export interface AppliedTemplate {
  roleIds: Record<RoleKey, string>;
  taxCategoryIds: Record<TaxCategoryKey, string>;
}

/** Copies roles, permissions and the Swiss MWST setup into a new organization. */
export async function applyOrganizationTemplate(
  tx: Transaction,
  organizationId: string,
  language: ContentLanguage,
): Promise<AppliedTemplate> {
  const org = { organizationId };
  const roleIds = {} as Record<RoleKey, string>;
  for (const key of ROLE_KEYS) {
    const roleId = newId();
    roleIds[key] = roleId;
    await tx
      .insert(s.roles)
      .values({ id: roleId, ...org, key, name: ROLE_NAMES[language][key], isSystem: true });
    await tx
      .insert(s.rolePermissions)
      .values(DEFAULT_ROLE_PERMISSIONS[key].map((permission) => ({ ...org, roleId, permission })));
  }

  const taxCategoryIds = {} as Record<TaxCategoryKey, string>;
  for (const [key, name] of Object.entries(SWISS_TAX_CATEGORY_NAMES[language]) as [
    TaxCategoryKey,
    string,
  ][]) {
    const id = newId();
    taxCategoryIds[key] = id;
    await tx.insert(s.taxCategories).values({ id, ...org, key, name });
  }
  await tx.insert(s.taxRates).values(SWISS_TAX_RATES.map((rate) => ({ ...org, ...rate })));
  await tx.insert(s.taxRules).values(
    (
      Object.entries(SWISS_TAX_RULES) as [TaxCategoryKey, Record<ConsumptionType, TaxRateCode>][]
    ).flatMap(([categoryKey, byConsumption]) =>
      (Object.entries(byConsumption) as [ConsumptionType, TaxRateCode][]).map(
        ([consumptionType, rateCode]) => ({
          ...org,
          taxCategoryId: taxCategoryIds[categoryKey],
          consumptionType,
          rateCode,
          validFrom: SWISS_RULES_VALID_FROM,
        }),
      ),
    ),
  );
  return { roleIds, taxCategoryIds };
}
