import type { Operation, OperationOf } from '@pos/core';
import { type CommandRecorder, schema as s, type Transaction } from '@pos/db';
import { and, eq } from 'drizzle-orm';
import type { SyncScope } from './store';

type ClockOperation = OperationOf<'staff.clock_in'> | OperationOf<'staff.clock_out'>;

const isClock = (op: Operation): op is ClockOperation =>
  op.type === 'staff.clock_in' || op.type === 'staff.clock_out';

/**
 * The working time of the staff (RF-A09, DEC-054): each new `staff.clock_in` / `staff.clock_out`
 * fills its half of the entry, keyed by the entry id made on the device. Order does not matter
 * (an exit may arrive first) and a repeated operation changes nothing. An entry a manager has
 * corrected keeps the manager's times. The audits come from the fold of the order-less
 * operations (push.ts); here go the rows and the events.
 */
export async function projectTimeEntries(
  tx: Transaction,
  scope: SyncScope,
  fresh: readonly Operation[],
  recorder: CommandRecorder,
): Promise<void> {
  for (const op of fresh) {
    if (!isClock(op)) continue;
    const id = op.payload.timeEntryId;
    const at = new Date(op.deviceAt);
    const isIn = op.type === 'staff.clock_in';
    const [row] = await tx
      .select({
        userId: s.timeEntries.userId,
        clockInAt: s.timeEntries.clockInAt,
        clockOutAt: s.timeEntries.clockOutAt,
        correctedByUserId: s.timeEntries.correctedByUserId,
      })
      .from(s.timeEntries)
      .where(and(eq(s.timeEntries.id, id), eq(s.timeEntries.organizationId, scope.organizationId)))
      .for('update');

    if (!row) {
      await tx.insert(s.timeEntries).values({
        id,
        organizationId: scope.organizationId,
        locationId: scope.locationId,
        userId: op.userId,
        ...(isIn
          ? { clockInAt: at, clockInTerminalId: op.terminalId }
          : { clockOutAt: at, clockOutTerminalId: op.terminalId }),
        deviceUpdatedAt: at,
      });
    } else {
      const missing = isIn ? row.clockInAt === null : row.clockOutAt === null;
      // Another person's entry id, a half already there or a manager's correction: unchanged.
      if (row.userId !== op.userId || !missing || row.correctedByUserId !== null) continue;
      await tx
        .update(s.timeEntries)
        .set({
          ...(isIn
            ? { clockInAt: at, clockInTerminalId: op.terminalId }
            : { clockOutAt: at, clockOutTerminalId: op.terminalId }),
          deviceUpdatedAt: at,
          updatedAt: new Date(),
        })
        .where(
          and(eq(s.timeEntries.id, id), eq(s.timeEntries.organizationId, scope.organizationId)),
        );
    }

    recorder.event({
      type: isIn ? 'staff.clocked_in' : 'staff.clocked_out',
      aggregateType: 'time_entry',
      aggregateId: id,
      payload: { timeEntryId: id, userId: op.userId, terminalId: op.terminalId, at: op.deviceAt },
      userId: op.userId,
      terminalId: op.terminalId,
      occurredAt: at,
    });
  }
}
