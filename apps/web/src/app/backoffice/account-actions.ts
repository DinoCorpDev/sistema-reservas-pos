'use server';

import { account } from '@pos/api';
import { updateSession } from '@/auth';
import { runAction } from '@/server/action';
import { currentActor, deps } from '@/server/actor';

export async function changePassword(input: { currentPassword: string; newPassword: string }) {
  return runAction(async () => {
    await account.changeOwnPassword(deps(), await currentActor(), input);
    await updateSession({ mustChangePassword: false } as never);
    return null;
  });
}

export async function startTwoFactor() {
  return runAction(async () => account.startTwoFactor(deps(), await currentActor()));
}

export async function confirmTwoFactor(token: string) {
  return runAction(async () => account.confirmTwoFactor(deps(), await currentActor(), token));
}

export async function disableTwoFactor(currentPassword: string) {
  return runAction(async () =>
    account.disableTwoFactor(deps(), await currentActor(), { currentPassword }),
  );
}
