import type { BootstrapDto, OfflineCredentials } from '@pos/api';
import { createFoldState, type FoldState, type Permission, type SyncLevel } from '@pos/core';
import { create } from 'zustand';
import type { PairedDevice } from './db';

/** The person working on the terminal after entering their PIN (RF-A06). */
export interface PosUser {
  id: string;
  displayName: string;
  uiLanguage: string;
  permissions: ReadonlySet<Permission>;
}

export interface SyncStatus {
  /** Highest level reached (docs/SYNC.md §1): standalone, hub or cloud. */
  level: SyncLevel;
  /** URL of the node in use (hub URL or the cloud origin), null when standalone. */
  node: string | null;
  /** Operations of this device the cloud has not confirmed yet ("pending: N"). */
  pending: number;
  lastSyncAt: string | null;
  /** Operations the server rejected as malformed; shown to the manager. */
  rejected: number;
}

export interface PosState {
  ready: boolean;
  device: PairedDevice | null;
  bootstrap: BootstrapDto | null;
  credentials: OfflineCredentials | null;
  user: PosUser | null;
  /** State of the location's orders: the fold of every operation known (DEC-021). */
  fold: FoldState;
  /** Bumped on every change of `fold` (it is updated in place for speed). */
  foldVersion: number;
  sync: SyncStatus;
  /** A newer version of the POS is installed and waits for an idle moment. */
  updateWaiting: boolean;
}

export const usePos = create<PosState>(() => ({
  ready: false,
  device: null,
  bootstrap: null,
  credentials: null,
  user: null,
  fold: createFoldState(),
  foldVersion: 0,
  sync: { level: 'standalone', node: null, pending: 0, lastSyncAt: null, rejected: 0 },
  updateWaiting: false,
}));

export const getPos = () => usePos.getState();
