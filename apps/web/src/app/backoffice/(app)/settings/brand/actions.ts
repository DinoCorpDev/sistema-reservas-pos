'use server';

import { appearance } from '@pos/api';
import { revalidatePath } from 'next/cache';
import { runAction } from '@/server/action';
import { currentActor, deps } from '@/server/actor';

/** Saves the restaurant's brand (DEC-058); the whole backoffice repaints with it. */
export async function saveAppearance(input: unknown) {
  return runAction(async () => {
    const actor = await currentActor();
    const saved = await appearance.updateAppearance(deps(), actor, input);
    revalidatePath('/backoffice', 'layout');
    return saved;
  });
}
