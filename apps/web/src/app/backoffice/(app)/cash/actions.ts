'use server';

import { cash } from '@pos/api';
import { revalidatePath } from 'next/cache';
import { runAction } from '@/server/action';
import { currentActor, deps } from '@/server/actor';

/** Closes the business day (Z) from the backoffice: the same use case as the POS (RF-D15). */
export async function closeDayAction(input: unknown) {
  return runAction(async () => {
    const closing = await cash.closeDay(
      deps(),
      await currentActor(),
      input as Parameters<typeof cash.closeDay>[2],
    );
    revalidatePath('/backoffice/cash');
    return closing;
  });
}
