'use server';

import { sync } from '@pos/api';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { runAction } from '@/server/action';
import { currentActor, deps } from '@/server/actor';

/** Same contract as `POST /api/v1/sync/conflicts/{id}/resolve`: a note of 1 to 500 characters. */
const resolveSyncConflictSchema = z.object({
  id: z.uuid(),
  note: z.string().trim().min(1).max(500),
});

/** Marks a synchronization conflict as resolved, with the manager's note (audited, RNF-04). */
export async function resolveSyncConflict(id: string, note: string) {
  return runAction(async () => {
    const input = resolveSyncConflictSchema.parse({ id, note });
    await sync.resolveConflict(deps(), await currentActor(), input.id, { note: input.note });
    revalidatePath('/backoffice/sync-conflicts');
    return null;
  });
}
