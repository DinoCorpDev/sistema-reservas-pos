import { describe, expect, it } from 'vitest';
import {
  countsAsDevice,
  DEFAULT_ADDONS,
  DEFAULT_PLANS,
  entitlementsOf,
  featureForDevice,
  refuseGrowth,
  subscriptionInputSchema,
} from './plans';

const plan = (code: string) => DEFAULT_PLANS.find((p) => p.code === code)!;
const addon = (code: string) => DEFAULT_ADDONS.find((a) => a.code === code)!;

describe('plans and add-ons (DEC-045)', () => {
  it('the plan plus each add-on times its quantity', () => {
    const cafe = entitlementsOf(plan('cafe'), [
      { addon: addon('extra_device'), quantity: 2 },
      { addon: addon('kitchen_display'), quantity: 1 },
    ]);
    expect(cafe.limits).toEqual({ devices: 4, users: 5, locations: 1 });
    expect([...cafe.features]).toEqual(['kds']);
    // No limit stays no limit.
    expect(
      entitlementsOf(plan('pro'), [{ addon: addon('extra_device'), quantity: 3 }]).limits,
    ).toEqual({ devices: null, users: null, locations: null });
  });

  it('a café with two devices: the third needs an add-on', () => {
    const cafe = entitlementsOf(plan('cafe'), []);
    expect(refuseGrowth(cafe, 'devices', 1)).toBeNull();
    expect(refuseGrowth(cafe, 'devices', 2)).toEqual({
      reason: 'plan_limit',
      limit: 'devices',
      allowed: 2,
      used: 2,
    });
    const more = entitlementsOf(plan('cafe'), [{ addon: addon('extra_device'), quantity: 1 }]);
    expect(refuseGrowth(more, 'devices', 2)).toBeNull();
  });

  it('a kitchen display or a handheld needs its module', () => {
    const cafe = entitlementsOf(plan('cafe'), []);
    expect(refuseGrowth(cafe, 'devices', 0, featureForDevice('kds'))).toEqual({
      reason: 'plan_feature',
      feature: 'kds',
    });
    expect(refuseGrowth(cafe, 'devices', 0, featureForDevice('pos'))).toBeNull();
    const restaurant = entitlementsOf(plan('restaurant'), []);
    expect(refuseGrowth(restaurant, 'devices', 3, featureForDevice('handheld'))).toBeNull();
    expect(countsAsDevice('hub')).toBe(false);
    expect(countsAsDevice('phone')).toBe(true);
  });

  it('suspended: nothing new, whatever the plan', () => {
    const pro = entitlementsOf(plan('pro'), [], 'suspended');
    expect(refuseGrowth(pro, 'users', 0)).toEqual({ reason: 'subscription_suspended' });
    // Late payment only warns.
    expect(refuseGrowth(entitlementsOf(plan('pro'), [], 'past_due'), 'users', 0)).toBeNull();
  });

  it('a subscription names each add-on once', () => {
    expect(
      subscriptionInputSchema.safeParse({
        planCode: 'cafe',
        status: 'active',
        addons: [
          { code: 'extra_device', quantity: 1 },
          { code: 'extra_device', quantity: 2 },
        ],
      }).success,
    ).toBe(false);
  });
});
