import type { FloorPhotoReading } from '@pos/core';
import { schema as s } from '@pos/db';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveActor } from '../auth/resolve-actor';
import { readFloorPhoto } from '../services/locations';
import {
  createOtherOrganization,
  createTestApi,
  type DemoContext,
  demoSession,
  loadDemo,
} from '../testing';

/**
 * The floor plan of an area (DEC-056): saved as the editor shows it, in one transaction, and
 * proposed from a photo by the AI without saving anything (PA-07). Against MySQL, on an area of
 * its own so the demo keeps its tables.
 */

const api = createTestApi();
let demo: DemoContext;
let admin: Record<string, string>;
let areaId: string;
let tableIds: Record<string, string>;

type Body = Record<string, unknown> & {
  error?: { code: string; details?: Record<string, unknown> };
};

const call = async (
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) => {
  const response = await api.request(method, path, { headers, ...(body ? { body } : {}) });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as Body };
};

const tablesOfArea = () =>
  api.db
    .select()
    .from(s.diningTables)
    .where(and(eq(s.diningTables.areaId, areaId), isNull(s.diningTables.deletedAt)));

const at = (id: string | null, label: string, posX: number, posY: number, width = 1) => ({
  id,
  label,
  capacity: 4,
  shape: 'rect',
  posX,
  posY,
  width,
  height: 1,
});

beforeAll(async () => {
  demo = await loadDemo(api.db);
  admin = api.as(demoSession(demo, 'admin'));
  const area = await call('POST', '/areas', admin, { name: 'Garten Plan' });
  areaId = area.body.id as string;
  tableIds = {};
  for (const label of ['G1', 'G2']) {
    const table = await call('POST', '/tables', admin, { areaId, label });
    tableIds[label] = table.body.id as string;
  }
});

afterAll(async () => {
  await api.close();
});

describe('the floor plan of an area (DEC-056)', () => {
  it('moves existing tables and creates new ones in one save, audited', async () => {
    const saved = await call('PUT', `/areas/${areaId}/layout`, admin, {
      tables: [at(tableIds.G1!, 'G1', 0, 0, 2), at(tableIds.G2!, 'G2', 3, 0), at(null, 'G3', 0, 2)],
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ created: 1, updated: 2 });
    const rows = await tablesOfArea();
    const byLabel = Object.fromEntries(rows.map((row) => [row.label, row]));
    expect(byLabel.G1).toMatchObject({ posX: 0, posY: 0, width: 2 });
    expect(byLabel.G2).toMatchObject({ posX: 3, posY: 0 });
    expect(byLabel.G3).toMatchObject({ posX: 0, posY: 2, locationId: demo.locationId });
    expect(byLabel.G3?.qrCode).toHaveLength(12);
    const [audit] = await api.db
      .select()
      .from(s.auditEvents)
      .where(
        and(eq(s.auditEvents.entityId, areaId), eq(s.auditEvents.action, 'floor.layout_saved')),
      );
    expect(audit?.after).toMatchObject({ created: 1, updated: 2 });
  });

  it('lets two tables swap their names in one save', async () => {
    const saved = await call('PUT', `/areas/${areaId}/layout`, admin, {
      tables: [at(tableIds.G1!, 'G2', 0, 0), at(tableIds.G2!, 'G1', 3, 0)],
    });
    expect(saved.status).toBe(200);
    const [one] = await api.db
      .select({ label: s.diningTables.label })
      .from(s.diningTables)
      .where(eq(s.diningTables.id, tableIds.G1!));
    expect(one?.label).toBe('G2');
  });

  it('refuses overlaps, a label of another area and a manager without the permission', async () => {
    const overlap = await call('PUT', `/areas/${areaId}/layout`, admin, {
      tables: [at(tableIds.G1!, 'G1', 0, 0, 2), at(tableIds.G2!, 'G2', 1, 0)],
    });
    expect(overlap.status).toBe(422);
    // "1" is a table of the demo's main room.
    const taken = await call('PUT', `/areas/${areaId}/layout`, admin, {
      tables: [at(null, '1', 6, 6)],
    });
    expect(taken.status).toBe(409);
    expect(taken.body.error?.details).toMatchObject({ reason: 'label_taken', label: '1' });
    const waiter = api.as(demoSession(demo, 'waiter'));
    expect((await call('PUT', `/areas/${areaId}/layout`, waiter, { tables: [] })).status).toBe(403);
  });

  it('says the photo needs an AI key when none is configured', async () => {
    const response = await call('POST', `/areas/${areaId}/floor-photo`, admin, {
      mediaType: 'image/jpeg',
      data: 'A'.repeat(200),
    });
    expect(response.status).toBe(422);
    expect(response.body.error?.details).toMatchObject({ reason: 'ai_not_configured' });
  });

  it('turns what the AI saw into a proposal on the grid and saves nothing', async () => {
    const before = await tablesOfArea();
    const reading: FloorPhotoReading = {
      tables: [
        { label: 'G1', shape: 'round', x: 10, y: 10, width: 10, height: 10, seats: 2 },
        { label: null, shape: 'rect', x: 40, y: 10, width: 10, height: 10, seats: null },
        { label: '1', shape: 'rect', x: 10, y: 50, width: 10, height: 10, seats: 6 },
      ],
      notes: 'Eine Ecke ist abgeschnitten.',
    };
    let context: unknown;
    const actor = (await resolveActor(api.db, {
      authorization: null,
      locationHeader: null,
      terminalToken: null,
      approvalToken: null,
      session: demoSession(demo, 'admin'),
      requestId: 'floor-photo-test',
    }))!;
    const proposal = await readFloorPhoto(
      { db: api.db },
      actor,
      areaId,
      { mediaType: 'image/jpeg', data: 'A'.repeat(200) },
      async (_photo, ctx) => {
        context = ctx;
        return reading;
      },
    );
    expect(context).toMatchObject({ areaName: 'Garten Plan' });
    expect(proposal.notes).toBe('Eine Ecke ist abgeschnitten.');
    // "G1" keeps its name; the unnamed table and "1" (taken in the main room) get free numbers.
    const labels = proposal.tables.map((t) => t.label);
    expect(labels[0]).toBe('G1');
    expect(labels).toHaveLength(3);
    expect(new Set(labels).size).toBe(3);
    const elsewhere = await api.db
      .select({ label: s.diningTables.label })
      .from(s.diningTables)
      .where(eq(s.diningTables.locationId, demo.locationId));
    const taken = new Set(elsewhere.map((t) => t.label));
    expect(taken.has(labels[1]!)).toBe(false);
    expect(taken.has(labels[2]!)).toBe(false);
    expect(proposal.tables[0]).toMatchObject({ shape: 'round', capacity: 2 });
    expect(await tablesOfArea()).toHaveLength(before.length);
  });

  it('never saves the plan of another organization’s area (RNF-12)', async () => {
    const other = await createOtherOrganization(api.db, 'Floor Other');
    const response = await call('PUT', `/areas/${areaId}/layout`, api.as(other.session), {
      tables: [],
    });
    expect(response.status).toBe(404);
  });
});
