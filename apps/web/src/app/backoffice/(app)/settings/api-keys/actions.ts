'use server';

import { people } from '@pos/api';
import { createApiKeySchema } from '@pos/core';
import { revalidatePath } from 'next/cache';
import { runAction } from '@/server/action';
import { currentActor, deps } from '@/server/actor';

const done = <T>(value: T) => {
  revalidatePath('/backoffice/settings/api-keys');
  return value;
};

/** Creates a key (RF-F14). The result carries the full key: the only time it is ever shown. */
export async function createApiKey(input: unknown) {
  return runAction(async () =>
    done(await people.createApiKey(deps(), await currentActor(), createApiKeySchema.parse(input))),
  );
}

export async function revokeApiKey(id: string) {
  return runAction(async () => done(await people.revokeApiKey(deps(), await currentActor(), id)));
}
