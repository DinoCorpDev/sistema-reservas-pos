'use server';

import { admin } from '@pos/api';
import { createSupportGrantSchema } from '@pos/core';
import { revalidatePath } from 'next/cache';
import { runAction } from '@/server/action';
import { currentActor, deps } from '@/server/actor';

export async function grantSupportAccess(input: unknown) {
  return runAction(async () => {
    const grant = await admin.grantSupportAccess(
      deps(),
      await currentActor(),
      createSupportGrantSchema.parse(input),
    );
    revalidatePath('/backoffice/settings/support');
    return grant;
  });
}

export async function revokeSupportGrant(id: string) {
  return runAction(async () => {
    await admin.revokeSupportGrant(deps(), await currentActor(), id);
    revalidatePath('/backoffice/settings/support');
    return null;
  });
}
