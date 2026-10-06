import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCATION_SETTINGS, parseLocationSettings } from './settings';

describe('location settings', () => {
  it('uses the DEC-004 defaults from section 20', () => {
    expect(DEFAULT_LOCATION_SETTINGS).toEqual({
      shiftMode: 'terminal',
      managerApproval: { discountAboveBp: 2000, voidSentItem: true, refundAboveRappen: 0 },
      reservations: { blockMinutesBefore: 15, noShowAfterMinutes: 20, defaultDurationMinutes: 120 },
      kitchen: { alertAfterMinutes: 12 },
      receipts: { customerNameFromRappen: 40000 },
      security: { maxPinAttempts: 5, pinLockMinutes: 5 },
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
