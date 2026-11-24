import { addDays, newId } from '@pos/core';
import { schema as s } from '@pos/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOtherOrganization,
  createTestApi,
  type DemoContext,
  demoSession,
  loadDemo,
  type PairedTerminal,
  TestDevice,
} from '../testing';

/**
 * Working time of the staff (RF-A09, DEC-054): the clock operations become one row per entry,
 * in any order and only once; the manager reads the timesheet and corrects it, audited.
 * Against MySQL.
 */

const api = createTestApi();
let demo: DemoContext;
let phone: TestDevice;
let manager: Record<string, string>;
let waiter: Record<string, string>;

type PushResponse = { results: { id: string; status: string }[] };
type Timesheet = {
  entries: { id: string; userId: string; minutes: number | null; status: string }[];
  people: { userId: string; minutes: number; entries: number; incomplete: number }[];
  totalMinutes: number;
};

const push = async (operations: unknown[]) => {
  const response = await api.request('POST', '/sync/push', {
    headers: phone.headers,
    body: { operations },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as PushResponse;
};

const entryRow = async (id: string) => {
  const [row] = await api.db.select().from(s.timeEntries).where(eq(s.timeEntries.id, id));
  return row;
};

const auditsOf = (entityId: string) =>
  api.db.select().from(s.auditEvents).where(eq(s.auditEvents.entityId, entityId));

const timesheet = async (headers: Record<string, string>) => {
  const day = phone.businessDate;
  return api.request('GET', `/time-entries?from=${addDays(day, -1)}&to=${addDays(day, 1)}`, {
    headers,
  });
};

/** A clock operation of the waiter's phone, at a chosen device time. */
const clock = (type: 'staff.clock_in' | 'staff.clock_out', timeEntryId: string, at: Date) => ({
  ...phone.op(type, null, { timeEntryId }),
  deviceAt: at.toISOString(),
});

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

/**
 * Pairs the seeded "Handheld 2": a new terminal would count against the demo plan's devices,
 * which the other files of the run have used up.
 */
async function pairSeededHandheld(admin: Record<string, string>): Promise<PairedTerminal> {
  const [terminal] = await api.db
    .select({ id: s.terminals.id, prefix: s.terminals.orderNumberPrefix })
    .from(s.terminals)
    .where(
      and(
        eq(s.terminals.organizationId, demo.organizationId),
        eq(s.terminals.name, 'Handheld 2'),
      ),
    );
  const issued = await api.request('POST', `/terminals/${terminal!.id}/pairing-code`, {
    headers: admin,
  });
  expect(issued.status).toBe(201);
  const { code } = (await issued.json()) as { code: string };
  const paired = await api.request('POST', '/terminals/pair', { body: { code } });
  expect(paired.status).toBe(200);
  const { deviceToken } = (await paired.json()) as { deviceToken: string };
  return { id: terminal!.id, deviceToken, prefix: terminal!.prefix };
}

beforeAll(async () => {
  demo = await loadDemo(api.db);
  const scope = { organizationId: demo.organizationId, locationId: demo.locationId };
  const admin = api.as(demoSession(demo, 'admin'));
  phone = new TestDevice(scope, await pairSeededHandheld(admin), demo.users.waiter.id);
  manager = api.as(demoSession(demo, 'manager'));
  waiter = api.as(demoSession(demo, 'waiter'));
});

afterAll(async () => {
  await api.close();
});

describe('the clock of the staff (DEC-054)', () => {
  it('projects one entry from its clock in and out, audited and announced', async () => {
    const id = newId();
    const { results } = await push([
      clock('staff.clock_in', id, hoursAgo(3)),
      clock('staff.clock_out', id, hoursAgo(0.5)),
    ]);
    expect(results.map((r) => r.status)).toEqual(['applied', 'applied']);
    expect(await entryRow(id)).toMatchObject({
      userId: demo.users.waiter.id,
      locationId: demo.locationId,
      clockInTerminalId: phone.terminal.id,
      clockOutTerminalId: phone.terminal.id,
      correctedByUserId: null,
    });
    const actions = (await auditsOf(id)).map((a) => a.action).sort();
    expect(actions).toEqual(['staff.clocked_in', 'staff.clocked_out']);
    const events = await api.db
      .select({ type: s.outboxEvents.type })
      .from(s.outboxEvents)
      .where(eq(s.outboxEvents.aggregateId, id));
    expect(events.map((e) => e.type).sort()).toEqual(['staff.clocked_in', 'staff.clocked_out']);
  });

  it('takes the exit before its entry, and a repeated push changes nothing', async () => {
    const id = newId();
    const clockIn = clock('staff.clock_in', id, hoursAgo(2));
    const clockOut = clock('staff.clock_out', id, hoursAgo(1));
    await push([clockOut]);
    expect(await entryRow(id)).toMatchObject({ clockInAt: null });
    await push([clockIn]);
    const complete = await entryRow(id);
    expect(complete?.clockInAt?.toISOString()).toBe(clockIn.deviceAt);
    expect(complete?.clockOutAt?.toISOString()).toBe(clockOut.deviceAt);

    const again = await push([clockIn, clockOut]);
    expect(again.results.map((r) => r.status)).toEqual(['duplicate', 'duplicate']);
    expect(await auditsOf(id)).toHaveLength(2);
  });

  it('shows the timesheet to the manager only, with the hours per person', async () => {
    const id = newId();
    await push([
      clock('staff.clock_in', id, hoursAgo(4)),
      clock('staff.clock_out', id, hoursAgo(2)),
    ]);
    expect((await timesheet(waiter)).status).toBe(403);
    const response = await timesheet(manager);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Timesheet;
    expect(body.entries.find((e) => e.id === id)).toMatchObject({
      status: 'closed',
      minutes: 120,
    });
    const person = body.people.find((p) => p.userId === demo.users.waiter.id);
    expect(person?.minutes).toBeGreaterThanOrEqual(120);
    expect(body.totalMinutes).toBeGreaterThanOrEqual(120);
  });

  it('lets the manager correct an entry; a late device exit no longer changes it', async () => {
    const id = newId();
    await push([clock('staff.clock_in', id, hoursAgo(5))]);
    const clockInAt = hoursAgo(5).toISOString();
    const clockOutAt = hoursAgo(1).toISOString();
    const response = await api.request('PUT', `/time-entries/${id}`, {
      headers: manager,
      body: { clockInAt, clockOutAt, note: 'Vergessen auszustempeln' },
    });
    expect(response.status).toBe(204);
    const corrected = await entryRow(id);
    expect(corrected).toMatchObject({
      correctedByUserId: demo.users.manager.id,
      note: 'Vergessen auszustempeln',
    });
    expect(corrected?.clockOutAt?.toISOString()).toBe(clockOutAt);
    const [audit] = await api.db
      .select()
      .from(s.auditEvents)
      .where(and(eq(s.auditEvents.entityId, id), eq(s.auditEvents.action, 'staff.time_corrected')));
    expect(audit).toMatchObject({ reason: 'Vergessen auszustempeln' });
    expect(audit?.after).toMatchObject({ clockOutAt });

    await push([clock('staff.clock_out', id, hoursAgo(0.1))]);
    expect((await entryRow(id))?.clockOutAt?.toISOString()).toBe(clockOutAt);
  });

  it('rejects an exit before the entry', async () => {
    const id = newId();
    await push([clock('staff.clock_in', id, hoursAgo(2))]);
    const response = await api.request('PUT', `/time-entries/${id}`, {
      headers: manager,
      body: {
        clockInAt: hoursAgo(2).toISOString(),
        clockOutAt: hoursAgo(3).toISOString(),
        note: 'Test',
      },
    });
    expect(response.status).toBe(422);
  });

  it('never shows or corrects an entry of another organization (RNF-12)', async () => {
    const id = newId();
    await push([clock('staff.clock_in', id, hoursAgo(1))]);
    const other = await createOtherOrganization(api.db, 'Time Other');
    const headers = api.as(other.session);
    const correction = await api.request('PUT', `/time-entries/${id}`, {
      headers,
      body: { clockInAt: hoursAgo(1).toISOString(), clockOutAt: null, note: 'x' },
    });
    expect(correction.status).toBe(404);
    const list = await timesheet(headers);
    expect(list.status).toBe(200);
    expect(((await list.json()) as Timesheet).entries).toEqual([]);
  });
});
