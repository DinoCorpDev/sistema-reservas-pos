import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { get } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as acme from 'acme-client';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { CloudFetch } from './cloud';
import { startHub, type StartedHub } from './server';
import { HubTls, lanAddress } from './tls';

/**
 * HTTPS of the hub (DEC-028): the hub keeps its key, asks the cloud with a CSR for its name and
 * its LAN address, and serves the certificate once issued; the HTTPS listener carries the same
 * API and real-time channel, and a renewal swaps the certificate in place.
 */

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, 'test-fixtures', name), 'utf8');
const HOSTNAME = 'h-0123456789ab.hub.test.example';

/** A cloud in memory that answers like `/sync/hub-certificate`. */
function fakeCloud(state: { enabled: boolean; issue: string | null }) {
  const posts: { lanIp: string; csr: string }[] = [];
  const view = (status: string) => ({
    enabled: state.enabled,
    hostname: state.enabled ? HOSTNAME : null,
    status,
    certificatePem: status === 'issued' ? state.issue : null,
    notAfter: null,
    lastError: null,
  });
  const cloud: CloudFetch = async (_path, init) => {
    if (init?.method === 'POST') {
      posts.push(init.body as { lanIp: string; csr: string });
      return Response.json(view(state.issue ? 'issued' : 'pending'));
    }
    return Response.json(view(posts.length === 0 ? 'none' : state.issue ? 'issued' : 'pending'));
  };
  return { cloud, posts };
}

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-tls-'));
  dirs.push(dir);
  return dir;
};
let hub: StartedHub | null = null;

afterEach(async () => {
  await hub?.close();
  hub = null;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the hub certificate (DEC-028)', () => {
  it('uses HUB_LAN_IP, else the first private IPv4 of the PC', () => {
    expect(lanAddress('10.1.2.3', {})).toBe('10.1.2.3');
    expect(
      lanAddress(undefined, {
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true } as never],
        wlan0: [
          { address: 'fe80::1', family: 'IPv6', internal: false } as never,
          { address: '192.168.1.40', family: 'IPv4', internal: false } as never,
        ],
      }),
    ).toBe('192.168.1.40');
    expect(lanAddress(undefined, {})).toBeNull();
  });

  it('does nothing while the cloud has no DNS zone', async () => {
    const { cloud, posts } = fakeCloud({ enabled: false, issue: null });
    const installed: string[] = [];
    const tls = new HubTls({
      dir: tempDir(),
      cloud,
      lanIp: () => '192.168.1.40',
      install: async ({ cert }) => installed.push(cert),
    });
    expect(await tls.refresh()).toBe('disabled');
    expect(posts).toEqual([]);
    expect(installed).toEqual([]);
  });

  it('asks with a CSR for its name, keeps its key and serves the certificate once issued', async () => {
    const state = { enabled: true, issue: null as string | null };
    const { cloud, posts } = fakeCloud(state);
    const dir = tempDir();
    const installed: { key: string; cert: string }[] = [];
    const tls = new HubTls({
      dir,
      cloud,
      lanIp: () => '192.168.1.40',
      install: async (pem) => installed.push(pem),
    });

    expect(await tls.refresh()).toBe('pending');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.lanIp).toBe('192.168.1.40');
    expect(acme.crypto.readCsrDomains(posts[0]!.csr)).toMatchObject({ commonName: HOSTNAME });
    const key = readFileSync(join(dir, 'key.pem'), 'utf8');
    expect(installed).toEqual([]);

    state.issue = 'CERT A';
    expect(await tls.refresh()).toBe('issued');
    expect(installed).toEqual([{ key, cert: 'CERT A' }]);
    expect(readFileSync(join(dir, 'cert.pem'), 'utf8')).toBe('CERT A');
    // The same CSR every time: the private key never changes and never leaves the hub.
    expect(posts[1]!.csr).toBe(posts[0]!.csr);

    // Nothing new: nothing to swap. A renewal: swapped.
    await tls.refresh();
    expect(installed).toHaveLength(1);
    state.issue = 'CERT B';
    await tls.refresh();
    expect(installed.map((pem) => pem.cert)).toEqual(['CERT A', 'CERT B']);

    // After a restart, without internet, it serves the stored certificate at once.
    const offline = new HubTls({
      dir,
      cloud: async () => {
        throw new Error('offline');
      },
      lanIp: () => '192.168.1.40',
      install: async (pem) => installed.push(pem),
    });
    await offline.start();
    offline.stop();
    expect(installed.at(-1)).toEqual({ key, cert: 'CERT B' });
  });

  it('serves the same API and real-time channel over HTTPS and swaps the certificate', async () => {
    hub = await startHub({ port: 0, hostname: '127.0.0.1', pingDatabase: null });
    const key = fixture('localhost.key');
    const cert = fixture('localhost.crt');
    const port = await hub.serveTls({ port: 0, hostname: '127.0.0.1', key, cert });

    const health = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      get(
        { host: '127.0.0.1', port, path: '/health', ca: cert, servername: 'localhost' },
        (res) => {
          let body = '';
          res.on('data', (chunk: Buffer) => (body += chunk.toString()));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        },
      ).on('error', reject);
    });
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toMatchObject({ service: 'hub' });

    // The certificate names localhost; the hub listens on 127.0.0.1 (TLS options pass through).
    const secure = { ca: cert, servername: 'localhost' };
    const ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, secure);
    const hello = await new Promise<{ type: string }>((resolve, reject) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString()) as { type: string }));
      ws.once('error', reject);
    });
    expect(hello.type).toBe('hub.hello');
    ws.close();

    // A renewed certificate takes the same port.
    expect(await hub.serveTls({ port: 0, key, cert })).toBe(port);
  });
});
