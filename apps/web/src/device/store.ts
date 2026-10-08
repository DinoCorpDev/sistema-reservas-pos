import type { BootstrapDto, OfflineCredentials } from '@pos/api';
import {
  createFoldState,
  type FoldState,
  type Permission,
  type PresenceSnapshot,
  type SyncLevel,
} from '@pos/core';
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

/** A printer as the hub last reported it (DEC-031). */
export interface PrinterHealth {
  ok: boolean;
  error: string | null;
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
  /** A newer version of the app is installed and waits for an idle moment. */
  updateWaiting: boolean;
  /** Printers by id, as the hub reports them over WebSocket (`printer.status`). */
  printers: Record<string, PrinterHealth>;
  /** Who is at the kitchen displays, from the last pull (DEC-033); null until one arrives. */
  presence: PresenceSnapshot | null;
  /** Deactivated or unpaired in the backoffice: nothing works until a new code (DEC-035). */
  revoked: boolean;
}

/**
 * State of the device app (POS or KDS, DEC-030). The name stays `usePos` for the POS screens;
 * `useDevice` reads better elsewhere.
 */
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
  printers: {},
  presence: null,
  revoked: false,
}));

export const getPos = () => usePos.getState();
export const useDevice = usePos;
export const getDevice = getPos;
