import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLE_KEYS } from './permissions';

describe('default role permissions', () => {
  it('defines the five predefined roles of RF-A04', () => {
    expect(Object.keys(DEFAULT_ROLE_PERMISSIONS).sort()).toEqual([...ROLE_KEYS].sort());
  });

  it('only references known permissions, without duplicates', () => {
    for (const permissions of Object.values(DEFAULT_ROLE_PERMISSIONS)) {
      expect(new Set(permissions).size).toBe(permissions.length);
      for (const permission of permissions) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });

  it('gives the admin every permission', () => {
    expect([...DEFAULT_ROLE_PERMISSIONS.admin].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('keeps sensitive actions away from waiters and cashiers (RF-A05)', () => {
    for (const role of ['waiter', 'cashier'] as const) {
      for (const sensitive of [
        'order.reopen',
        'payment.refund',
        'day.close',
        'catalog.price_change',
      ]) {
        expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(sensitive);
      }
    }
  });

  it('lets the manager authorize voids, discounts, reopen, refunds and closings', () => {
    for (const permission of [
      'order.void_item',
      'order.void',
      'order.discount',
      'order.reopen',
      'payment.refund',
      'shift.close',
      'day.close',
      'cash.open_drawer',
    ]) {
      expect(DEFAULT_ROLE_PERMISSIONS.manager).toContain(permission);
    }
    expect(DEFAULT_ROLE_PERMISSIONS.manager).not.toContain('tax.manage');
  });
});
