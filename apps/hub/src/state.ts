import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Persistent state of the hub (docs/SYNC.md §11.2): its own device token (it is paired like a
 * terminal), the location it serves and the cloud pull cursor. A small JSON file next to the
 * service, so the hub resumes after a restart without internet.
 */
export interface HubState {
  deviceToken: string | null;
  organizationId: string | null;
  locationId: string | null;
  /** Last cloud `seq` pulled. */
  cloudCursor: number;
  /** Configuration version of the cloud, relayed to the terminals (RF-F23). */
  cloudConfigVersion: string | null;
}

const EMPTY: HubState = {
  deviceToken: null,
  organizationId: null,
  locationId: null,
  cloudCursor: 0,
  cloudConfigVersion: null,
};

export class StateFile {
  private state: HubState;

  constructor(private readonly path: string | null) {
    this.state =
      path && existsSync(path)
        ? { ...EMPTY, ...(JSON.parse(readFileSync(path, 'utf8')) as Partial<HubState>) }
        : { ...EMPTY };
  }

  get value(): Readonly<HubState> {
    return this.state;
  }

  update(patch: Partial<HubState>): void {
    this.state = { ...this.state, ...patch };
    if (this.path) writeFileSync(this.path, JSON.stringify(this.state, null, 2), 'utf8');
  }
}
