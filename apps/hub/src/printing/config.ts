import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { BootstrapDto, HubConfigDto } from '@pos/api';
import type { CloudFetch } from '../cloud';
import { cloudJson } from '../cloud';

/**
 * What the hub needs to print (DEC-031): printers and stations, which terminal prints where,
 * tables and users for the ticket header, and the catalog for names and allergens in the
 * kitchen language. It comes from the cloud (`/pos/bootstrap`, `/sync/hub-config`) with every
 * configuration change and is kept in a file, so the hub prints after a restart without internet.
 */
export interface PrintConfig {
  location: BootstrapDto['location'];
  stations: BootstrapDto['stations'];
  printers: BootstrapDto['printers'];
  tables: { id: string; label: string }[];
  users: BootstrapDto['users'];
  terminals: Pick<
    HubConfigDto['terminals'][number],
    'id' | 'name' | 'type' | 'receiptPrinterId' | 'kitchenStationId'
  >[];
  catalog: BootstrapDto['catalog'];
}

export async function fetchPrintConfig(cloud: CloudFetch): Promise<PrintConfig> {
  const [bootstrap, hub] = await Promise.all([
    cloudJson<BootstrapDto>(cloud, '/pos/bootstrap'),
    cloudJson<HubConfigDto>(cloud, '/sync/hub-config'),
  ]);
  return {
    location: bootstrap.location,
    stations: bootstrap.stations,
    printers: bootstrap.printers,
    tables: bootstrap.tables.map((t) => ({ id: t.id, label: t.label })),
    users: bootstrap.users,
    terminals: hub.terminals.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      receiptPrinterId: t.receiptPrinterId,
      kitchenStationId: t.kitchenStationId,
    })),
    catalog: bootstrap.catalog,
  };
}

/** The last configuration received, in memory and in a file next to the hub state. */
export class PrintConfigCache {
  private config: PrintConfig | null;

  constructor(private readonly path: string | null) {
    this.config =
      path && existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as PrintConfig) : null;
  }

  get value(): PrintConfig | null {
    return this.config;
  }

  save(config: PrintConfig): void {
    this.config = config;
    if (this.path) writeFileSync(this.path, JSON.stringify(config), 'utf8');
  }

  /** Brings the configuration from the cloud; keeps the stored one if the cloud is unreachable. */
  async refresh(cloud: CloudFetch): Promise<boolean> {
    try {
      this.save(await fetchPrintConfig(cloud));
      return true;
    } catch {
      return false;
    }
  }
}
