import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, isEventType } from './events';

describe('EVENT_TYPES (section 16)', () => {
  it('uses the lowercase module.fact naming rule', () => {
    for (const type of EVENT_TYPES) {
      expect(type).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });

  it('has no duplicates', () => {
    expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length);
  });

  it('covers every event listed in the requirements document', () => {
    expect(EVENT_TYPES).toHaveLength(38);
    for (const type of [
      'order.created',
      'order.split',
      'payment.completed',
      'day.closed',
      'reservation.no_show',
      'customer.anonymized',
      'tax.rule_changed',
      'sync.conflict_detected',
      'device.online',
    ]) {
      expect(isEventType(type)).toBe(true);
    }
  });

  it('rejects unknown names', () => {
    expect(isEventType('order.deleted')).toBe(false);
    expect(isEventType(42)).toBe(false);
  });
});
