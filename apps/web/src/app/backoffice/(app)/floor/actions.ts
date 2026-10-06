'use server';

import { locations } from '@pos/api';
import { createAreaSchema, createTableSchema, updateAreaSchema, updateTableSchema } from '@pos/core';
import { revalidatePath } from 'next/cache';
import { runAction } from '@/server/action';
import { currentActor, deps } from '@/server/actor';

const done = <T>(value: T) => {
  revalidatePath('/backoffice/floor');
  revalidatePath('/backoffice');
  return value;
};

export async function createArea(input: unknown) {
  return runAction(async () =>
    done(await locations.createArea(deps(), await currentActor(), createAreaSchema.parse(input))),
  );
}

export async function updateArea(id: string, input: unknown) {
  return runAction(async () =>
    done(await locations.updateArea(deps(), await currentActor(), id, updateAreaSchema.parse(input))),
  );
}

export async function deleteArea(id: string) {
  return runAction(async () => done(await locations.deleteArea(deps(), await currentActor(), id)));
}

export async function createTable(input: unknown) {
  return runAction(async () =>
    done(await locations.createTable(deps(), await currentActor(), createTableSchema.parse(input))),
  );
}

export async function updateTable(id: string, input: unknown) {
  return runAction(async () =>
    done(await locations.updateTable(deps(), await currentActor(), id, updateTableSchema.parse(input))),
  );
}

export async function regenerateQr(id: string) {
  return runAction(async () => done(await locations.regenerateTableQr(deps(), await currentActor(), id)));
}

export async function deleteTable(id: string) {
  return runAction(async () => done(await locations.deleteTable(deps(), await currentActor(), id)));
}
