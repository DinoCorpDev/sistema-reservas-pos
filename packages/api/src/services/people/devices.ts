import type {
  createKitchenStationSchema,
  createPrinterSchema,
  createTerminalSchema,
  pairTerminalSchema,
  updateKitchenStationSchema,
  updatePrinterSchema,
  updateTerminalSchema,
} from '@pos/core';
import {
  inLocation,
  inOrg,
  normalizePairingCode,
  notDeleted,
  ownedByLocation,
  pairingCode,
  randomToken,
  runCommand,
  schema as s,
  sha256Hex,
} from '@pos/db';
import { and, asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { type Actor, assertPermission, requireLocationId } from '../../actor';
import { ApiError, isDuplicateKey, notFound } from '../../errors';
import { changedFields, definedOnly, iso, type ServiceDeps } from '../shared';
import { findPhoneCode, pairPhone } from './phones';

// ── Printers (RF-F17) ───────────────────────────────────────────────────────

type PrinterRow = typeof s.printers.$inferSelect;
type PrinterStatusRow = typeof s.printerStatus.$inferSelect;

/** A printer with what the hub last reported about it (DEC-032). */
const toPrinterDto = (row: PrinterRow, status: PrinterStatusRow | null = null) => ({
  id: row.id,
  locationId: row.locationId,
  name: row.name,
  kind: row.kind,
  protocol: row.protocol,
  host: row.host,
  port: row.port,
  paperWidthMm: row.paperWidthMm,
  hasCashDrawer: row.hasCashDrawer,
  isActive: row.isActive,
  lastTestAt: iso(status?.lastTestAt ?? row.lastTestAt),
  lastTestOk: status?.lastTestOk ?? null,
  testRequestedAt: iso(row.testRequestedAt),
  lastOkAt: iso(status?.lastOkAt ?? null),
  lastError: status?.lastError ?? null,
  lastErrorAt: iso(status?.lastErrorAt ?? null),
});
export type PrinterDto = ReturnType<typeof toPrinterDto>;

async function loadPrinter(deps: ServiceDeps, actor: Actor, id: string) {
  const [row] = await deps.db
    .select()
    .from(s.printers)
    .where(inLocation(s.printers, actor, eq(s.printers.id, id), notDeleted(s.printers)));
  if (!row) throw notFound('Printer');
  return row;
}

async function printerDto(deps: ServiceDeps, actor: Actor, id: string): Promise<PrinterDto> {
  const row = await loadPrinter(deps, actor, id);
  const [status] = await deps.db
    .select()
    .from(s.printerStatus)
    .where(inLocation(s.printerStatus, actor, eq(s.printerStatus.id, id)));
  return toPrinterDto(row, status ?? null);
}

export async function listPrinters(deps: ServiceDeps, actor: Actor): Promise<PrinterDto[]> {
  requireLocationId(actor);
  const rows = await deps.db
    .select({ printer: s.printers, status: s.printerStatus })
    .from(s.printers)
    .leftJoin(s.printerStatus, eq(s.printerStatus.id, s.printers.id))
    .where(inLocation(s.printers, actor, notDeleted(s.printers)))
    .orderBy(asc(s.printers.name));
  return rows.map((row) => toPrinterDto(row.printer, row.status));
}

/**
 * Asks the location hub for a test page (RF-F17, DEC-032): the request travels with the
 * configuration, the hub prints and reports the result, which `listPrinters` shows.
 */
export async function requestPrinterTest(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
): Promise<PrinterDto> {
  assertPermission(actor, 'location.manage');
  await loadPrinter(deps, actor, id);
  await deps.db
    .update(s.printers)
    .set({ testRequestedAt: new Date() })
    .where(inLocation(s.printers, actor, eq(s.printers.id, id)));
  return printerDto(deps, actor, id);
}

export async function createPrinter(
  deps: ServiceDeps,
  actor: Actor,
  input: z.output<typeof createPrinterSchema>,
): Promise<PrinterDto> {
  assertPermission(actor, 'location.manage');
  requireLocationId(actor);
  const [row] = await deps.db
    .insert(s.printers)
    .values(ownedByLocation(actor, input))
    .$returningId();
  return printerDto(deps, actor, row!.id);
}

export async function updatePrinter(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: z.output<typeof updatePrinterSchema>,
): Promise<PrinterDto> {
  assertPermission(actor, 'location.manage');
  await loadPrinter(deps, actor, id);
  await deps.db
    .update(s.printers)
    .set(definedOnly(input))
    .where(inLocation(s.printers, actor, eq(s.printers.id, id)));
  return printerDto(deps, actor, id);
}

/** Soft delete (PA-06); only when no station or terminal prints on it any more. */
export async function deletePrinter(deps: ServiceDeps, actor: Actor, id: string): Promise<void> {
  assertPermission(actor, 'location.manage');
  await loadPrinter(deps, actor, id);
  const [station] = await deps.db
    .select({ id: s.kitchenStations.id })
    .from(s.kitchenStations)
    .where(
      inLocation(
        s.kitchenStations,
        actor,
        eq(s.kitchenStations.printerId, id),
        notDeleted(s.kitchenStations),
      ),
    )
    .limit(1);
  const [terminal] = await deps.db
    .select({ id: s.terminals.id })
    .from(s.terminals)
    .where(
      inLocation(s.terminals, actor, eq(s.terminals.receiptPrinterId, id), notDeleted(s.terminals)),
    )
    .limit(1);
  if (station || terminal) {
    throw new ApiError(
      'CONFLICT',
      'Stations or terminals still print on this printer; reassign them first',
    );
  }
  await deps.db
    .update(s.printers)
    .set({ deletedAt: new Date(), isActive: false })
    .where(inLocation(s.printers, actor, eq(s.printers.id, id)));
}

// ── Kitchen stations (RF-A03, RF-C24, RF-C25) ───────────────────────────────

type StationRow = typeof s.kitchenStations.$inferSelect;

const toStationDto = (row: StationRow) => ({
  id: row.id,
  locationId: row.locationId,
  name: row.name,
  alertAfterMinutes: row.alertAfterMinutes,
  language: row.language,
  printerId: row.printerId,
  fallbackStationId: row.fallbackStationId,
  sortOrder: row.sortOrder,
  isActive: row.isActive,
});
export type KitchenStationDto = ReturnType<typeof toStationDto>;

/** The replacement must be another station of the same location (DEC-033). */
async function assertFallback(
  deps: ServiceDeps,
  actor: Actor,
  stationId: string | null,
  fallbackStationId: string | null | undefined,
) {
  if (!fallbackStationId) return;
  if (fallbackStationId === stationId) {
    throw new ApiError('RULE_VIOLATION', 'A station cannot replace itself', {
      rule: 'fallback_self',
    });
  }
  await loadStation(deps, actor, fallbackStationId);
}

async function loadStation(deps: ServiceDeps, actor: Actor, id: string) {
  const [row] = await deps.db
    .select()
    .from(s.kitchenStations)
    .where(
      inLocation(
        s.kitchenStations,
        actor,
        eq(s.kitchenStations.id, id),
        notDeleted(s.kitchenStations),
      ),
    );
  if (!row) throw notFound('Kitchen station');
  return row;
}

export async function listKitchenStations(
  deps: ServiceDeps,
  actor: Actor,
): Promise<KitchenStationDto[]> {
  requireLocationId(actor);
  const rows = await deps.db
    .select()
    .from(s.kitchenStations)
    .where(inLocation(s.kitchenStations, actor, notDeleted(s.kitchenStations)))
    .orderBy(asc(s.kitchenStations.sortOrder), asc(s.kitchenStations.name));
  return rows.map(toStationDto);
}

export async function createKitchenStation(
  deps: ServiceDeps,
  actor: Actor,
  input: z.output<typeof createKitchenStationSchema>,
): Promise<KitchenStationDto> {
  assertPermission(actor, 'location.manage');
  requireLocationId(actor);
  if (input.printerId) await loadPrinter(deps, actor, input.printerId);
  await assertFallback(deps, actor, null, input.fallbackStationId);
  const [row] = await deps.db
    .insert(s.kitchenStations)
    .values(ownedByLocation(actor, input))
    .$returningId();
  return toStationDto(await loadStation(deps, actor, row!.id));
}

export async function updateKitchenStation(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: z.output<typeof updateKitchenStationSchema>,
): Promise<KitchenStationDto> {
  assertPermission(actor, 'location.manage');
  await loadStation(deps, actor, id);
  if (input.printerId) await loadPrinter(deps, actor, input.printerId);
  await assertFallback(deps, actor, id, input.fallbackStationId);
  await deps.db
    .update(s.kitchenStations)
    .set(definedOnly(input))
    .where(inLocation(s.kitchenStations, actor, eq(s.kitchenStations.id, id)));
  return toStationDto(await loadStation(deps, actor, id));
}

/** Soft delete (PA-06); only when no product is routed to it and no KDS shows it. */
export async function deleteKitchenStation(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
): Promise<void> {
  assertPermission(actor, 'location.manage');
  await loadStation(deps, actor, id);
  const [route] = await deps.db
    .select({ id: s.productStationRoutes.id })
    .from(s.productStationRoutes)
    .where(
      inLocation(
        s.productStationRoutes,
        actor,
        eq(s.productStationRoutes.kitchenStationId, id),
        notDeleted(s.productStationRoutes),
      ),
    )
    .limit(1);
  const [terminal] = await deps.db
    .select({ id: s.terminals.id })
    .from(s.terminals)
    .where(
      inLocation(s.terminals, actor, eq(s.terminals.kitchenStationId, id), notDeleted(s.terminals)),
    )
    .limit(1);
  // Another station sends here when nobody is there (DEC-033).
  const [standIn] = await deps.db
    .select({ id: s.kitchenStations.id })
    .from(s.kitchenStations)
    .where(
      inLocation(
        s.kitchenStations,
        actor,
        eq(s.kitchenStations.fallbackStationId, id),
        notDeleted(s.kitchenStations),
      ),
    )
    .limit(1);
  if (route || terminal || standIn) {
    throw new ApiError(
      'CONFLICT',
      'Products, KDS terminals or other stations still use this station; reroute them first, or deactivate the station',
    );
  }
  await deps.db
    .update(s.kitchenStations)
    .set({ deletedAt: new Date(), isActive: false })
    .where(inLocation(s.kitchenStations, actor, eq(s.kitchenStations.id, id)));
}

// ── Terminals (RF-A03, RF-A12, RN-16) ───────────────────────────────────────

export type TerminalRow = typeof s.terminals.$inferSelect;

/** `userName`: the waiter who owns a phone (DEC-036), when the list joins it. */
export const toTerminalDto = (row: TerminalRow, userName: string | null = null) => ({
  id: row.id,
  locationId: row.locationId,
  name: row.name,
  type: row.type,
  orderNumberPrefix: row.orderNumberPrefix,
  kitchenStationId: row.kitchenStationId,
  receiptPrinterId: row.receiptPrinterId,
  appVersion: row.appVersion,
  lastSeenAt: iso(row.lastSeenAt),
  isPaired: row.deviceTokenHash !== null,
  pairedAt: iso(row.pairedAt),
  pairingExpiresAt: iso(row.pairingCodeHash ? row.pairingExpiresAt : null),
  isActive: row.isActive,
  deactivatedAt: iso(row.deactivatedAt),
  userId: row.userId,
  userName,
});
export type TerminalDto = ReturnType<typeof toTerminalDto>;

export const PAIRING_CODE_TTL_MINUTES = 15;

async function loadTerminal(deps: ServiceDeps, actor: Actor, id: string) {
  const [row] = await deps.db
    .select()
    .from(s.terminals)
    .where(inLocation(s.terminals, actor, eq(s.terminals.id, id), notDeleted(s.terminals)));
  if (!row) throw notFound('Terminal');
  return row;
}

async function assertTerminalRefs(
  deps: ServiceDeps,
  actor: Actor,
  input: { kitchenStationId?: string | null; receiptPrinterId?: string | null },
) {
  if (input.kitchenStationId) await loadStation(deps, actor, input.kitchenStationId);
  if (input.receiptPrinterId) await loadPrinter(deps, actor, input.receiptPrinterId);
}

/** RN-16: the offline order-number prefix is unique per location, also among deactivated terminals. */
function prefixTaken(error: unknown): never {
  if (isDuplicateKey(error)) {
    throw new ApiError('CONFLICT', 'Another terminal of this location already uses this prefix', {
      field: 'orderNumberPrefix',
    });
  }
  throw error;
}

export async function listTerminals(deps: ServiceDeps, actor: Actor): Promise<TerminalDto[]> {
  requireLocationId(actor);
  const rows = await deps.db
    .select({ terminal: s.terminals, userName: s.users.displayName })
    .from(s.terminals)
    .leftJoin(
      s.users,
      and(eq(s.users.id, s.terminals.userId), eq(s.users.organizationId, actor.organizationId)),
    )
    .where(inLocation(s.terminals, actor, notDeleted(s.terminals)))
    .orderBy(asc(s.terminals.name));
  return rows.map((row) => toTerminalDto(row.terminal, row.userName));
}

export async function createTerminal(
  deps: ServiceDeps,
  actor: Actor,
  input: z.output<typeof createTerminalSchema>,
): Promise<TerminalDto> {
  assertPermission(actor, 'location.manage');
  requireLocationId(actor);
  await assertTerminalRefs(deps, actor, input);
  const id = await runCommand(deps.db, actor, async (tx, recorder) => {
    const [row] = await tx.insert(s.terminals).values(ownedByLocation(actor, input)).$returningId();
    recorder.audit({
      action: 'terminal.created',
      entityType: 'terminal',
      entityId: row!.id,
      after: input,
    });
    return row!.id;
  }).catch(prefixTaken);
  return toTerminalDto(await loadTerminal(deps, actor, id));
}

/** Deactivating a terminal unpairs it: its device token stops working at once (RF-A12). */
export async function updateTerminal(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
  input: z.output<typeof updateTerminalSchema>,
): Promise<TerminalDto> {
  assertPermission(actor, 'location.manage');
  const current = await loadTerminal(deps, actor, id);
  if (current.type === 'phone' && input.type !== undefined) {
    throw new ApiError('CONFLICT', 'A waiter phone stays a phone (DEC-036)', { field: 'type' });
  }
  await assertTerminalRefs(deps, actor, input);
  const patch: Partial<TerminalRow> = definedOnly(input);
  if (input.isActive === false && current.isActive) {
    Object.assign(patch, {
      deactivatedAt: new Date(),
      deviceTokenHash: null,
      pairingCodeHash: null,
      pairingExpiresAt: null,
    });
  } else if (input.isActive === true && !current.isActive) {
    patch.deactivatedAt = null;
  }
  await runCommand(deps.db, actor, async (tx, recorder) => {
    await tx
      .update(s.terminals)
      .set(patch)
      .where(inLocation(s.terminals, actor, eq(s.terminals.id, id)));
    const diff = changedFields(current as unknown as Record<string, unknown>, definedOnly(input));
    if (Object.keys(diff.after).length > 0) {
      recorder.audit({ action: 'terminal.changed', entityType: 'terminal', entityId: id, ...diff });
    }
  }).catch(prefixTaken);
  return toTerminalDto(await loadTerminal(deps, actor, id));
}

/**
 * One-time pairing code for the device (RF-A06), shown once in the backoffice and valid 15
 * minutes. Only its SHA-256 is stored; a new code replaces the previous one.
 */
export async function issuePairingCode(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
): Promise<{ code: string; expiresAt: string }> {
  assertPermission(actor, 'location.manage');
  const terminal = await loadTerminal(deps, actor, id);
  if (!terminal.isActive)
    throw new ApiError('CONFLICT', 'Reactivate the terminal before pairing it');
  if (terminal.type === 'phone') {
    throw new ApiError(
      'CONFLICT',
      'A waiter phone pairs with a phone code and the waiter PIN (DEC-036)',
    );
  }
  if (terminal.deviceTokenHash !== null && TAKEN_OVER_ONLY_WHEN_FREE.has(terminal.type)) {
    throw alreadyPaired(terminal.name);
  }
  const code = pairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MINUTES * 60_000);
  await runCommand(deps.db, { ...actor, terminalId: id }, async (tx, recorder) => {
    await tx
      .update(s.terminals)
      .set({ pairingCodeHash: sha256Hex(normalizePairingCode(code)), pairingExpiresAt: expiresAt })
      .where(inLocation(s.terminals, actor, eq(s.terminals.id, id)));
    recorder.audit({
      action: 'terminal.pairing_code_issued',
      entityType: 'terminal',
      entityId: id,
      after: { expiresAt: expiresAt.toISOString() },
    });
  });
  return { code, expiresAt: expiresAt.toISOString() };
}

/**
 * "Unpair" in the backoffice: the device token stops working at once, but the terminal stays
 * active, ready for a new pairing (DEC-036: a waiter who forgot to sign out of their phone).
 */
export async function unpairTerminal(
  deps: ServiceDeps,
  actor: Actor,
  id: string,
): Promise<TerminalDto> {
  assertPermission(actor, 'location.manage');
  const current = await loadTerminal(deps, actor, id);
  if (current.deviceTokenHash !== null) {
    await runCommand(deps.db, { ...actor, terminalId: id }, async (tx, recorder) => {
      await tx
        .update(s.terminals)
        .set({ deviceTokenHash: null })
        .where(inLocation(s.terminals, actor, eq(s.terminals.id, id)));
      recorder.audit({
        action: 'terminal.unpaired',
        entityType: 'terminal',
        entityId: id,
        after: { userId: current.userId },
      });
    });
  }
  return toTerminalDto(await loadTerminal(deps, actor, id));
}

export const unknownCode = () =>
  new ApiError('UNAUTHENTICATED', 'The pairing code is invalid or expired');

/**
 * A POS, handheld or kitchen display already paired on a device is not taken over by another one
 * (DEC-041): it is unpaired first, on the device itself or in the backoffice. The hub is set up
 * by an admin and a reinstall pairs it again; a waiter's phone follows DEC-036.
 */
const TAKEN_OVER_ONLY_WHEN_FREE: ReadonlySet<string> = new Set(['pos', 'handheld', 'kds']);

const alreadyPaired = (name: string) =>
  new ApiError('CONFLICT', 'This terminal is already paired on another device', {
    reason: 'already_paired',
    name,
  });

/**
 * Pairs a device with the code from the backoffice (anonymous call: the code is the credential).
 * Returns the device token ONCE; the terminal sends it as `X-Terminal-Token` from now on and
 * remembers its location (RF-A06). A terminal still paired on another device refuses the code
 * (DEC-041). A code for a waiter's phone also needs the waiter's PIN (DEC-036, `pairPhone`).
 */
export async function pairTerminal(
  deps: ServiceDeps,
  input: z.output<typeof pairTerminalSchema>,
  requestId: string | null,
) {
  const codeHash = sha256Hex(normalizePairingCode(input.code));
  const [terminal] = await deps.db
    .select()
    .from(s.terminals)
    .where(and(eq(s.terminals.pairingCodeHash, codeHash), notDeleted(s.terminals)));
  if (!terminal) {
    const phoneCode = await findPhoneCode(deps, codeHash);
    if (phoneCode) return pairPhone(deps, phoneCode, input, requestId);
    throw unknownCode();
  }
  if (!terminal.isActive || !terminal.pairingExpiresAt || terminal.pairingExpiresAt <= new Date()) {
    throw unknownCode();
  }
  if (terminal.deviceTokenHash !== null && TAKEN_OVER_ONLY_WHEN_FREE.has(terminal.type)) {
    throw alreadyPaired(terminal.name);
  }
  const tenant = { organizationId: terminal.organizationId, locationId: terminal.locationId };
  const [location] = await deps.db
    .select()
    .from(s.locations)
    .where(
      inOrg(s.locations, tenant, eq(s.locations.id, terminal.locationId), notDeleted(s.locations)),
    );
  if (!location) throw unknownCode();

  const deviceToken = randomToken(32);
  const now = new Date();
  await runCommand(
    deps.db,
    { ...tenant, terminalId: terminal.id, requestId },
    async (tx, recorder) => {
      // Conditional on the code: of two devices racing with the same code, only one wins.
      const [result] = await tx
        .update(s.terminals)
        .set({
          deviceTokenHash: sha256Hex(deviceToken),
          pairingCodeHash: null,
          pairingExpiresAt: null,
          pairedAt: now,
          lastSeenAt: now,
          appVersion: input.appVersion ?? terminal.appVersion,
        })
        .where(
          inLocation(
            s.terminals,
            tenant,
            eq(s.terminals.id, terminal.id),
            eq(s.terminals.pairingCodeHash, codeHash),
          ),
        );
      if (result.affectedRows !== 1) throw unknownCode();
      recorder.audit({
        action: 'terminal.paired',
        entityType: 'terminal',
        entityId: terminal.id,
        after: { appVersion: input.appVersion ?? null },
      });
    },
  );

  const [paired] = await deps.db
    .select()
    .from(s.terminals)
    .where(inLocation(s.terminals, tenant, eq(s.terminals.id, terminal.id)));
  return toPairedDto(deviceToken, paired!, location);
}

/** What a freshly paired device receives, once: its token, its terminal and its location. */
export const toPairedDto = (
  deviceToken: string,
  terminal: TerminalRow,
  location: typeof s.locations.$inferSelect,
) => ({
  deviceToken,
  terminal: toTerminalDto(terminal),
  location: {
    id: location.id,
    name: location.name,
    timezone: location.timezone,
    defaultLanguage: location.defaultLanguage,
    kitchenLanguage: location.kitchenLanguage,
  },
  organizationId: terminal.organizationId,
});
