'use server';

import { people } from '@pos/api';
import {
  createKitchenStationSchema,
  createPrinterSchema,
  createTerminalSchema,
  updateKitchenStationSchema,
  updatePrinterSchema,
  updateTerminalSchema,
} from '@pos/core';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { explainConflict } from '@/components/backoffice/people/explain-conflict';
import { runAction } from '@/server/action';
import { currentActor, deps } from '@/server/actor';

// The setup checklist on the overview counts terminals, stations and printers (RF-A11).
const done = <T>(value: T) => {
  revalidatePath('/backoffice/devices');
  revalidatePath('/backoffice');
  return value;
};

// ── Terminals (RF-A03, RF-A06, RF-A12, RN-16) ───────────────────────────────

export async function createTerminal(input: unknown) {
  return runAction(async () => {
    const t = await getTranslations('terminals');
    const work = people.createTerminal(
      deps(),
      await currentActor(),
      createTerminalSchema.parse(input),
    );
    return done(await explainConflict(work, { fields: { orderNumberPrefix: t('prefixTaken') } }));
  });
}

/** Also (de)activates: deactivating unpairs the device at once. */
export async function updateTerminal(id: string, input: unknown) {
  return runAction(async () => {
    const t = await getTranslations('terminals');
    const work = people.updateTerminal(
      deps(),
      await currentActor(),
      id,
      updateTerminalSchema.parse(input),
    );
    return done(await explainConflict(work, { fields: { orderNumberPrefix: t('prefixTaken') } }));
  });
}

/** One-time code, valid 15 minutes, shown once to type on the device (RF-A06). */
export async function issuePairingCode(id: string) {
  return runAction(async () => {
    const t = await getTranslations('terminals');
    const work = people.issuePairingCode(deps(), await currentActor(), id);
    return done(await explainConflict(work, { rule: t('reactivateFirst') }));
  });
}

/** Unpairs a device without deactivating it, e.g. a phone whose waiter forgot to sign out. */
export async function unpairTerminal(id: string) {
  return runAction(async () => done(await people.unpairTerminal(deps(), await currentActor(), id)));
}

/** Code for waiters' own phones, valid 5 minutes for several phones (DEC-036). */
export async function issuePhonePairingCode() {
  return runAction(async () =>
    done(await people.issuePhonePairingCode(deps(), await currentActor())),
  );
}

// ── Kitchen stations (RF-A03, RF-C24, RF-C25) ───────────────────────────────

export async function createKitchenStation(input: unknown) {
  return runAction(async () =>
    done(
      await people.createKitchenStation(
        deps(),
        await currentActor(),
        createKitchenStationSchema.parse(input),
      ),
    ),
  );
}

export async function updateKitchenStation(id: string, input: unknown) {
  return runAction(async () =>
    done(
      await people.updateKitchenStation(
        deps(),
        await currentActor(),
        id,
        updateKitchenStationSchema.parse(input),
      ),
    ),
  );
}

export async function deleteKitchenStation(id: string) {
  return runAction(async () => {
    const t = await getTranslations('stations');
    const work = people.deleteKitchenStation(deps(), await currentActor(), id);
    return done(await explainConflict(work, { rule: t('inUse') }));
  });
}

// ── Printers (RF-F17) ───────────────────────────────────────────────────────

export async function createPrinter(input: unknown) {
  return runAction(async () =>
    done(
      await people.createPrinter(deps(), await currentActor(), createPrinterSchema.parse(input)),
    ),
  );
}

export async function updatePrinter(id: string, input: unknown) {
  return runAction(async () =>
    done(
      await people.updatePrinter(
        deps(),
        await currentActor(),
        id,
        updatePrinterSchema.parse(input),
      ),
    ),
  );
}

/** Test page through the location hub (RF-F17, DEC-032); the result shows in the list. */
export async function testPrinter(id: string) {
  return runAction(async () =>
    done(await people.requestPrinterTest(deps(), await currentActor(), id)),
  );
}

export async function deletePrinter(id: string) {
  return runAction(async () => {
    const t = await getTranslations('printers');
    const work = people.deletePrinter(deps(), await currentActor(), id);
    return done(await explainConflict(work, { rule: t('inUse') }));
  });
}
