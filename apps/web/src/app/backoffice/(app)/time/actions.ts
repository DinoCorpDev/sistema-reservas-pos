'use server';

import { people } from '@pos/api';
import { correctTimeEntrySchema } from '@pos/core';
import { revalidatePath } from 'next/cache';
import { runAction } from '@/server/action';
import { currentActor, deps } from '@/server/actor';

/** A manager corrects the times of an entry, with the reason (DEC-054). */
export async function correctTimeEntry(id: string, input: unknown) {
  return runAction(async () => {
    await people.correctTimeEntry(
      deps(),
      await currentActor(),
      id,
      correctTimeEntrySchema.parse(input),
    );
    revalidatePath('/backoffice/time');
  });
}
