'use server';

import { platform } from '@pos/api';
import { revalidatePath } from 'next/cache';
import { runAction } from '@/server/action';
import { currentActor, deps } from '@/server/actor';

/** Creates the practice copy, or a fresh one in place of the previous (RF-F22). */
export async function createTraining() {
  return runAction(async () => {
    const training = await platform.createTraining(deps(), await currentActor());
    revalidatePath('/backoffice/plan');
    return training;
  });
}

/** One-time code for a practice device, valid 15 minutes (RF-A06, RF-F22). */
export async function issueTrainingPairingCode(terminalId: string) {
  return runAction(async () =>
    platform.issueTrainingPairingCode(deps(), await currentActor(), terminalId),
  );
}
