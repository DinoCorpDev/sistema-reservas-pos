'use server';

import { locations } from '@pos/api';
import { updateLocationSchema } from '@pos/core';
import { revalidatePath } from 'next/cache';
import { runAction } from '@/server/action';
import { currentActor, deps } from '@/server/actor';

export async function saveLocation(id: string, input: unknown) {
  return runAction(async () => {
    const actor = await currentActor();
    const location = await locations.updateLocation(
      deps(),
      actor,
      id,
      updateLocationSchema.parse(input),
    );
    revalidatePath('/backoffice', 'layout');
    return location;
  });
}

export async function saveLocationSettings(id: string, input: unknown) {
  return runAction(async () => {
    const actor = await currentActor();
    const settings = await locations.updateLocationSettings(deps(), actor, id, input);
    revalidatePath('/backoffice/location');
    return settings;
  });
}
