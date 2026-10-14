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
  pairTerminal,
} from '../testing';

/** Waiters' own phones (DEC-036). */

const api = createTestApi();
let demo: DemoContext;
let admin: Record<string, string>;
let otherAdmin: Record<string, string>;
let kasse: PairedTerminal;
let handheld: PairedTerminal;
let kds: PairedTerminal;

/** Seeded demo PINs (packages/db/src/seed/data/restaurant.ts). */
const PIN = {
  admin: '1000',
  manager: '2000',
  cashier: '3000',
  anna: '4001',
  luca: '4002',
  kitchen: '5000',
};
const WRONG_PIN = '8642';

type Json = Record<string, unknown>;
const json = async <T = Json>(response: Response) => (await response.json()) as T;
const device = (deviceToken: string) => ({ 'x-terminal-token': deviceToken });

interface Paired {
  deviceToken: string;
  terminal: { id: string; type: string; orderNumberPrefix: string; userId: string | null };
  user?: { id: string; displayName: string; permissions: string[] };
}

beforeAll(async () => {
  demo = await loadDemo(api.db);
  admin = api.as(demoSession(demo, 'admin'));
  otherAdmin = api.as((await createOtherOrganization(api.db, 'Phones Other Gastro')).session);
  kasse = await pairTerminal(api, admin, { prefix: 'PK', type: 'pos', name: 'Phone test Kasse' });
  handheld = await pairTerminal(api, admin, { prefix: 'PH', type: 'handheld' });
  kds = await pairTerminal(api, admin, { prefix: 'PD', type: 'kds' });
});

afterAll(async () => {
  await api.close();
});

const issueCode = (headers: Record<string, string>) =>
  api.request('POST', '/terminals/phone-pairing-code', { headers });

/** A fresh phone code from the cashier POS. */
async function kasseCode(): Promise<string> {
  const issued = await issueCode(device(kasse.deviceToken));
  expect(issued.status).toBe(201);
  return (await json<{ code: string }>(issued)).code;
}

const pairPhone = (code: string, pin?: string) =>
  api.request('POST', '/terminals/pair', { body: pin === undefined ? { code } : { code, pin } });

async function pairedPhone(pin: string): Promise<Paired> {
  const paired = await pairPhone(await kasseCode(), pin);
  expect(paired.status).toBe(200);
  return json<Paired>(paired);
}

const credentialsOf = (deviceToken: string) =>
  api.request('GET', '/terminals/offline-credentials', { headers: device(deviceToken) });

describe('codes for waiter phones (DEC-036)', () => {
  it('come from the cashier POS or from someone who manages the location', async () => {
    const fromKasse = await issueCode(device(kasse.deviceToken));
    expect(fromKasse.status).toBe(201);
    const issued = await json<{ code: string; expiresAt: string }>(fromKasse);
    expect(issued.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const minutes = (new Date(issued.expiresAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(4);
    expect(minutes).toBeLessThanOrEqual(5);

    expect((await issueCode(admin)).status).toBe(201);
  });

  it('never come from a handheld, a kitchen display or a waiter in the backoffice', async () => {
    expect((await issueCode(device(handheld.deviceToken))).status).toBe(403);
    expect((await issueCode(device(kds.deviceToken))).status).toBe(403);
    expect((await issueCode(api.as(demoSession(demo, 'waiter')))).status).toBe(403);
  });
});

describe('pairing a waiter phone (DEC-036)', () => {
  it('needs the waiter PIN', async () => {
    const response = await pairPhone(await kasseCode());
    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ error: { details: { reason: 'pin_required' } } });
  });

  it('counts wrong PINs against the code: the fifth one kills it', async () => {
    const code = await kasseCode();
    for (const attemptsLeft of [4, 3, 2, 1, 0]) {
      const response = await pairPhone(code, WRONG_PIN);
      expect(response.status).toBe(401);
      expect(await json(response)).toMatchObject({
        error: { details: { reason: 'wrong_pin', attemptsLeft } },
      });
    }
    const dead = await pairPhone(code, PIN.anna);
    expect(dead.status).toBe(401);
    expect(await json(dead)).toMatchObject({
      error: { message: 'The pairing code is invalid or expired' },
    });
  });

  it('is only for waiters: kitchen, manager and admin PINs are refused', async () => {
    const code = await kasseCode();
    for (const pin of [PIN.kitchen, PIN.manager, PIN.admin]) {
      const response = await pairPhone(code, pin);
      expect(response.status).toBe(403);
      expect(await json(response)).toMatchObject({ error: { details: { reason: 'not_waiter' } } });
    }
  });

  it('makes the phone the waiter’s: one terminal per waiter, reused, with its own prefix', async () => {
    const code = await kasseCode();
    const annaResponse = await pairPhone(code, PIN.anna);
    expect(annaResponse.status).toBe(200);
    const anna = await json<Paired>(annaResponse);
    expect(anna.terminal).toMatchObject({ type: 'phone', userId: demo.users.waiter.id });
    expect(anna.terminal.orderNumberPrefix).toMatch(/^T\d{1,3}$/);
    expect(anna.user).toMatchObject({ id: demo.users.waiter.id, displayName: 'Anna Huber' });
    expect(anna.user!.permissions).toContain('order.create');

    // The same code serves the next waiter, with another terminal and prefix.
    const luca = await json<Paired>(await pairPhone(code, PIN.luca));
    expect(luca.terminal.id).not.toBe(anna.terminal.id);
    expect(luca.terminal.orderNumberPrefix).not.toBe(anna.terminal.orderNumberPrefix);

    // Anna pairs another phone: same terminal, and the first phone stops working.
    const again = await pairedPhone(PIN.anna);
    expect(again.terminal.id).toBe(anna.terminal.id);
    expect(again.terminal.orderNumberPrefix).toBe(anna.terminal.orderNumberPrefix);
    expect((await credentialsOf(anna.deviceToken)).status).toBe(401);
    expect((await credentialsOf(again.deviceToken)).status).toBe(200);

    const listed = await json<{ id: string; type: string; userName: string | null }[]>(
      await api.request('GET', '/terminals', { headers: admin }),
    );
    expect(listed.find((t) => t.id === anna.terminal.id)).toMatchObject({
      type: 'phone',
      userName: 'Anna Huber',
    });
    expect(listed.find((t) => t.id === kasse.id)).toMatchObject({ userName: null });
  });

  it('keeps on the phone only the PINs of its owner and of those who approve', async () => {
    const anna = await pairedPhone(PIN.anna);
    const { users } = await json<{ users: { id: string }[] }>(
      await credentialsOf(anna.deviceToken),
    );
    const ids = users.map((user) => user.id);
    expect(ids).toEqual(
      expect.arrayContaining([demo.users.waiter.id, demo.users.manager.id, demo.users.admin.id]),
    );
    for (const absent of ['waiter2', 'cashier', 'kitchen'] as const) {
      expect(ids).not.toContain(demo.users[absent].id);
    }
    // A shared device still gets everyone.
    const kasseUsers = await json<{ users: { id: string }[] }>(
      await credentialsOf(kasse.deviceToken),
    );
    expect(kasseUsers.users.map((user) => user.id)).toContain(demo.users.waiter2.id);
  });

  it('opens only with its owner’s PIN', async () => {
    const anna = await pairedPhone(PIN.anna);
    const unlock = (pin: string) =>
      api.request('POST', '/terminals/unlock', {
        headers: device(anna.deviceToken),
        body: { pin },
      });
    expect((await unlock(PIN.anna)).status).toBe(200);
    const luca = await unlock(PIN.luca);
    expect(luca.status).toBe(403);
    expect(await json(luca)).toMatchObject({ error: { details: { reason: 'not_owner' } } });
  });

  it('is never created by hand', async () => {
    const created = await api.request('POST', '/terminals', {
      headers: admin,
      body: { name: 'Handy', type: 'phone', orderNumberPrefix: 'PX' },
    });
    expect(created.status).toBe(422);
  });
});

describe('signing out and unpairing a waiter phone (DEC-036)', () => {
  it('signs out by itself: the token stops working and it is audited', async () => {
    const anna = await pairedPhone(PIN.anna);
    const logout = await api.request('POST', '/terminals/logout', {
      headers: device(anna.deviceToken),
    });
    expect(logout.status).toBe(204);
    expect((await credentialsOf(anna.deviceToken)).status).toBe(401);
    const audited = await api.db
      .select()
      .from(s.auditEvents)
      .where(
        and(
          eq(s.auditEvents.action, 'terminal.phone_logged_out'),
          eq(s.auditEvents.entityId, anna.terminal.id),
        ),
      );
    expect(audited.length).toBeGreaterThan(0);

    // The terminal stays active: the next shift pairs it again.
    const next = await pairedPhone(PIN.anna);
    expect(next.terminal.id).toBe(anna.terminal.id);
  });

  it('a handheld or a kitchen display does not unpair itself', async () => {
    for (const paired of [handheld, kds]) {
      const response = await api.request('POST', '/terminals/logout', {
        headers: device(paired.deviceToken),
      });
      expect(response.status).toBe(403);
    }
  });

  it('a cashier POS unpairs itself, whoever holds it, and can be paired again', async () => {
    const till = await pairTerminal(api, admin, { prefix: 'PU', type: 'pos' });
    const response = await api.request('POST', '/terminals/logout', {
      headers: device(till.deviceToken),
    });
    expect(response.status).toBe(204);
    const gone = await api.request('GET', '/pos/bootstrap', { headers: device(till.deviceToken) });
    expect(gone.status).toBe(401);
    const audited = await api.db
      .select()
      .from(s.auditEvents)
      .where(
        and(eq(s.auditEvents.entityId, till.id), eq(s.auditEvents.action, 'terminal.unpaired')),
      );
    expect(audited).toHaveLength(1);
  });

  it('is unpaired in the backoffice, or deactivated so it cannot pair again', async () => {
    const luca = await pairedPhone(PIN.luca);
    const unpaired = await api.request('POST', `/terminals/${luca.terminal.id}/unpair`, {
      headers: admin,
    });
    expect(unpaired.status).toBe(200);
    expect(await json(unpaired)).toMatchObject({ isPaired: false, isActive: true });
    expect((await credentialsOf(luca.deviceToken)).status).toBe(401);

    const patch = (body: Json) =>
      api.request('PATCH', `/terminals/${luca.terminal.id}`, { headers: admin, body });
    expect((await patch({ isActive: false })).status).toBe(200);
    const refused = await pairPhone(await kasseCode(), PIN.luca);
    expect(refused.status).toBe(403);
    expect(await json(refused)).toMatchObject({
      error: { details: { reason: 'phone_deactivated' } },
    });
    expect((await patch({ isActive: true })).status).toBe(200);
    expect((await pairPhone(await kasseCode(), PIN.luca)).status).toBe(200);
  });

  it('stays a phone: no backoffice pairing code and no other type', async () => {
    const luca = await pairedPhone(PIN.luca);
    const code = await api.request('POST', `/terminals/${luca.terminal.id}/pairing-code`, {
      headers: admin,
    });
    expect(code.status).toBe(409);
    const changed = await api.request('PATCH', `/terminals/${luca.terminal.id}`, {
      headers: admin,
      body: { type: 'pos' },
    });
    expect(changed.status).toBe(409);
  });

  it('is invisible to another organization', async () => {
    const anna = await pairedPhone(PIN.anna);
    const listed = await json<{ id: string }[]>(
      await api.request('GET', '/terminals', { headers: otherAdmin }),
    );
    expect(listed.map((t) => t.id)).not.toContain(anna.terminal.id);
    const unpair = await api.request('POST', `/terminals/${anna.terminal.id}/unpair`, {
      headers: otherAdmin,
    });
    expect(unpair.status).toBe(404);
  });
});
