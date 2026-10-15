import { z } from 'zod';

/**
 * What the location hub reports about its printers (DEC-032, RF-F17): whether the last job or
 * test page printed and, if not, why. The cloud keeps it apart from the configuration.
 */
export const printerStatusReportSchema = z.object({
  printers: z
    .array(
      z.object({
        printerId: z.uuid(),
        ok: z.boolean(),
        error: z.string().trim().max(255).nullable(),
        at: z.iso.datetime({ offset: true }),
        /** The report is the result of a test page requested from the backoffice. */
        test: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(50),
});
export type PrinterStatusReport = z.infer<typeof printerStatusReportSchema>;

/** Who is at the kitchen displays of the LAN, from the hub to the cloud (DEC-033). */
export const presenceReportSchema = z.object({
  entries: z
    .array(
      z.object({
        terminalId: z.uuid(),
        unlocked: z.boolean(),
        userId: z.uuid().nullable(),
        /** The station a display chose at sign-in (DEC-042). Absent from an older hub. */
        stationId: z.uuid().nullable().default(null),
        lastSeenAt: z.iso.datetime({ offset: true }),
      }),
    )
    .max(100),
});
export type PresenceReport = z.infer<typeof presenceReportSchema>;
