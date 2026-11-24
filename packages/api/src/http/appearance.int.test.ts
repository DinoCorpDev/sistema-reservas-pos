import { schema as s } from '@pos/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configVersion, forgetConfigVersion } from '../services/sync';
import {
  createOtherOrganization,
  createTestApi,
  type DemoContext,
  demoSession,
  loadDemo,
} from '../testing';

/**
 * The restaurant's brand (DEC-058): saved for the whole organization, audited without the logo
 * image, picked up by the devices through the configuration version, and never another
 * organization's (RNF-12). Against MySQL; the demo goes back to Zitas at the end.
 */

const api = createTestApi();
let demo: DemoContext;
let admin: Record<string, string>;

type Body = Record<string, unknown> & { error?: { code: string } };

const call = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
  const response = await api.request(method, path, { headers, ...(body ? { body } : {}) });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as Body };
};

const LOGO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const LALIN = {
  colors: { primary: '#C8A76A', accent: '#BD5A2E', chrome: '#0A0A0A', background: '#F5EFE6' },
  fonts: 'editorial',
  logo: { light: LOGO, dark: null },
};

beforeAll(async () => {
  demo = await loadDemo(api.db);
  admin = api.as(demoSession(demo, 'admin'));
});

afterAll(async () => {
  await call('PUT', '/organization/appearance', admin, {});
  await api.close();
});

describe('the restaurant brand (DEC-058)', () => {
  it('is Zitas until the owner sets one', async () => {
    await call('PUT', '/organization/appearance', admin, {});
    const current = await call('GET', '/organization/appearance', admin);
    expect(current.status).toBe(200);
    expect(current.body).toEqual({ colors: null, fonts: 'zitas', logo: { light: null, dark: null } });
  });

  it('saves the brand, audited without the image, and changes the configuration version', async () => {
    const scope = { organizationId: demo.organizationId, locationId: demo.locationId };
    forgetConfigVersion(scope);
    const before = await configVersion(api.db, scope);

    const saved = await call('PUT', '/organization/appearance', admin, LALIN);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      colors: { primary: '#c8a76a', accent: '#bd5a2e', chrome: '#0a0a0a', background: '#f5efe6' },
      fonts: 'editorial',
      logo: { light: LOGO, dark: null },
    });

    const audits = await api.db
      .select()
      .from(s.auditEvents)
      .where(
        and(
          eq(s.auditEvents.entityId, demo.organizationId),
          eq(s.auditEvents.action, 'organization.appearance_changed'),
        ),
      );
    expect(audits.length).toBeGreaterThan(0);
    const trail = JSON.stringify(audits);
    expect(trail).not.toContain('iVBORw0KGgo');
    expect(trail).toContain('sha256');

    forgetConfigVersion(scope);
    expect(await configVersion(api.db, scope)).not.toBe(before);
  });

  it('refuses a colour that is not hex, a logo that is not an image and a waiter', async () => {
    const badColour = await call('PUT', '/organization/appearance', admin, {
      ...LALIN,
      colors: { ...LALIN.colors, primary: 'gold;}body{display:none' },
    });
    expect(badColour.status).toBe(422);
    const badLogo = await call('PUT', '/organization/appearance', admin, {
      ...LALIN,
      logo: { light: 'https://example.com/logo.png' },
    });
    expect(badLogo.status).toBe(422);
    const waiter = api.as(demoSession(demo, 'waiter'));
    expect((await call('PUT', '/organization/appearance', waiter, LALIN)).status).toBe(403);
  });

  it('never shows or changes another organization’s brand (RNF-12)', async () => {
    const other = await createOtherOrganization(api.db, 'Brand Other');
    const theirs = await call('GET', '/organization/appearance', api.as(other.session));
    expect(theirs.body).toMatchObject({ colors: null, fonts: 'zitas' });
    await call('PUT', '/organization/appearance', api.as(other.session), {
      ...LALIN,
      colors: { ...LALIN.colors, primary: '#123456' },
    });
    const [ours] = await api.db
      .select({ appearance: s.organizations.appearance })
      .from(s.organizations)
      .where(eq(s.organizations.id, demo.organizationId));
    expect(ours?.appearance?.colors?.primary).toBe('#c8a76a');
  });
});
