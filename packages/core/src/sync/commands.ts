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
