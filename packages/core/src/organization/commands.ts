import { z } from 'zod';
import { CONTENT_LANGUAGES, UI_LANGUAGES } from '../shared/languages';
import { QR_MODES } from '../tables/constants';
import { PRINTER_KINDS, PRINTER_PROTOCOLS, TERMINAL_TYPES } from './constants';
import { PERMISSIONS, ROLE_KEYS } from './permissions';
import { isValidSwissUid } from './uid';

/**
 * Input schemas of the organization commands, shared by the REST API and the backoffice forms.
 * They only validate; normalization (e.g. the canonical UID format) happens in the use case.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');

type WithoutDefaults<T extends z.ZodRawShape> = {
  [K in keyof T]: T[K] extends z.ZodDefault<infer Inner> ? Inner : T[K];
};

/**
 * PATCH schema of a create schema: every field optional and WITHOUT its default. Zod 4 keeps
 * inner defaults under `.partial()`, which would silently reset omitted fields on update.
 */
function patchOf<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [
      key,
      field instanceof z.ZodDefault ? field.unwrap() : field,
    ]),
  ) as WithoutDefaults<T>;
  return z.object(shape).partial();
}

export const openingHoursSchema = z.partialRecord(
  z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  z.array(z.tuple([hhmm, hhmm])).max(4),
);

export const updateLocationSchema = z
  .object({
    name: text(200),
    legalName: text(200),
    street: text(200),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{4}$/, 'Swiss postal code: 4 digits'),
    city: text(100),
    canton: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/)
      .nullable(),
    vatUid: z
      .string()
      .trim()
      .refine(isValidSwissUid, 'Invalid Swiss UID (CHE-123.456.789)')
      .nullable(),
    phone: optionalText(32),
    email: z.email().max(254).nullable(),
    timezone: text(64),
    defaultLanguage: z.enum(CONTENT_LANGUAGES),
    kitchenLanguage: z.enum(CONTENT_LANGUAGES),
    languages: z.array(z.enum(CONTENT_LANGUAGES)).min(1).max(4),
    receiptHeader: optionalText(500),
    receiptFooter: optionalText(500),
    openingHours: openingHoursSchema.nullable(),
  })
  .partial();
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

export const createAreaSchema = z.object({
  name: text(100),
  qrMode: z.enum(QR_MODES).default('view'),
  sortOrder: z.int().min(0).default(0),
  isActive: z.boolean().default(true),
});
export const updateAreaSchema = patchOf(createAreaSchema);

export const createTableSchema = z.object({
  areaId: z.uuid(),
  label: text(16),
  capacity: z.int().min(1).max(50).default(4),
  shape: z.enum(['rect', 'round']).default('rect'),
  posX: z.int().min(0).max(1000).default(0),
  posY: z.int().min(0).max(1000).default(0),
  width: z.int().min(1).max(20).default(1),
  height: z.int().min(1).max(20).default(1),
  /** null = inherits the area's QR mode (RF-E08). */
  qrMode: z.enum(QR_MODES).nullable().default(null),
  isActive: z.boolean().default(true),
});
export const updateTableSchema = patchOf(createTableSchema);

export const createKitchenStationSchema = z.object({
  name: text(100),
  /** null = the location's default alert threshold (RF-C24). */
  alertAfterMinutes: z.int().min(1).max(240).nullable().default(null),
  /** null = the location's kitchen language (RF-C25). */
  language: z.enum(CONTENT_LANGUAGES).nullable().default(null),
  printerId: z.uuid().nullable().default(null),
  sortOrder: z.int().min(0).default(0),
  isActive: z.boolean().default(true),
});
export const updateKitchenStationSchema = patchOf(createKitchenStationSchema);

export const createPrinterSchema = z.object({
  name: text(100),
  kind: z.enum(PRINTER_KINDS),
  protocol: z.enum(PRINTER_PROTOCOLS).default('escpos'),
  host: text(255),
  port: z.int().min(1).max(65535).default(9100),
  paperWidthMm: z.union([z.literal(58), z.literal(80)]).default(80),
  hasCashDrawer: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export const updatePrinterSchema = patchOf(createPrinterSchema);

export const createTerminalSchema = z.object({
  name: text(100),
  type: z.enum(TERMINAL_TYPES),
  /** Offline order-number prefix, unique per location (RN-16). */
  orderNumberPrefix: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{1,4}$/, '1-4 uppercase letters or digits'),
  kitchenStationId: z.uuid().nullable().default(null),
  receiptPrinterId: z.uuid().nullable().default(null),
});
export const updateTerminalSchema = patchOf(createTerminalSchema).extend({
  isActive: z.boolean().optional(),
});

const pin = z.string().regex(/^\d{4,6}$/, 'PIN: 4 to 6 digits');

export const createUserSchema = z.object({
  displayName: text(100),
  /** Backoffice access needs an email and a password (RF-A07). */
  email: z.email().max(254).nullable().default(null),
  password: z.string().min(10).max(200).nullable().default(null),
  pin: pin.nullable().default(null),
  uiLanguage: z.enum(UI_LANGUAGES).default('de'),
  roles: z.array(z.enum(ROLE_KEYS)).min(1),
  locationIds: z.array(z.uuid()).min(1),
});
export const updateUserSchema = z
  .object({
    displayName: text(100),
    email: z.email().max(254).nullable(),
    uiLanguage: z.enum(UI_LANGUAGES),
    roles: z.array(z.enum(ROLE_KEYS)).min(1),
    locationIds: z.array(z.uuid()).min(1),
    isActive: z.boolean(),
  })
  .partial();
export const setPinSchema = z.object({ pin });
export const setPasswordSchema = z.object({ password: z.string().min(10).max(200) });

/** Replaces the permissions of a role (RF-A05); the admin role always keeps all of them. */
export const setRolePermissionsSchema = z.object({
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
});

/** Organization API key (RF-F14). Scope names are validated by the API, which defines them. */
export const createApiKeySchema = z.object({
  name: text(100),
  scopes: z.array(z.string().trim().min(1).max(64)).min(1).max(20),
});

export const pairTerminalSchema = z.object({
  code: z.string().trim().min(8).max(12),
  appVersion: z.string().max(32).optional(),
});
export const unlockSchema = z.object({ pin });
export const approvalRequestSchema = z.object({
  pin,
  /** The action being approved, e.g. `void_item:<itemId>` (RF-A05). */
  action: z.string().min(1).max(120),
  permissions: z.array(z.enum(PERMISSIONS)).min(1).max(5),
});

/** Onboarding wizard of DINOLABS support: organization, first location and owner account (Flujo 7). */
export const onboardOrganizationSchema = z
  .object({
    organization: z.object({
      name: text(200),
      legalName: text(200),
      defaultLanguage: z.enum(CONTENT_LANGUAGES),
    }),
    location: z.object({
      name: text(200),
      legalName: text(200),
      street: text(200),
      postalCode: z.string().trim().regex(/^\d{4}$/, 'Swiss postal code: 4 digits'),
      city: text(100),
      canton: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}$/)
        .nullable()
        .default(null),
      vatUid: z
        .string()
        .trim()
        .refine(isValidSwissUid, 'Invalid Swiss UID (CHE-123.456.789)')
        .nullable()
        .default(null),
      languages: z.array(z.enum(CONTENT_LANGUAGES)).min(1).max(4),
      kitchenLanguage: z.enum(CONTENT_LANGUAGES),
    }),
    owner: z.object({
      displayName: text(100),
      email: z.email().max(254),
      uiLanguage: z.enum(UI_LANGUAGES).default('de'),
    }),
  })
  .refine((value) => value.location.languages.includes(value.organization.defaultLanguage), {
    path: ['location', 'languages'],
    message: 'The location languages must include the organization default language',
  });
export type OnboardOrganizationInput = z.output<typeof onboardOrganizationSchema>;

/** The owner's time-limited permission for DINOLABS support (RF-A10). */
export const createSupportGrantSchema = z.object({
  hours: z.int().min(1).max(72),
  reason: text(500),
  /** null = any active support staff member. */
  staffId: z.uuid().nullable().default(null),
});
export type CreateSupportGrantInput = z.output<typeof createSupportGrantSchema>;