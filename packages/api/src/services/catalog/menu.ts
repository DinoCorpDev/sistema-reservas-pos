import { buildMenu, type menuQuerySchema } from '@pos/core';
import type { z } from 'zod';
import { type Actor, requireLocationId } from '../../actor';
import type { ServiceDeps } from '../shared';
import { assertCatalogRead } from './common';
import { loadCatalogSnapshot } from './snapshot';

/**
 * The menu of the current location for one channel and language (RF-B15, RF-E06, RF-F14): one
 * catalog feeds POS, QR and web. Built by `buildMenu()` of @pos/core from the raw snapshot, the
 * same code the POS runs offline (docs/SYNC.md §6.4).
 */
export async function getMenu(
  deps: ServiceDeps,
  actor: Actor,
  query: z.output<typeof menuQuerySchema>,
) {
  assertCatalogRead(actor);
  const locationId = requireLocationId(actor);
  const snapshot = await loadCatalogSnapshot(deps.db, actor, locationId);
  return buildMenu(snapshot, {
    channel: query.channel,
    language: query.language,
    at: query.at ? new Date(query.at) : new Date(),
  });
}
export type MenuDto = Awaited<ReturnType<typeof getMenu>>;
