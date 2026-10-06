'use server';

import { admin } from '@pos/api';
import { revalidatePath } from 'next/cache';
import { runAction } from '@/server/action';
import { currentActor, deps } from '@/server/actor';

/** Activates real operation at the current location once the checklist is complete (RF-A11). */
export async function activateOperation() {
  return runAction(async () => {
    const checklist = await admin.activateOperation(deps(), await currentActor());
    revalidatePath('/backoffice');
    return checklist;
  });
}
