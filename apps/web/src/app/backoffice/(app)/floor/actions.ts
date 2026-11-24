'use server';

import { locations, toApiError } from '@pos/api';
import {
  createAreaSchema,
  createTableSchema,
  floorPhotoSchema,
  type PlannedTable,
  saveFloorLayoutSchema,
  updateAreaSchema,
  updateTableSchema,
} from '@pos/core';
import { createLogger, loggableError } from '@pos/db';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { runAction } from '@/server/action';
import { currentActor, deps } from '@/server/actor';

const logger = createLogger('web');

const done = <T>(value: T) => {
  revalidatePath('/backoffice/floor', 'layout');
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
    done(
      await locations.updateArea(deps(), await currentActor(), id, updateAreaSchema.parse(input)),
    ),
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
    done(
      await locations.updateTable(deps(), await currentActor(), id, updateTableSchema.parse(input)),
    ),
  );
}

export async function regenerateQr(id: string) {
  return runAction(async () =>
    done(await locations.regenerateTableQr(deps(), await currentActor(), id)),
  );
}

export async function deleteTable(id: string) {
  return runAction(async () => done(await locations.deleteTable(deps(), await currentActor(), id)));
}

// ── Floor plan (DEC-056) ────────────────────────────────────────────────────

export async function saveFloorLayout(areaId: string, input: unknown) {
  return runAction(async () =>
    done(
      await locations.saveFloorLayout(
        deps(),
        await currentActor(),
        areaId,
        saveFloorLayoutSchema.parse(input),
      ),
    ),
  );
}

export type FloorPhotoResult =
  | { ok: true; tables: PlannedTable[]; notes: string | null }
  | {
      ok: false;
      reason: 'ai_not_configured' | 'ai_refused' | 'ai_unreadable' | 'ai_failed' | 'error';
    };

const PHOTO_REASONS = new Set(['ai_not_configured', 'ai_refused', 'ai_unreadable', 'ai_failed']);

/** The AI reads the photo and proposes the plan; nothing is saved (PA-07). */
export async function readFloorPhoto(areaId: string, photo: unknown): Promise<FloorPhotoResult> {
  const parsed = floorPhotoSchema.safeParse(photo);
  if (!parsed.success) return { ok: false, reason: 'ai_unreadable' };
  try {
    const proposal = await locations.readFloorPhoto(
      deps(),
      await currentActor(),
      areaId,
      parsed.data,
    );
    return { ok: true, ...proposal };
  } catch (error) {
    unstable_rethrow(error);
    const reason = (toApiError(error).details as { reason?: string } | undefined)?.reason ?? '';
    if (PHOTO_REASONS.has(reason)) return { ok: false, reason: reason as 'ai_failed' };
    logger.error('floor photo failed', { error: loggableError(error) });
    return { ok: false, reason: 'error' };
  }
}
