import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCATION_SETTINGS, parseLocationSettings } from './settings';

describe('location settings', () => {
  it('uses the DEC-004 defaults from section 20', () => {
    expect(DEFAULT_LOCATION_SETTINGS).toEqual({
      shiftMode: 'terminal',
      tableOwnership: 'open',
      businessDayStartsAt: '04:00',
      managerApproval: { discountAboveBp: 2000, voidSentItem: true, refundAboveRappen: 0 },
      reservations: { blockMinutesBefore: 15, noShowAfterMinutes: 20, defaultDurationMinutes: 120 },
      kitchen: { alertAfterMinutes: 12 },
      printing: { maxDelayMinutes: 15 },
      tax: { label: null },
      receipts: { customerNameFromRappen: 40000 },
      security: { maxPinAttempts: 5, pinLockMinutes: 5, oneDevicePerPerson: true },
      pos: {
        serviceStyle: 'tables',
        discountPresets: [
          { code: 'staff', label: null, kind: 'percent', value: 5000 },
          { code: 'courtesy', label: null, kind: 'percent', value: 10000 },
          { code: 'promotion', label: null, kind: 'percent', value: 1000 },
        ],
      },
      sync: { hubUrls: [] },
    });
  });

  it('fills nested defaults when only part of a section is configured', () => {
    const settings = parseLocationSettings({
      kitchen: {},
      managerApproval: { discountAboveBp: 1000 },
    });
    expect(settings.managerApproval).toEqual({
      discountAboveBp: 1000,
      voidSentItem: true,
      refundAboveRappen: 0,
    });
    expect(settings.kitchen.alertAfterMinutes).toBe(12);
  });

  it('treats null as an empty configuration', () => {
    expect(parseLocationSettings(null)).toEqual(DEFAULT_LOCATION_SETTINGS);
  });

  it('rejects non-integer money and out-of-range percentages', () => {
    expect(() => parseLocationSettings({ receipts: { customerNameFromRappen: 400.5 } })).toThrow();
    expect(() => parseLocationSettings({ managerApproval: { discountAboveBp: 12000 } })).toThrow();
  });
});

describe('business day start (DEC-022)', () => {
  it.each(['00:00', '04:00', '05:30', '23:59'])('accepts %s', (businessDayStartsAt) => {
    expect(parseLocationSettings({ businessDayStartsAt }).businessDayStartsAt).toBe(
      businessDayStartsAt,
    );
  });

  it.each(['24:00', '4:00', '04:60', '0400', '04:00:00', ''])(
    'rejects %j',
    (businessDayStartsAt) => {
      expect(() => parseLocationSettings({ businessDayStartsAt })).toThrow();
    },
  );
});

describe('POS discount presets (RF-C11)', () => {
  const preset = (code: string, value = 1000) => ({ code, kind: 'percent' as const, value });

  it('keeps an own label and defaults it to null', () => {
    const settings = parseLocationSettings({
      pos: {
        discountPresets: [
          { code: 'happy_hour', label: '  Happy Hour  ', kind: 'amount', value: 200 },
          preset('staff', 3000),
        ],
      },
    });
    expect(settings.pos.discountPresets).toEqual([
      { code: 'happy_hour', label: 'Happy Hour', kind: 'amount', value: 200 },
      { code: 'staff', label: null, kind: 'percent', value: 3000 },
    ]);
  });

  it('allows no presets at all', () => {
    expect(parseLocationSettings({ pos: { discountPresets: [] } }).pos.discountPresets).toEqual([]);
  });

  it('allows at most 8 buttons', () => {
    const codes = Array.from({ length: 9 }, (_, i) => `preset_${i}`);
    expect(
      parseLocationSettings({ pos: { discountPresets: codes.slice(0, 8).map((c) => preset(c)) } })
        .pos.discountPresets,
    ).toHaveLength(8);
    expect(() =>
      parseLocationSettings({ pos: { discountPresets: codes.map((c) => preset(c)) } }),
    ).toThrow();
  });

  it.each([
    ['an uppercase code', { code: 'Staff', kind: 'percent', value: 1000 }],
    ['a code starting with a digit', { code: '1st', kind: 'percent', value: 1000 }],
    ['an unknown kind', { code: 'staff', kind: 'free', value: 1000 }],
    ['a zero value', { code: 'staff', kind: 'percent', value: 0 }],
    ['a fractional value', { code: 'staff', kind: 'amount', value: 2.5 }],
    [
      'a label over 40 characters',
      { code: 'staff', label: 'x'.repeat(41), kind: 'percent', value: 1 },
    ],
  ])('rejects %s', (_case, invalid) => {
    expect(() => parseLocationSettings({ pos: { discountPresets: [invalid] } })).toThrow();
  });
});

describe('LAN hubs (docs/SYNC.md §1, §11)', () => {
  it('defaults to no hub: the cloud numbers the orders', () => {
    expect(parseLocationSettings({}).sync.hubUrls).toEqual([]);
    expect(parseLocationSettings({ sync: {} }).sync.hubUrls).toEqual([]);
  });

  it('accepts http(s) and ws(s) URLs, in order', () => {
    const hubUrls = ['https://hub.local:4100', 'http://192.168.1.10:4100', 'wss://hub-2.local/ws'];
    expect(parseLocationSettings({ sync: { hubUrls } }).sync.hubUrls).toEqual(hubUrls);
    expect(
      parseLocationSettings({ sync: { hubUrls: ['ws://10.0.0.2:4100'] } }).sync.hubUrls,
    ).toEqual(['ws://10.0.0.2:4100']);
  });

  it.each(['ftp://x', 'file:///etc/hosts', 'hub.local:4100', 'not a url'])('rejects %j', (url) => {
    expect(() => parseLocationSettings({ sync: { hubUrls: [url] } })).toThrow();
  });

  it('allows at most 3 hubs', () => {
    const hubUrls = ['https://a.local', 'https://b.local', 'https://c.local', 'https://d.local'];
    expect(() => parseLocationSettings({ sync: { hubUrls } })).toThrow();
  });
});
