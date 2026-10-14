import { describe, expect, it } from 'vitest';
import type { TerminalType } from '../organization/constants';
import { DEFAULT_ROLE_PERMISSIONS } from '../organization/permissions';
import { parseLocationSettings } from '../organization/settings';
import type { ShiftMode } from './constants';
import { sameShiftOwner, shiftOwnerFor } from './owner';

const USER = 'user-1';
const at = (type: TerminalType) => ({ id: `t-${type}`, type });

describe('shiftOwnerFor (RN-19, DEC-038)', () => {
  const till = (type: TerminalType) => ({ scope: 'terminal', terminalId: `t-${type}` });
  const wallet = { scope: 'personal', userId: USER };

  it.each<[ShiftMode, TerminalType, object | null]>([
    // Only at the till: the POS and handhelds use their drawer, a phone takes no cash.
    ['terminal', 'pos', till('pos')],
    ['terminal', 'handheld', till('handheld')],
    ['terminal', 'phone', null],
    // Every waiter with a wallet: the person's shift, whatever the device.
    ['cashier', 'pos', wallet],
    ['cashier', 'handheld', wallet],
    ['cashier', 'phone', wallet],
    // Both: the till on its own devices, the wallet on the waiter's phone.
    ['mixed', 'pos', till('pos')],
    ['mixed', 'handheld', till('handheld')],
    ['mixed', 'phone', wallet],
  ])('in %s mode a %s takes cash into %o', (mode, type, owner) => {
    expect(shiftOwnerFor(mode, at(type), USER)).toEqual(owner);
  });

  it('kitchen displays and hubs never take cash', () => {
    for (const mode of ['terminal', 'cashier', 'mixed'] as const) {
      expect(shiftOwnerFor(mode, at('kds'), USER)).toBeNull();
      expect(shiftOwnerFor(mode, at('hub'), USER)).toBeNull();
    }
  });

  it('compares owners by drawer or by person', () => {
    expect(
      sameShiftOwner(
        { scope: 'terminal', terminalId: 'a' },
        { scope: 'terminal', terminalId: 'a' },
      ),
    ).toBe(true);
    expect(
      sameShiftOwner({ scope: 'terminal', terminalId: 'a' }, { scope: 'personal', userId: 'a' }),
    ).toBe(false);
    expect(
      sameShiftOwner({ scope: 'personal', userId: 'a' }, { scope: 'personal', userId: 'b' }),
    ).toBe(false);
  });
});

describe('cash collection settings (DEC-038)', () => {
  it('accepts the mixed mode and keeps the till as default', () => {
    expect(parseLocationSettings({}).shiftMode).toBe('terminal');
    expect(parseLocationSettings({ shiftMode: 'mixed' }).shiftMode).toBe('mixed');
  });

  it('lets a waiter open and close their own wallet by default', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.waiter).toEqual(
      expect.arrayContaining(['shift.open', 'shift.close']),
    );
  });
});
