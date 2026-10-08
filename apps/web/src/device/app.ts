/**
 * Which client app runs on this device (DEC-030): the POS (`/pos`) or the kitchen display
 * (`/kds`). Both use the same runtime (local database, engine, sync, PIN) but keep their own
 * local database, so a POS and a KDS opened in the same browser are two different devices.
 */
export type DeviceApp = 'pos' | 'kds';

let current: DeviceApp = 'pos';

/** Called by the app's entry before it boots. */
export function configureDevice(app: DeviceApp): void {
  current = app;
}

export const deviceApp = (): DeviceApp => current;

/** Terminal types each app accepts (RF-A03): a KDS pairing code does not open the POS. */
export const TERMINAL_TYPES_OF: Readonly<Record<DeviceApp, readonly string[]>> = {
  pos: ['pos', 'handheld'],
  kds: ['kds'],
};
