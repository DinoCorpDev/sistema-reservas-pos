import type { Database } from '@pos/db';
import type { CloudFetch } from './cloud';
import { syncConfig } from './config-sync';
import { forwardToCloud, type HubScope, pullFromCloud } from './forwarder';
import type { HubMessage } from './realtime';
import type { StateFile } from './state';

/**
 * The hub's link with the cloud (docs/SYNC.md §11.1): every few seconds it forwards what the
 * terminals sent, brings what reached the cloud directly and relays configuration changes. With
 * the internet down it keeps serving the LAN and tells the terminals (`cloud.status`).
 */
export function startCloudLink(deps: {
  db: Database;
  cloud: CloudFetch;
  scope: HubScope;
  state: StateFile;
  broadcast: (message: HubMessage) => void;
  intervalMs?: number;
  /** New operations arrived from the cloud (the print queue plans them). */
  onPulled?: () => void;
  /** The configuration changed and was copied (the print queue reloads it). */
  onConfigChanged?: () => Promise<void>;
}) {
  const interval = deps.intervalMs ?? 3_000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let online: boolean | null = null;
  let stopped = false;

  const setOnline = (value: boolean) => {
    if (online !== value) deps.broadcast({ type: 'cloud.status', online: value });
    online = value;
  };

  async function cycle(): Promise<void> {
    try {
      while ((await forwardToCloud(deps.db, deps.cloud, deps.scope)) > 0) {
        // Keep forwarding while there is a backlog.
      }
      const pulled = await pullFromCloud(
        deps.db,
        deps.cloud,
        deps.scope,
        deps.state.value.cloudCursor,
      );
      deps.state.update({ cloudCursor: pulled.cursor });
      if (pulled.inserted > 0) {
        deps.broadcast({ type: 'sync.applied', seq: null });
        deps.onPulled?.();
      }
      if (pulled.configVersion && pulled.configVersion !== deps.state.value.cloudConfigVersion) {
        await syncConfig(deps.db, deps.cloud);
        await deps.onConfigChanged?.();
        deps.state.update({ cloudConfigVersion: pulled.configVersion });
        deps.broadcast({ type: 'config.changed', configVersion: pulled.configVersion });
      }
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }

  function schedule(delay = interval) {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      running ??= cycle().finally(() => {
        running = null;
        schedule();
      });
    }, delay);
  }

  schedule(0);
  return {
    /** Runs a cycle soon (after terminals pushed something). */
    kick: () => schedule(100),
    /** One cycle now, awaited (tests). */
    runOnce: () => cycle(),
    isOnline: () => online === true,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
