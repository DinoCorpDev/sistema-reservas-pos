import { z } from 'zod';
import { SHIFT_MODES } from '../cash/constants';
import { DISCOUNT_KINDS } from '../orders/constants';
import { TABLE_OWNERSHIP_MODES } from '../tables/constants';

/** A frequent discount shown as a button on the POS (RF-C11). `code` is the reason code. */
export const discountPresetSchema = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  /** Own label; the standard codes (staff, courtesy, promotion) are translated by the UI. */
  label: z.string().trim().max(40).nullable().default(null),
  kind: z.enum(DISCOUNT_KINDS),
  /** Basis points for `percent` (1000 = 10 %), rappen for `amount`. */
  value: z.int().min(1),
});
export type DiscountPreset = z.infer<typeof discountPresetSchema>;

/**
 * Operational settings per location (`locations.settings`). The defaults are those of
 * DEC-004 (section 20 of the document); all are editable from the backoffice without code (PA-11).
 */
export const locationSettingsSchema = z.object({
  /** Who collects cash: only the till, each waiter's wallet, or both (RF-D12, DEC-038). */
  shiftMode: z.enum(SHIFT_MODES).default('terminal'),
  /** Who may work on a table's order: any waiter, or its own waiter only (DEC-039). */
  tableOwnership: z.enum(TABLE_OWNERSHIP_MODES).default('open'),
  /** Local time at which a new business day starts (DEC-022): order numbers and the Z closing. */
  businessDayStartsAt: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default('04:00'),
  managerApproval: z
    .object({
      /** Discounts above this percentage (in bp: 2000 = 20 %) require a manager PIN (RN-15). */
      discountAboveBp: z.int().min(0).max(10000).default(2000),
      /** Voiding an item already sent to the kitchen requires a manager PIN (RN-15). */
      voidSentItem: z.boolean().default(true),
      /** Refunds above this amount (Rp) require a manager PIN; 0 = always. */
      refundAboveRappen: z.int().min(0).default(0),
    })
    .prefault({}),
  reservations: z
    .object({
      /** The reserved table is blocked this many minutes before the reservation time (RN-22). */
      blockMinutesBefore: z.int().min(0).default(15),
      /** Becomes a no-show after this many minutes, unless the manager holds it (RN-22). */
      noShowAfterMinutes: z.int().min(1).default(20),
      /** Default occupancy time used to compute availability (RF-E01). */
      defaultDurationMinutes: z.int().min(15).default(120),
    })
    .prefault({}),
  kitchen: z
    .object({
      /** Default delay alert; each station can have its own (RF-C24). */
      alertAfterMinutes: z.int().min(1).default(12),
    })
    .prefault({}),
  printing: z
    .object({
      /**
       * The hub does not print what is older than this (DEC-031): a hub that comes back late does
       * not flood the kitchen with tickets that were already cooked from the KDS.
       */
      maxDelayMinutes: z.int().min(1).max(240).default(15),
    })
    .prefault({}),
  receipts: z
    .object({
      /** From this total (Rp) the system asks for the customer name on the receipt (RN-08: CHF 400+). */
      customerNameFromRappen: z.int().min(0).default(40000),
    })
    .prefault({}),
  security: z
    .object({
      /** Failed PIN attempts before the user is locked out on the terminal (RNF-10). */
      maxPinAttempts: z.int().min(3).default(5),
      pinLockMinutes: z.int().min(1).default(5),
      /** A person is signed in on one device at a time (DEC-040). */
      oneDevicePerPerson: z.boolean().default(true),
    })
    .prefault({}),
  pos: z
    .object({
      /**
       * `tables`: a floor plan with tables. `counter`: a café or a bar that sells at the counter;
       * the setup checklist does not ask for areas and tables (DEC-045).
       */
      serviceStyle: z.enum(['tables', 'counter']).default('tables'),
      /** Frequent discounts as buttons (RF-C11); above the threshold they still need a manager. */
      discountPresets: z
        .array(discountPresetSchema)
        .max(8)
        .default([
          { code: 'staff', label: null, kind: 'percent', value: 5000 },
          { code: 'courtesy', label: null, kind: 'percent', value: 10000 },
          { code: 'promotion', label: null, kind: 'percent', value: 1000 },
        ]),
    })
    .prefault({}),
  sync: z
    .object({
      /**
       * LAN hubs of the location, in order (docs/SYNC.md §1, §11). The first one numbers orders;
       * empty = no hub, the cloud numbers them.
       */
      hubUrls: z
        .array(z.url({ protocol: /^(https?|wss?)$/ }))
        .max(3)
        .default([]),
    })
    .prefault({}),
});

export type LocationSettings = z.infer<typeof locationSettingsSchema>;

export function parseLocationSettings(input: unknown): LocationSettings {
  return locationSettingsSchema.parse(input ?? {});
}

export const DEFAULT_LOCATION_SETTINGS: LocationSettings = parseLocationSettings({});
