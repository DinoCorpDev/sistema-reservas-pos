import { z } from 'zod';
import { SHIFT_MODES } from '../cash/constants';

/**
 * Operational settings per location (`locations.settings`). The defaults are those of
 * DEC-004 (section 20 of the document); all are editable from the backoffice without code (PA-11).
 */
export const locationSettingsSchema = z.object({
  shiftMode: z.enum(SHIFT_MODES).default('terminal'),
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
    })
    .prefault({}),
});

export type LocationSettings = z.infer<typeof locationSettingsSchema>;

export function parseLocationSettings(input: unknown): LocationSettings {
  return locationSettingsSchema.parse(input ?? {});
}

export const DEFAULT_LOCATION_SETTINGS: LocationSettings = parseLocationSettings({});
