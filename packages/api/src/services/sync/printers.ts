import type { PrinterStatusReport } from '@pos/core';
import { schema as s } from '@pos/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { type Actor, requireTerminal } from '../../actor';
import { ApiError } from '../../errors';
import type { ServiceDeps } from '../shared';

/**
 * `POST /sync/printer-status` (DEC-032): the hub reports how its printers are doing, and the
 * result of the test pages requested from the backoffice (RF-F17). Kept in `printer_status`,
 * outside the configuration, so it never forces terminals to download it again.
 */
export async function reportPrinterStatus(
  deps: ServiceDeps,
  actor: Actor,
  input: PrinterStatusReport,
): Promise<{ updated: number }> {
  const { locationId } = requireTerminal(actor);
  if (actor.terminalType !== 'hub') {
    throw new ApiError('FORBIDDEN', 'Only the location hub reports printer status');
  }
  // Printers of another location are ignored, never written (RNF-12).
  const owned = await deps.db
    .select({ id: s.printers.id })
    .from(s.printers)
    .where(
      and(
        eq(s.printers.organizationId, actor.organizationId),
        eq(s.printers.locationId, locationId),
        isNull(s.printers.deletedAt),
        inArray(
          s.printers.id,
          input.printers.map((p) => p.printerId),
        ),
      ),
    );
  const ours = new Set(owned.map((p) => p.id));
  const now = new Date();
  let updated = 0;
  for (const report of input.printers) {
    if (!ours.has(report.printerId)) continue;
    const at = new Date(report.at);
    const fields = {
      ...(report.ok ? { lastOkAt: at } : { lastError: report.error ?? 'error', lastErrorAt: at }),
      ...(report.test ? { lastTestAt: at, lastTestOk: report.ok } : {}),
      reportedAt: now,
    };
    await deps.db
      .insert(s.printerStatus)
      .values({
        id: report.printerId,
        organizationId: actor.organizationId,
        locationId,
        ...fields,
      })
      .onDuplicateKeyUpdate({ set: fields });
    updated += 1;
  }
  return { updated };
}
