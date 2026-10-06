import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createApp } from './app';
import type { HubMessage } from './realtime';
import { startHub, type StartedHub } from './server';

describe('hub HTTP', () => {
  it('reports health with the database check', async () => {
    const app = createApp({ pingDatabase: async () => {}, connectedClients: () => 3 });
    const response = await app.request('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'ok',
      service: 'hub',
      checks: { database: 'ok' },
      connectedClients: 3,
    });
  });

  it('returns 503 when the local database is down', async () => {
    const app = createApp({
      pingDatabase: async () => {
        throw new Error('ECONNREFUSED');
      },
      connectedClients: () => 0,
    });
    const response = await app.request('/health');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: 'degraded',
      checks: { database: 'down' },
    });
  });
});

describe('hub realtime', () => {
  let hub: StartedHub | undefined;

  afterEach(async () => {
    await hub?.close();
    hub = undefined;
  });

  it('greets terminals over WebSocket and answers ping', async () => {
    hub = await startHub({ port: 0, hostname: '127.0.0.1', pingDatabase: null });
    const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/ws`);
    const messages: HubMessage[] = [];
    const received = new Promise<void>((resolve, reject) => {
      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()) as HubMessage);
        if (messages.length === 1) ws.send('ping');
        if (messages.length === 2) resolve();
      });
      ws.on('error', reject);
    });
    await received;
    ws.close();
    expect(messages.map((m) => m.type)).toEqual(['hub.hello', 'hub.pong']);
  });

  it('counts connected clients in /health', async () => {
    hub = await startHub({ port: 0, hostname: '127.0.0.1', pingDatabase: null });
    const ws = new WebSocket(`ws://127.0.0.1:${hub.port}/ws`);
    await new Promise((resolve) => ws.once('message', resolve));
    const response = await fetch(`http://127.0.0.1:${hub.port}/health`);
    expect(await response.json()).toMatchObject({
      connectedClients: 1,
      checks: { database: 'disabled' },
    });
    ws.close();
  });
});
