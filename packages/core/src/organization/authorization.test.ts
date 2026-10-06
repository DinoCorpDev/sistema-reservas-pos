import { describe, expect, it } from 'vitest';
import { rappen } from '../shared/money';
import { type Actor, authorize, canApprove, isValidPin } from './authorization';
import { DEFAULT_ROLE_PERMISSIONS, type RoleKey } from './permissions';
import { DEFAULT_LOCATION_SETTINGS, parseLocationSettings } from './settings';

const actor = (role: RoleKey): Actor => ({
  userId: role,
  permissions: new Set(DEFAULT_ROLE_PERMISSIONS[role]),
});
const settings = DEFAULT_LOCATION_SETTINGS;

describe('RN-15 · actions above the thresholds need a manager PIN', () => {
  it('lets a waiter give a discount up to 20 % but not above', () => {
    expect(authorize(actor('waiter'), { kind: 'discount', percentBp: 2000 }, settings)).toEqual({
      status: 'allowed',
    });
    expect(authorize(actor('waiter'), { kind: 'discount', percentBp: 2001 }, settings)).toEqual({
      status: 'needs_approval',
      permissions: ['order.discount', 'approval.grant'],
      reason: 'above_threshold',
    });
  });

  it('lets a waiter void a pending item but not one already sent to the kitchen', () => {
    expect(authorize(actor('waiter'), { kind: 'void_item', prepStatus: 'pending' }, settings)).toEqual({
      status: 'allowed',
    });
    for (const prepStatus of ['sent', 'preparing', 'ready', 'served'] as const) {
      expect(authorize(actor('waiter'), { kind: 'void_item', prepStatus }, settings)).toMatchObject({
        status: 'needs_approval',
        reason: 'above_threshold',
      });
    }
  });

  it('follows the location configuration, not constants', () => {
    const lenient = parseLocationSettings({
      managerApproval: { discountAboveBp: 5000, voidSentItem: false },
    });
    expect(authorize(actor('waiter'), { kind: 'discount', percentBp: 3000 }, lenient).status).toBe('allowed');
    expect(authorize(actor('waiter'), { kind: 'void_item', prepStatus: 'sent' }, lenient).status).toBe(
      'allowed',
    );
  });

  it('asks for approval when the role lacks the permission (RF-A05)', () => {
    expect(authorize(actor('cashier'), { kind: 'void_order' }, settings)).toEqual({
      status: 'needs_approval',
      permissions: ['order.void'],
      reason: 'missing_permission',
    });
    expect(authorize(actor('waiter'), { kind: 'refund', amountRappen: rappen(1000) }, settings)).toEqual({
      status: 'needs_approval',
      permissions: ['payment.refund', 'approval.grant'],
      reason: 'missing_permission',
    });
  });

  it('lets managers act directly and approve for others', () => {
    const manager = actor('manager');
    for (const action of [
      { kind: 'discount', percentBp: 10000 },
      { kind: 'void_item', prepStatus: 'served' },
      { kind: 'refund', amountRappen: rappen(50000) },
      { kind: 'reopen_order' },
      { kind: 'open_drawer' },
    ] as const) {
      expect(authorize(manager, action, settings).status).toBe('allowed');
    }
    const decision = authorize(actor('waiter'), { kind: 'discount', percentBp: 5000 }, settings);
    expect(canApprove(manager, decision)).toBe(true);
    expect(canApprove(actor('cashier'), decision)).toBe(false);
    expect(canApprove(actor('kitchen'), decision)).toBe(false);
  });

  it('handles plain permission checks', () => {
    expect(authorize(actor('kitchen'), { kind: 'permission', permission: 'kitchen.operate' }, settings)).toEqual({
      status: 'allowed',
    });
    expect(
      authorize(actor('kitchen'), { kind: 'permission', permission: 'payment.take' }, settings).status,
    ).toBe('needs_approval');
  });
});

describe('PIN format (RF-A06)', () => {
  it.each(['1234', '00000', '987654'])('accepts %s', (pin) => expect(isValidPin(pin)).toBe(true));
  it.each(['123', '1234567', '12a4', ' 1234', ''])('rejects "%s"', (pin) => expect(isValidPin(pin)).toBe(false));
});
