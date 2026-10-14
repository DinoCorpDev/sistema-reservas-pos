import { resetDeviceData } from './db';
import { CLOUD, callNode, NodeError } from './http';
import { getPos, usePos } from './store';
import { flushToCloud } from './sync';

/**
 * A personal device unpairs itself (DEC-036): a waiter signing out of their phone, or whoever
 * holds the cashier POS unpairing it. It forgets everything and asks for a pairing code again.
 * Nothing it did may be lost, so it first sends everything to the cloud and refuses while
 * anything is missing there.
 */

/** Operations of this phone have not reached the cloud yet (no network, or the cloud refused). */
export class UnsentOperationsError extends Error {
  override readonly name = 'UnsentOperationsError';
  constructor(readonly pending: number) {
    super(`${pending} operations of this phone are not in the cloud yet`);
  }
}

export async function signOutPhone(): Promise<void> {
  const device = getPos().device;
  if (!device) return;
  const pending = await flushToCloud();
  if (pending > 0) throw new UnsentOperationsError(pending);
  try {
    await callNode(CLOUD, '/terminals/logout', {
      method: 'POST',
      deviceToken: device.deviceToken,
    });
  } catch (cause) {
    // Already unpaired in the backoffice: signing out is done anyway.
    if (!(cause instanceof NodeError && cause.status === 401)) throw cause;
  }
  usePos.setState({ device: null, user: null });
  await resetDeviceData();
  window.location.reload();
}
