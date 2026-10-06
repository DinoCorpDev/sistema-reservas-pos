import { z } from 'zod';
import { SHIFT_MODES } from '../cash/constants';

/**
 * Configuración operativa por sede (`locations.settings`). Los valores por defecto son los de
 * DEC-004 (sección 20 del documento); todos se cambian desde el backoffice sin código (PA-11).
 */
export const locationSettingsSchema = z.object({
  shiftMode: z.enum(SHIFT_MODES).default('terminal'),
  managerApproval: z
    .object({
      /** Descuentos por encima de este porcentaje (en bp: 2000 = 20 %) piden PIN de gerente (RN-15). */
      discountAboveBp: z.int().min(0).max(10000).default(2000),
      /** Anular un ítem ya enviado a cocina pide PIN de gerente (RN-15). */
      voidSentItem: z.boolean().default(true),
      /** Devoluciones por encima de este monto (Rp) piden PIN de gerente; 0 = siempre. */
      refundAboveRappen: z.int().min(0).default(0),
    })
    .prefault({}),
  reservations: z
    .object({
      /** La mesa reservada se bloquea estos minutos antes de la hora de reserva (RN-22). */
      blockMinutesBefore: z.int().min(0).default(15),
      /** Pasa a no-show tras estos minutos de espera, salvo que el gerente la mantenga (RN-22). */
      noShowAfterMinutes: z.int().min(1).default(20),
      /** Tiempo de ocupación por defecto para calcular disponibilidad (RF-E01). */
      defaultDurationMinutes: z.int().min(15).default(120),
    })
    .prefault({}),
  kitchen: z
    .object({
      /** Alerta de demora por defecto; cada estación puede tener la suya (RF-C24). */
      alertAfterMinutes: z.int().min(1).default(12),
    })
    .prefault({}),
  receipts: z
    .object({
      /** Desde este total (Rp) el sistema pide nombre del cliente en el recibo (RN-08: CHF 400 o más). */
      customerNameFromRappen: z.int().min(0).default(40000),
    })
    .prefault({}),
  security: z
    .object({
      /** Intentos de PIN fallidos antes de bloquear al usuario en el terminal (RNF-10). */
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
