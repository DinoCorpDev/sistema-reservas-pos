import type { BootstrapDto, OfflineCredentials } from '@pos/api';
import type { HlcState, Operation } from '@pos/core';
import Dexie, { type EntityTable } from 'dexie';
import { type DeviceApp, deviceApp } from './app';

/**
 * Local database of the terminal (IndexedDB through Dexie, docs/SYNC.md §13). It survives
 * reloads and works without network: the paired device, the configuration snapshot, the offline
 * credentials and every operation this device knows until the cloud confirms it. The POS and
 * the KDS each have their own (DEC-030).
 */

export interface PairedDevice {
  terminalId: string;
  terminalName: string;
  /** pos, handheld or kds (devices paired before Phase 3 lack it: they are POS). */
  terminalType?: string;
  deviceToken: string;
  organizationId: string;
  locationId: string;
  prefix: string;
  pairedAt: string;
}

export interface PinLock {
  failures: number;
  lockedUntil: number | null;
}

export interface Counters {
  businessDate: string;
  order: number;
  receipt: number;
}

/** Values kept in the `meta` table, by key. */
export interface MetaValues {
  device: PairedDevice;
  bootstrap: BootstrapDto;
  credentials: OfflineCredentials & { fetchedAt: string };
  hlc: HlcState;
  /** Median of serverTime − local time, in ms (docs/SYNC.md §3). */
  clockOffset: number;
  /** Pull cursor per node URL (the hub and the cloud number `seq` independently). */
  cursors: Record<string, number>;
  counters: Counters;
  pinLock: PinLock;
  storagePersisted: boolean;
}

export type MetaKey = keyof MetaValues;

export interface MetaRow {
  key: MetaKey;
  value: unknown;
}

export interface OperationRow {
  id: string;
  hlc: string;
  op: Operation;
  /** Made on this device (counts in "pending: N"). */
  own: 0 | 1;
  /** The cloud has it (docs/SYNC.md §1). */
  cloudAcked: 0 | 1;
  /** Nodes that confirmed it (hub URL or 'cloud'), so it is not resent there. */
  ackedBy: string[];
  conflicts: { code: string; entityId: string | null }[];
  rejected: 0 | 1;
}

class DeviceDatabase extends Dexie {
  meta!: EntityTable<MetaRow, 'key'>;
  ops!: EntityTable<OperationRow, 'id'>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ meta: 'key', ops: 'id, hlc, cloudAcked, own' });
  }
}

let database: DeviceDatabase | null = null;

/** The database of this app, opened on first use (after `configureDevice`). */
export function deviceDb(): DeviceDatabase {
  database ??= new DeviceDatabase(`sistema-reservas-${deviceApp()}`);
  return database;
}

export async function getMeta<K extends MetaKey>(key: K): Promise<MetaValues[K] | undefined> {
  const row = await deviceDb().meta.get(key);
  return row?.value as MetaValues[K] | undefined;
}

export async function setMeta<K extends MetaKey>(key: K, value: MetaValues[K]): Promise<void> {
  await deviceDb().meta.put({ key, value });
}

/** Hands a pairing to the other app of this browser (a KDS code entered in the POS, DEC-030). */
export async function storePairedDeviceFor(app: DeviceApp, device: PairedDevice): Promise<void> {
  const other = new DeviceDatabase(`sistema-reservas-${app}`);
  try {
    await other.meta.put({ key: 'device', value: device });
  } finally {
    other.close();
  }
}
