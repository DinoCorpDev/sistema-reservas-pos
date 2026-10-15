import { parseLocationSettings, PERMISSIONS } from '@pos/core';
import { normalizePairingCode, pairingCode, schema as s, sha256Hex } from '@pos/db';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyApproval } from '../auth/tokens';
import {
  createOtherOrganization,
  createTestApi,
  type DemoContext,
  demoSession,
  loadDemo,
} from '../testing';

const api = createTestApi();
let demo: DemoContext;
let admin: Record<string, string>;
let waiter: Record<string, string>;
let other: Awaited<ReturnType<typeof createOtherOrganization>>;
let otherAdmin: Record<string, string>;
let maxPinAttempts: number;

/** Seeded demo PINs (packages/db/src/seed/data/restaurant.ts). */
const PIN = { admin: '1000', manager: '2000', waiter: '4001', kitchen: '5000' };
const WRONG_PIN = '8642';

type Json = Record<string, unknown>;
const json = async <T = Json>(response: Response) => (await response.json()) as T;

beforeAll(async () => {
  demo = await loadDemo(api.db);
  admin = api.as(demoSession(demo, 'admin'));
  waiter = api.as(demoSession(demo, 'waiter'));
  other = await createOtherOrganization(api.db, 'People Other Gastro');
  otherAdmin = api.as(other.session);
  const [location] = await api.db
    .select()
    .from(s.locations)
    .where(eq(s.locations.id, demo.locationId));
  maxPinAttempts = parseLocationSettings(location!.settings).security.maxPinAttempts;
});

afterAll(async () => {
  await api.close();
});

let prefixCounter = 0;

/** A new handheld of the demo location, paired; returns its device token. */
async function pairedTerminal() {
  prefixCounter += 1;
  const created = await api.request('POST', '/terminals', {
    headers: admin,
    body: {
      name: `Test handheld ${prefixCounter}`,
      type: 'handheld',
      orderNumberPrefix: `X${prefixCounter}`,
    },
  });
  expect(created.status).toBe(201);
  const terminal = await json<{ id: string }>(created);
  const issued = await api.request('POST', `/terminals/${terminal.id}/pairing-code`, {
    headers: admin,
  });
  const { code } = await json<{ code: string }>(issued);
  const paired = await api.request('POST', '/terminals/pair', { body: { code } });
  expect(paired.status).toBe(200);
  const { deviceToken } = await json<{ deviceToken: string }>(paired);
  return { id: terminal.id, deviceToken };
}

const unlock = (deviceToken: string, pin: string) =>
  api.request('POST', '/terminals/unlock', {
    headers: { 'x-terminal-token': deviceToken },
    body: { pin },
  });

const posHeaders = (token: string, deviceToken: string) => ({
  authorization: `Bearer ${token}`,
  'x-terminal-token': deviceToken,
});

async function posSession(deviceToken: string, pin: string) {
  const response = await unlock(deviceToken, pin);
  expect(response.status).toBe(200);
  const { token } = await json<{ token: string }>(response);
  return posHeaders(token, deviceToken);
}

const audits = (action: string, entityId: string) =>
  api.db
    .select()
    .from(s.auditEvents)
    .where(and(eq(s.auditEvents.action, action), eq(s.auditEvents.entityId, entityId)));

describe('printers and kitchen stations (RF-A03, RF-C24, RF-C25, RF-F17)', () => {
  it('runs the full lifecycle of a printer and its station', async () => {
    const printer = await api.request('POST', '/printers', {
      headers: admin,
      body: { name: 'Bar printer', kind: 'kitchen', host: '192.168.1.60' },
    });
    expect(printer.status).toBe(201);
    const printerBody = await json<{ id: string }>(printer);
    expect(printerBody).toMatchObject({
      protocol: 'escpos',
      port: 9100,
      paperWidthMm: 80,
      isActive: true,
    });

    const station = await api.request('POST', '/kitchen-stations', {
      headers: admin,
      body: { name: 'Grill', printerId: printerBody.id },
    });
    expect(station.status).toBe(201);
    const stationBody = await json<{ id: string }>(station);
    expect(stationBody).toMatchObject({
      alertAfterMinutes: null,
      language: null,
      printerId: printerBody.id,
    });

    const updated = await api.request('PATCH', `/kitchen-stations/${stationBody.id}`, {
      headers: admin,
      body: { alertAfterMinutes: 7, language: 'fr' },
    });
    expect(await json(updated)).toMatchObject({ alertAfterMinutes: 7, language: 'fr' });

    const blocked = await api.request('DELETE', `/printers/${printerBody.id}`, { headers: admin });
    expect(blocked.status).toBe(409);
    await api.request('PATCH', `/kitchen-stations/${stationBody.id}`, {
      headers: admin,
      body: { printerId: null },
    });
    expect(
      (await api.request('DELETE', `/printers/${printerBody.id}`, { headers: admin })).status,
    ).toBe(204);
    expect(
      (await api.request('DELETE', `/kitchen-stations/${stationBody.id}`, { headers: admin }))
        .status,
    ).toBe(204);

    const printers = await json<{ id: string }[]>(
      await api.request('GET', '/printers', { headers: waiter }),
    );
    expect(printers.some((p) => p.id === printerBody.id)).toBe(false);
    const stations = await json<{ name: string }[]>(
      await api.request('GET', '/kitchen-stations', { headers: waiter }),
    );
    expect(stations.map((st) => st.name)).toEqual(
      expect.arrayContaining(['Küche', 'Bar', 'Patisserie']),
    );
    expect(stations.map((st) => st.name)).not.toContain('Grill');
  });

  it('keeps stations that products are routed to', async () => {
    const [station] = await api.db
      .select()
      .from(s.kitchenStations)
      .where(
        and(eq(s.kitchenStations.locationId, demo.locationId), eq(s.kitchenStations.name, 'Küche')),
      );
    const response = await api.request('DELETE', `/kitchen-stations/${station!.id}`, {
      headers: admin,
    });
    expect(response.status).toBe(409);
  });

  it('forbids staff without location.manage and validates input', async () => {
    const forbidden = await api.request('POST', '/printers', {
      headers: waiter,
      body: { name: 'x', kind: 'receipt', host: '10.0.0.1' },
    });
    expect(forbidden.status).toBe(403);
    const invalid = await api.request('POST', '/printers', {
      headers: admin,
      body: { name: 'x', kind: 'laser', host: '10.0.0.1', paperWidthMm: 70 },
    });
    expect(invalid.status).toBe(422);
  });
});

describe('terminals: pairing and PIN unlock (RF-A03, RF-A06, RN-16)', () => {
  it('creates, pairs and unlocks a terminal, then works with the POS session', async () => {
    const duplicate = await api.request('POST', '/terminals', {
      headers: admin,
      body: { name: 'Second Kasse', type: 'pos', orderNumberPrefix: 'K1' },
    });
    expect(duplicate.status).toBe(409);
    expect(await json(duplicate)).toMatchObject({
      error: { details: { field: 'orderNumberPrefix' } },
    });

    const created = await api.request('POST', '/terminals', {
      headers: admin,
      body: { name: 'Handheld Terrasse', type: 'handheld', orderNumberPrefix: 'H9' },
    });
    expect(created.status).toBe(201);
    const terminal = await json<{ id: string }>(created);
    expect(terminal).toMatchObject({ isPaired: false, isActive: true, pairingExpiresAt: null });

    const issued = await api.request('POST', `/terminals/${terminal.id}/pairing-code`, {
      headers: admin,
    });
    expect(issued.status).toBe(201);
    const { code, expiresAt } = await json<{ code: string; expiresAt: string }>(issued);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(new Date(expiresAt).getTime() - Date.now()).toBeGreaterThan(14 * 60_000);

    expect(
      (await api.request('POST', '/terminals/pair', { body: { code: 'AAAA-BBBB' } })).status,
    ).toBe(401);

    // What a person types: lower case, a space instead of the dash.
    const paired = await api.request('POST', '/terminals/pair', {
      body: { code: code.toLowerCase().replace('-', ' '), appVersion: '1.0.0' },
    });
    expect(paired.status).toBe(200);
    const pairedBody = await json<{ deviceToken: string }>(paired);
    expect(pairedBody).toMatchObject({
      organizationId: demo.organizationId,
      location: { id: demo.locationId, name: 'Restaurant Demo Zürich', timezone: 'Europe/Zurich' },
      terminal: { id: terminal.id, isPaired: true, appVersion: '1.0.0', pairingExpiresAt: null },
    });
    expect((await api.request('POST', '/terminals/pair', { body: { code } })).status).toBe(401);

    const [row] = await api.db.select().from(s.terminals).where(eq(s.terminals.id, terminal.id));
    expect(row?.deviceTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.deviceTokenHash).not.toBe(pairedBody.deviceToken);
    expect(row?.pairingCodeHash).toBeNull();
    expect(await audits('terminal.paired', terminal.id)).toHaveLength(1);

    const unlocked = await unlock(pairedBody.deviceToken, PIN.waiter);
    expect(unlocked.status).toBe(200);
    const session = await json<{ token: string; user: { permissions: string[] } }>(unlocked);
    expect(session.user).toMatchObject({
      id: demo.users.waiter.id,
      displayName: 'Anna Huber',
      uiLanguage: 'de',
    });
    expect(session.user.permissions).toContain('order.create');
    expect(session.user.permissions).not.toContain('user.manage');
    const [unlockAudit] = await audits('terminal.unlocked', terminal.id);
    expect(unlockAudit).toMatchObject({ userId: demo.users.waiter.id, terminalId: terminal.id });

    const areas = await api.request('GET', '/areas', {
      headers: posHeaders(session.token, pairedBody.deviceToken),
    });
    expect(areas.status).toBe(200);
    expect((await json<unknown[]>(areas)).length).toBeGreaterThan(0);

    // The POS session only works together with its own device.
    const second = await pairedTerminal();
    const mixed = await api.request('GET', '/areas', {
      headers: posHeaders(session.token, second.deviceToken),
    });
    expect(mixed.status).toBe(401);
  });

  it('does not hand a paired terminal to another device until it is unpaired (DEC-041)', async () => {
    const terminal = await pairedTerminal();
    const issued = await api.request('POST', `/terminals/${terminal.id}/pairing-code`, {
      headers: admin,
    });
    expect(issued.status).toBe(409);
    expect(await json(issued)).toMatchObject({ error: { details: { reason: 'already_paired' } } });

    // A code left over from before the rule: the second device is refused all the same.
    const leftover = pairingCode();
    await api.db
      .update(s.terminals)
      .set({
        pairingCodeHash: sha256Hex(normalizePairingCode(leftover)),
        pairingExpiresAt: new Date(Date.now() + 60_000),
      })
      .where(eq(s.terminals.id, terminal.id));
    const refused = await api.request('POST', '/terminals/pair', { body: { code: leftover } });
    expect(refused.status).toBe(409);
    expect(await json(refused)).toMatchObject({
      error: { details: { reason: 'already_paired', name: expect.stringMatching(/^Test handheld/) } },
    });
    expect((await unlock(terminal.deviceToken, PIN.waiter)).status).toBe(200);

    // Unpaired in the backoffice, the place is free for the next device.
    const unpaired = await api.request('POST', `/terminals/${terminal.id}/unpair`, {
      headers: admin,
    });
    expect(await json(unpaired)).toMatchObject({ isPaired: false });
    const fresh = await api.request('POST', `/terminals/${terminal.id}/pairing-code`, {
      headers: admin,
    });
    expect(fresh.status).toBe(201);
    const { code } = await json<{ code: string }>(fresh);
    expect((await api.request('POST', '/terminals/pair', { body: { code } })).status).toBe(200);
    expect((await unlock(terminal.deviceToken, PIN.waiter)).status).toBe(401);
  });

  it('needs the device token to unlock', async () => {
    const anonymous = await api.request('POST', '/terminals/unlock', { body: { pin: PIN.waiter } });
    expect(anonymous.status).toBe(401);
    expect((await unlock('not-a-device-token', PIN.waiter)).status).toBe(401);
  });

  it('locks the terminal after too many wrong PINs, even for a correct PIN (RNF-10)', async () => {
    const terminal = await pairedTerminal();
    for (let attempt = 1; attempt <= maxPinAttempts; attempt += 1) {
      const response = await unlock(terminal.deviceToken, WRONG_PIN);
      expect(response.status).toBe(401);
      expect(await json(response)).toMatchObject({
        error: { details: { attemptsLeft: maxPinAttempts - attempt } },
      });
    }
    const locked = await unlock(terminal.deviceToken, WRONG_PIN);
    expect(locked.status).toBe(423);
    const lockedBody = await json<{
      error: { code: string; details: { retryAfterSeconds: number } };
    }>(locked);
    expect(lockedBody.error.code).toBe('LOCKED');
    expect(lockedBody.error.details.retryAfterSeconds).toBeGreaterThan(0);

    expect((await unlock(terminal.deviceToken, PIN.waiter)).status).toBe(423);
    expect(await audits('terminal.pin_failed', terminal.id)).toHaveLength(maxPinAttempts);

    // The lock belongs to the terminal: another device of the location still unlocks.
    const another = await pairedTerminal();
    expect((await unlock(another.deviceToken, PIN.waiter)).status).toBe(200);
  });

  it('resets the failure count after a correct PIN', async () => {
    const terminal = await pairedTerminal();
    for (let attempt = 1; attempt < maxPinAttempts; attempt += 1) {
      expect((await unlock(terminal.deviceToken, WRONG_PIN)).status).toBe(401);
    }
    expect((await unlock(terminal.deviceToken, PIN.manager)).status).toBe(200);
    const again = await unlock(terminal.deviceToken, WRONG_PIN);
    expect(again.status).toBe(401);
    expect(await json(again)).toMatchObject({
      error: { details: { attemptsLeft: maxPinAttempts - 1 } },
    });
  });

  it('deactivates a terminal without deleting it and rejects its device token (RF-A12)', async () => {
    const terminal = await pairedTerminal();
    const pos = await posSession(terminal.deviceToken, PIN.waiter);

    const deactivated = await api.request('PATCH', `/terminals/${terminal.id}`, {
      headers: admin,
      body: { isActive: false },
    });
    expect(deactivated.status).toBe(200);
    const body = await json<{ deactivatedAt: string | null }>(deactivated);
    expect(body).toMatchObject({ isActive: false, isPaired: false });
    expect(body.deactivatedAt).not.toBeNull();

    expect((await api.request('GET', '/areas', { headers: pos })).status).toBe(401);
    expect((await unlock(terminal.deviceToken, PIN.waiter)).status).toBe(401);
    const credentials = await api.request('GET', '/terminals/offline-credentials', {
      headers: { 'x-terminal-token': terminal.deviceToken },
    });
    expect(credentials.status).toBe(401);
    expect(
      (await api.request('POST', `/terminals/${terminal.id}/pairing-code`, { headers: admin }))
        .status,
    ).toBe(409);

    const listed = await json<{ id: string; isActive: boolean }[]>(
      await api.request('GET', '/terminals', { headers: admin }),
    );
    expect(listed.find((t) => t.id === terminal.id)).toMatchObject({ isActive: false });

    const reactivated = await api.request('PATCH', `/terminals/${terminal.id}`, {
      headers: admin,
      body: { isActive: true },
    });
    expect(await json(reactivated)).toMatchObject({
      isActive: true,
      isPaired: false,
      deactivatedAt: null,
    });
    expect((await unlock(terminal.deviceToken, PIN.waiter)).status).toBe(401);
  });
});

describe('manager approval with PIN on the same device (RF-A05, RN-15)', () => {
  it('issues a one-action approval token for the manager', async () => {
    const terminal = await pairedTerminal();
    const pos = await posSession(terminal.deviceToken, PIN.waiter);
    const response = await api.request('POST', '/terminals/approve', {
      headers: pos,
      body: {
        pin: PIN.manager,
        action: 'void_item:42',
        permissions: ['order.void_item', 'approval.grant'],
      },
    });
    expect(response.status).toBe(200);
    const body = await json<{ approvalToken: string }>(response);
    expect(body).toMatchObject({
      approver: { id: demo.users.manager.id, displayName: 'Marco Brunner' },
    });

    const claims = await verifyApproval(body.approvalToken);
    expect(claims).toMatchObject({
      approverUserId: demo.users.manager.id,
      organizationId: demo.organizationId,
      locationId: demo.locationId,
      terminalId: terminal.id,
      permissions: ['order.void_item', 'approval.grant'],
      action: 'void_item:42',
    });

    const [audit] = await api.db
      .select()
      .from(s.auditEvents)
      .where(
        and(
          eq(s.auditEvents.action, 'approval.granted'),
          eq(s.auditEvents.terminalId, terminal.id),
        ),
      );
    expect(audit).toMatchObject({
      userId: demo.users.waiter.id,
      authorizedByUserId: demo.users.manager.id,
    });
  });

  it('refuses approvers without the requested permissions and callers without a POS session', async () => {
    const terminal = await pairedTerminal();
    const pos = await posSession(terminal.deviceToken, PIN.waiter);
    const ownPin = await api.request('POST', '/terminals/approve', {
      headers: pos,
      body: { pin: PIN.waiter, action: 'discount:7', permissions: ['approval.grant'] },
    });
    expect(ownPin.status).toBe(403);
    expect(await json(ownPin)).toMatchObject({
      error: { details: { missing: ['approval.grant'] } },
    });

    const wrongPin = await api.request('POST', '/terminals/approve', {
      headers: pos,
      body: { pin: WRONG_PIN, action: 'discount:7', permissions: ['approval.grant'] },
    });
    expect(wrongPin.status).toBe(401);
    expect(await audits('terminal.pin_failed', terminal.id)).toHaveLength(1);

    const unknownPermission = await api.request('POST', '/terminals/approve', {
      headers: pos,
      body: { pin: PIN.manager, action: 'discount:7', permissions: ['order.everything'] },
    });
    expect(unknownPermission.status).toBe(422);

    const backoffice = await api.request('POST', '/terminals/approve', {
      headers: admin,
      body: { pin: PIN.manager, action: 'discount:7', permissions: ['approval.grant'] },
    });
    expect(backoffice.status).toBe(403);
  });
});

describe('offline credentials (RF-A06, DEC-015)', () => {
  it('are given only to a paired terminal', async () => {
    const terminal = await pairedTerminal();
    expect(
      (await api.request('GET', '/terminals/offline-credentials', { headers: admin })).status,
    ).toBe(401);
    const forged = await api.request('GET', '/terminals/offline-credentials', {
      headers: { 'x-terminal-token': 'forged-token' },
    });
    expect(forged.status).toBe(401);

    const response = await api.request('GET', '/terminals/offline-credentials', {
      headers: { 'x-terminal-token': terminal.deviceToken },
    });
    expect(response.status).toBe(200);
    const body = await json<{
      pinKey: string;
      users: { id: string; pinHash: string; permissions: string[] }[];
    }>(response);
    const [org] = await api.db
      .select()
      .from(s.organizations)
      .where(eq(s.organizations.id, demo.organizationId));
    expect(body.pinKey).toBe(org!.pinKey);
    const anna = body.users.find((u) => u.id === demo.users.waiter.id);
    expect(anna?.pinHash).toMatch(/^\$argon2id\$/);
    expect(anna?.permissions).toContain('order.create');
    expect(body.users.find((u) => u.id === demo.users.admin.id)?.permissions).toHaveLength(
      PERMISSIONS.length,
    );

    const withSession = await api.request('GET', '/terminals/offline-credentials', {
      headers: await posSession(terminal.deviceToken, PIN.kitchen),
    });
    expect(withSession.status).toBe(200);
  });
});

describe('users and roles (RF-A04, RF-A05, RF-A07, RF-A08, RF-A12)', () => {
  let ninaId: string;

  it('lists the users with their roles and locations', async () => {
    const response = await api.request('GET', '/users?currentLocation=true', { headers: admin });
    expect(response.status).toBe(200);
    const users =
      await json<{ id: string; roles: string[]; locationIds: string[]; hasPin: boolean }[]>(
        response,
      );
    expect(users.length).toBeGreaterThanOrEqual(6);
    expect(users.find((u) => u.id === demo.users.cashier.id)).toMatchObject({
      roles: ['cashier', 'waiter'],
      locationIds: [demo.locationId],
      hasPin: true,
    });
    expect(JSON.stringify(users)).not.toMatch(/argon2|pinLookup|passwordHash/);
    expect((await api.request('GET', '/users', { headers: waiter })).status).toBe(403);
  });

  it('creates a user with PIN and password, unique in the organization', async () => {
    const created = await api.request('POST', '/users', {
      headers: admin,
      body: {
        displayName: 'Nina Frei',
        email: 'Nina.Frei@demo-zuerich.test',
        password: 'nina-password-2026',
        pin: '7001',
        uiLanguage: 'fr',
        roles: ['waiter'],
        locationIds: [demo.locationId],
      },
    });
    expect(created.status).toBe(201);
    const nina = await json<{ id: string }>(created);
    ninaId = nina.id;
    expect(nina).toMatchObject({
      email: 'nina.frei@demo-zuerich.test',
      uiLanguage: 'fr',
      roles: ['waiter'],
      hasPin: true,
      hasPassword: true,
      isActive: true,
    });
    const [audit] = await audits('user.created', nina.id);
    expect(audit).toMatchObject({ userId: demo.users.admin.id, locationId: null });
    expect(JSON.stringify(audit)).not.toMatch(/7001|argon2|nina-password/);

    const terminal = await pairedTerminal();
    const unlocked = await unlock(terminal.deviceToken, '7001');
    expect(unlocked.status).toBe(200);
    expect(await json(unlocked)).toMatchObject({ user: { id: nina.id, uiLanguage: 'fr' } });

    const samePin = await api.request('POST', '/users', {
      headers: admin,
      body: {
        displayName: 'Copy',
        pin: PIN.admin,
        roles: ['waiter'],
        locationIds: [demo.locationId],
      },
    });
    expect(samePin.status).toBe(409);
    expect(await json(samePin)).toMatchObject({
      error: { code: 'CONFLICT', details: { field: 'pin' } },
    });

    const sameEmail = await api.request('POST', '/users', {
      headers: admin,
      body: {
        displayName: 'Copy',
        email: 'ADMIN@demo-zuerich.test',
        roles: ['waiter'],
        locationIds: [demo.locationId],
      },
    });
    expect(sameEmail.status).toBe(409);
    expect(await json(sameEmail)).toMatchObject({ error: { details: { field: 'email' } } });
  });

  it('changes the PIN and the password without exposing them', async () => {
    const taken = await api.request('PUT', `/users/${ninaId}/pin`, {
      headers: admin,
      body: { pin: PIN.waiter },
    });
    expect(taken.status).toBe(409);
    expect(await json(taken)).toMatchObject({ error: { details: { field: 'pin' } } });
    expect(
      (await api.request('PUT', `/users/${ninaId}/pin`, { headers: admin, body: { pin: '12' } }))
        .status,
    ).toBe(422);
    expect(
      (await api.request('PUT', `/users/${ninaId}/pin`, { headers: admin, body: { pin: '7002' } }))
        .status,
    ).toBe(204);
    const password = await api.request('PUT', `/users/${ninaId}/password`, {
      headers: admin,
      body: { password: 'another-password-2026' },
    });
    expect(password.status).toBe(204);
    expect(await audits('user.pin_changed', ninaId)).toHaveLength(1);
    expect(await audits('user.password_changed', ninaId)).toHaveLength(1);

    const terminal = await pairedTerminal();
    expect((await unlock(terminal.deviceToken, '7001')).status).toBe(401);
    expect((await unlock(terminal.deviceToken, '7002')).status).toBe(200);
  });

  it('replaces roles and locations and audits the change', async () => {
    const changed = await api.request('PATCH', `/users/${ninaId}`, {
      headers: admin,
      body: { displayName: 'Nina Frei-Meier', roles: ['cashier', 'kitchen'] },
    });
    expect(changed.status).toBe(200);
    expect(await json(changed)).toMatchObject({
      displayName: 'Nina Frei-Meier',
      roles: ['cashier', 'kitchen'],
    });

    const back = await api.request('PATCH', `/users/${ninaId}`, {
      headers: admin,
      body: { roles: ['waiter'] },
    });
    expect(await json(back)).toMatchObject({ roles: ['waiter'] });
    const activeRoles = await api.db
      .select()
      .from(s.userRoles)
      .where(and(eq(s.userRoles.userId, ninaId), isNull(s.userRoles.deletedAt)));
    expect(activeRoles).toHaveLength(1);

    const [audit] = await audits('user.changed', ninaId);
    expect(audit).toMatchObject({
      before: { displayName: 'Nina Frei', roles: ['waiter'] },
      after: { displayName: 'Nina Frei-Meier', roles: ['cashier', 'kitchen'] },
    });

    const foreignLocation = await api.request('PATCH', `/users/${ninaId}`, {
      headers: admin,
      body: { locationIds: [other.locationId] },
    });
    expect(foreignLocation.status).toBe(404);
  });

  it('deactivates a user without deleting them (RF-A12)', async () => {
    const deactivated = await api.request('PATCH', `/users/${ninaId}`, {
      headers: admin,
      body: { isActive: false },
    });
    expect(deactivated.status).toBe(200);
    const body = await json<{ deactivatedAt: string | null }>(deactivated);
    expect(body).toMatchObject({ isActive: false });
    expect(body.deactivatedAt).not.toBeNull();

    const terminal = await pairedTerminal();
    expect((await unlock(terminal.deviceToken, '7002')).status).toBe(401);
    const credentials = await json<{ users: { id: string }[] }>(
      await api.request('GET', '/terminals/offline-credentials', {
        headers: { 'x-terminal-token': terminal.deviceToken },
      }),
    );
    expect(credentials.users.some((u) => u.id === ninaId)).toBe(false);
    const listed = await json<{ id: string }[]>(
      await api.request('GET', '/users', { headers: admin }),
    );
    expect(listed.some((u) => u.id === ninaId)).toBe(true);

    const reactivated = await api.request('PATCH', `/users/${ninaId}`, {
      headers: admin,
      body: { isActive: true },
    });
    expect(await json(reactivated)).toMatchObject({ isActive: true, deactivatedAt: null });
  });

  it('refuses self-deactivation and keeps an active administrator', async () => {
    const self = await api.request('PATCH', `/users/${demo.users.admin.id}`, {
      headers: admin,
      body: { isActive: false },
    });
    expect(self.status).toBe(409);

    const lastAdmin = await api.request('PATCH', `/users/${demo.users.admin.id}`, {
      headers: admin,
      body: { roles: ['manager'] },
    });
    expect(lastAdmin.status).toBe(409);

    // With a second administrator the role can move; back to one, it is protected again.
    await api.request('PATCH', `/users/${ninaId}`, { headers: admin, body: { roles: ['admin'] } });
    const demoted = await api.request('PATCH', `/users/${ninaId}`, {
      headers: admin,
      body: { roles: ['waiter'] },
    });
    expect(demoted.status).toBe(200);

    // A manager allowed to manage users still cannot deactivate the only administrator.
    const roles = await json<{ id: string; key: string; permissions: string[] }[]>(
      await api.request('GET', '/roles', { headers: admin }),
    );
    const managerRole = roles.find((r) => r.key === 'manager')!;
    await api.request('PUT', `/roles/${managerRole.id}/permissions`, {
      headers: admin,
      body: { permissions: [...managerRole.permissions, 'user.manage'] },
    });
    const manager = api.as(demoSession(demo, 'manager'));
    const deactivateAdmin = await api.request('PATCH', `/users/${demo.users.admin.id}`, {
      headers: manager,
      body: { isActive: false },
    });
    expect(deactivateAdmin.status).toBe(409);
    await api.request('PUT', `/roles/${managerRole.id}/permissions`, {
      headers: admin,
      body: { permissions: managerRole.permissions },
    });
    const [sandra] = await api.db.select().from(s.users).where(eq(s.users.id, demo.users.admin.id));
    expect(sandra?.isActive).toBe(true);
  });

  it('edits role permissions, except for the administrator role (RF-A05)', async () => {
    const roles = await json<{ id: string; key: string; permissions: string[] }[]>(
      await api.request('GET', '/roles', { headers: admin }),
    );
    // The predefined roles come first; other test files may add custom roles to the shared DB.
    expect(roles.map((r) => r.key).slice(0, 5)).toEqual([
      'admin',
      'manager',
      'cashier',
      'waiter',
      'kitchen',
    ]);
    const adminRole = roles.find((r) => r.key === 'admin')!;
    expect(adminRole.permissions).toHaveLength(PERMISSIONS.length);
    const kitchenRole = roles.find((r) => r.key === 'kitchen')!;

    const locked = await api.request('PUT', `/roles/${adminRole.id}/permissions`, {
      headers: admin,
      body: { permissions: ['order.create'] },
    });
    expect(locked.status).toBe(409);
    const invalid = await api.request('PUT', `/roles/${kitchenRole.id}/permissions`, {
      headers: admin,
      body: { permissions: ['kitchen.everything'] },
    });
    expect(invalid.status).toBe(422);

    const updated = await api.request('PUT', `/roles/${kitchenRole.id}/permissions`, {
      headers: admin,
      body: { permissions: ['kitchen.operate', 'report.view'] },
    });
    expect(updated.status).toBe(200);
    expect(await json(updated)).toMatchObject({ permissions: ['kitchen.operate', 'report.view'] });

    // Effective at once: the kitchen user's POS session carries the new permission set.
    const terminal = await pairedTerminal();
    const unlocked = await json<{ user: { permissions: string[] } }>(
      await unlock(terminal.deviceToken, PIN.kitchen),
    );
    expect(unlocked.user.permissions).toEqual(['kitchen.operate', 'report.view']);

    const restored = await api.request('PUT', `/roles/${kitchenRole.id}/permissions`, {
      headers: admin,
      body: { permissions: kitchenRole.permissions },
    });
    expect(await json(restored)).toMatchObject({ permissions: kitchenRole.permissions });
    expect(await audits('role.permissions_changed', kitchenRole.id)).toHaveLength(2);
  });
});

describe('API keys (RF-F14)', () => {
  it('creates a key shown once, uses it and revokes it', async () => {
    const unknownScope = await api.request('POST', '/api-keys', {
      headers: admin,
      body: { name: 'Website', scopes: ['orders:everything'] },
    });
    expect(unknownScope.status).toBe(422);
    expect(
      (
        await api.request('POST', '/api-keys', {
          headers: waiter,
          body: { name: 'x', scopes: ['catalog:read'] },
        })
      ).status,
    ).toBe(403);

    const created = await api.request('POST', '/api-keys', {
      headers: admin,
      body: { name: 'Website', scopes: ['catalog:read'] },
    });
    expect(created.status).toBe(201);
    const key = await json<{ id: string; key: string; keyPrefix: string }>(created);
    expect(key.key).toMatch(/^pos_live_/);
    expect(key.key.startsWith(key.keyPrefix)).toBe(true);

    const listed = await json<Json[]>(await api.request('GET', '/api-keys', { headers: admin }));
    const entry = listed.find((k) => k.id === key.id);
    expect(entry).toMatchObject({ name: 'Website', scopes: ['catalog:read'], revokedAt: null });
    expect(entry).not.toHaveProperty('key');
    const [row] = await api.db.select().from(s.apiKeys).where(eq(s.apiKeys.id, key.id));
    expect(row?.keyHash).not.toBe(key.key);

    const withKey = { authorization: `Bearer ${key.key}`, 'x-location-id': demo.locationId };
    expect((await api.request('GET', '/areas', { headers: withKey })).status).toBe(200);

    expect((await api.request('DELETE', `/api-keys/${key.id}`, { headers: admin })).status).toBe(
      204,
    );
    expect((await api.request('GET', '/areas', { headers: withKey })).status).toBe(401);
    expect(await audits('api_key.created', key.id)).toHaveLength(1);
    expect(await audits('api_key.revoked', key.id)).toHaveLength(1);
  });
});

describe('RNF-12 · another organization sees nothing of ours', () => {
  it('gets 404 on our devices, users, roles and keys', async () => {
    const [station] = await api.db
      .select()
      .from(s.kitchenStations)
      .where(eq(s.kitchenStations.locationId, demo.locationId));
    const [printer] = await api.db
      .select()
      .from(s.printers)
      .where(eq(s.printers.locationId, demo.locationId));
    const [terminal] = await api.db
      .select()
      .from(s.terminals)
      .where(eq(s.terminals.locationId, demo.locationId));
    const [role] = await api.db
      .select()
      .from(s.roles)
      .where(eq(s.roles.organizationId, demo.organizationId));
    const created = await api.request('POST', '/api-keys', {
      headers: admin,
      body: { name: 'Zitas', scopes: ['catalog:read'] },
    });
    const apiKey = await json<{ id: string }>(created);

    for (const [method, path, body] of [
      ['PATCH', `/kitchen-stations/${station!.id}`, { name: 'x' }],
      ['DELETE', `/printers/${printer!.id}`, undefined],
      ['PATCH', `/terminals/${terminal!.id}`, { isActive: false }],
      ['POST', `/terminals/${terminal!.id}/pairing-code`, undefined],
      ['POST', '/kitchen-stations', { name: 'x', printerId: printer!.id }],
      ['GET', `/users/${demo.users.waiter.id}`, undefined],
      ['PATCH', `/users/${demo.users.waiter.id}`, { isActive: false }],
      ['PUT', `/users/${demo.users.waiter.id}/pin`, { pin: '1234' }],
      ['POST', '/users', { displayName: 'x', roles: ['waiter'], locationIds: [demo.locationId] }],
      ['PUT', `/roles/${role!.id}/permissions`, { permissions: [] }],
      ['DELETE', `/api-keys/${apiKey.id}`, undefined],
    ] as const) {
      const response = await api.request(method, path, { headers: otherAdmin, body });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    const [waiterRow] = await api.db
      .select()
      .from(s.users)
      .where(eq(s.users.id, demo.users.waiter.id));
    expect(waiterRow?.isActive).toBe(true);
    const [terminalRow] = await api.db
      .select()
      .from(s.terminals)
      .where(eq(s.terminals.id, terminal!.id));
    expect(terminalRow?.isActive).toBe(true);
  });

  it('only lists its own data, and PINs are unique per organization only', async () => {
    const users = await json<{ id: string }[]>(
      await api.request('GET', '/users', { headers: otherAdmin }),
    );
    expect(users.map((u) => u.id)).toEqual([other.adminId]);
    expect(await json(await api.request('GET', '/terminals', { headers: otherAdmin }))).toEqual([]);
    expect(await json(await api.request('GET', '/api-keys', { headers: otherAdmin }))).toEqual([]);

    const samePinElsewhere = await api.request('POST', '/users', {
      headers: otherAdmin,
      body: {
        displayName: 'Bern waiter',
        pin: PIN.waiter,
        roles: ['waiter'],
        locationIds: [other.locationId],
      },
    });
    expect(samePinElsewhere.status).toBe(201);
  });
});
