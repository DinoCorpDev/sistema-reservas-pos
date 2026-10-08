import { businessDate, formatReceiptNumber, type OrderNumber, orderNumber } from '@pos/core';
import { correctedNow } from '@/device/clock';
import { type Counters, getMeta, setMeta } from '@/device/db';
import { CLOUD, callNode } from '@/device/http';
import { getPos } from '@/device/store';

/**
 * Order and receipt numbers on the device (RN-16, docs/SYNC.md §8, DEC-022, DEC-024):
 * - the location's authority (first hub, or the cloud when there is no hub) hands out `0042`
 *   when the terminal reaches it right now;
 * - otherwise the terminal numbers with its own prefix and counter (`K1-0007`), so it never
 *   collides with anyone and never waits for a timeout.
 */

const AUTHORITY_TIMEOUT_MS = 1_500;

/** The business day now, in the location's time zone (04:00 by default). */
export function currentBusinessDate(): string {
  const { bootstrap } = getPos();
  if (!bootstrap) throw new Error('No configuration on this terminal yet');
  return businessDate(
    new Date(correctedNow()),
    bootstrap.location.timezone,
    bootstrap.location.settings.businessDayStartsAt,
  );
}

async function counters(day: string): Promise<Counters> {
  const stored = await getMeta('counters');
  return stored?.businessDate === day ? stored : { businessDate: day, order: 0, receipt: 0 };
}

function authority(): string {
  const hubs = getPos().bootstrap?.location.settings.sync.hubUrls ?? [];
  return hubs[0] ?? CLOUD;
}

export async function nextOrderNumber(orderId: string): Promise<OrderNumber> {
  const { device, sync } = getPos();
  if (!device) throw new Error('This terminal is not paired');
  const target = authority();
  // Only when the last heartbeat reached the authority; a dead link is never waited for.
  if (sync.node === target) {
    try {
      return await callNode<OrderNumber>(target, '/sync/order-numbers', {
        method: 'POST',
        deviceToken: device.deviceToken,
        body: { orderId },
        timeoutMs: AUTHORITY_TIMEOUT_MS,
      });
    } catch {
      // Fall back to the terminal's own range.
    }
  }
  const day = currentBusinessDate();
  const current = await counters(day);
  const next = { ...current, order: current.order + 1 };
  await setMeta('counters', next);
  return orderNumber(day, next.order, device.prefix);
}

export async function nextReceiptNumber(): Promise<string> {
  const { device } = getPos();
  if (!device) throw new Error('This terminal is not paired');
  const day = currentBusinessDate();
  const current = await counters(day);
  const next = { ...current, receipt: current.receipt + 1 };
  await setMeta('counters', next);
  return formatReceiptNumber(device.prefix, day, next.receipt);
}
