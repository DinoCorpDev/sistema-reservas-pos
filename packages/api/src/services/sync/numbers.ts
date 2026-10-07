import {
  businessDate,
  formatOrderNumber,
  type OrderNumber,
  parseLocationSettings,
} from '@pos/core';
import { runCommand, schema as s } from '@pos/db';
import { and, eq } from 'drizzle-orm';
import { type Actor, requireTerminal } from '../../actor';
import { ApiError } from '../../errors';
import type { SyncDeps } from './push';

/**
 * `POST /sync/order-numbers` (docs/SYNC.md §6.3, RN-16, DEC-022): the location's authority
 * hands out the next short number of the business day. Only the authority answers: the hub if
 * the location has hubs, otherwise the cloud. Asking twice for the same order returns the same
 * number; a number is never handed out twice.
 */
export async function claimOrderNumber(
  deps: SyncDeps,
  actor: Actor,
  input: { orderId: string },
): Promise<OrderNumber> {
  const { locationId } = requireTerminal(actor);
  const node = deps.node ?? { kind: 'cloud' };
  return runCommand(deps.db, { organizationId: actor.organizationId, locationId }, async (tx) => {
    const [location] = await tx
      .select({ timezone: s.locations.timezone, settings: s.locations.settings })
      .from(s.locations)
      .where(
        and(eq(s.locations.id, locationId), eq(s.locations.organizationId, actor.organizationId)),
      )
      .for('update');
    if (!location) throw new ApiError('NOT_FOUND', 'Location not found');
    const settings = parseLocationSettings(location.settings);
    const authority =
      node.kind === 'cloud' ? settings.sync.hubUrls.length === 0 : node.authority !== false;
    if (!authority) {
      throw new ApiError(
        'CONFLICT',
        'This node does not number the orders of the location; use the terminal prefix',
        {
          reason: 'not_authority',
        },
      );
    }

    const [claimed] = await tx
      .select()
      .from(s.orderNumberClaims)
      .where(
        and(
          eq(s.orderNumberClaims.id, input.orderId),
          eq(s.orderNumberClaims.locationId, locationId),
        ),
      );
    if (claimed) {
      return {
        businessDate: claimed.businessDate,
        number: claimed.orderNumber,
        prefix: '',
        display: formatOrderNumber(claimed.orderNumber, ''),
      };
    }

    const now = new Date();
    const day = businessDate(now, location.timezone, settings.businessDayStartsAt);
    const [sequence] = await tx
      .select()
      .from(s.orderNumberSequences)
      .where(
        and(
          eq(s.orderNumberSequences.locationId, locationId),
          eq(s.orderNumberSequences.businessDate, day),
          eq(s.orderNumberSequences.prefix, ''),
        ),
      )
      .for('update');
    const number = (sequence?.lastNumber ?? 0) + 1;
    if (sequence) {
      await tx
        .update(s.orderNumberSequences)
        .set({ lastNumber: number, updatedAt: now })
        .where(eq(s.orderNumberSequences.id, sequence.id));
    } else {
      await tx.insert(s.orderNumberSequences).values({
        organizationId: actor.organizationId,
        locationId,
        businessDate: day,
        prefix: '',
        lastNumber: number,
        updatedAt: now,
      });
    }
    await tx.insert(s.orderNumberClaims).values({
      id: input.orderId,
      organizationId: actor.organizationId,
      locationId,
      businessDate: day,
      orderNumber: number,
      createdAt: now,
    });
    return { businessDate: day, number, prefix: '', display: formatOrderNumber(number, '') };
  });
}
