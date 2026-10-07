import type { BootstrapDto, OfflineCredentials } from '@pos/api';
import type { HlcState, Operation } from '@pos/core';
import Dexie, { type EntityTable } from 'dexie';

/**
 * Local database of the POS terminal (IndexedDB through Dexie, docs/SYNC.md §13). It survives
 * reloads and works without network: the paired device, the configuration snapshot, the offline
 * credentials and every operation this device knows until the cloud confirms it.
 */

export interface PairedDevice {
  terminalId: string;
  terminalName: string;
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

class PosDatabase extends Dexie {
  meta!: EntityTable<MetaRow, 'key'>;
  ops!: EntityTable<OperationRow, 'id'>;

  constructor() {
    super('sistema-reservas-pos');
    this.version(1).stores({ meta: 'key', ops: 'id, hlc, cloudAcked, own' });
  }
}

export const posDb = new PosDatabase();

export async function getMeta<K extends MetaKey>(key: K): Promise<MetaValues[K] | undefined> {
  const row = await posDb.meta.get(key);
  return row?.value as MetaValues[K] | undefined;
}

export async function setMeta<K extends MetaKey>(key: K, value: MetaValues[K]): Promise<void> {
  await posDb.meta.put({ key, value });
}
