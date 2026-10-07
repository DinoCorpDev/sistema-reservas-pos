import {
  newId,
  type Operation,
  type OperationApproval,
  type OperationOf,
  type OperationType,
  OPERATION_SCHEMA_VERSION,
} from '@pos/core';
import { nextHlc } from './clock';
import { getPos } from './store';

/**
 * Builds an operation of this device (docs/SYNC.md §2): a new UUID v7 (the idempotency key), the
 * next HLC, the corrected device time and the person who unlocked the terminal.
 */
export async function makeOperation<T extends OperationType>(
  type: T,
  orderId: string | null,
  payload: OperationOf<T>['payload'],
  options: { approval?: OperationApproval | null; userId?: string | null } = {},
): Promise<OperationOf<T>> {
  const { device, user } = getPos();
  if (!device) throw new Error('This terminal is not paired');
  const userId = options.userId === undefined ? (user?.id ?? null) : options.userId;
  if (userId === null && type !== 'terminal.pin_failed') {
    throw new Error('Unlock the terminal with a PIN first');
  }
  const clock = await nextHlc();
  const op = {
    id: newId(),
    schemaVersion: OPERATION_SCHEMA_VERSION,
    hlc: clock.hlc,
    deviceAt: clock.deviceAt,
    organizationId: device.organizationId,
    locationId: device.locationId,
    terminalId: device.terminalId,
    userId,
    approval: options.approval ?? null,
    orderId,
    type,
    payload,
  };
  return op as unknown as OperationOf<T>;
}

export type { Operation };
