/**
 * Terminal types of a location (RF-A03). `hub` is the LAN hub of the location, paired like a
 * terminal (docs/SYNC.md §11.2). `phone` is a waiter's own phone (DEC-036): never created by hand,
 * it appears the first time the waiter pairs a phone and belongs to that waiter.
 */
export const TERMINAL_TYPES = ['pos', 'handheld', 'kds', 'hub', 'phone'] as const;
export type TerminalType = (typeof TERMINAL_TYPES)[number];

/** The types the backoffice creates by hand: a waiter's phone appears by pairing (DEC-036). */
export const CREATABLE_TERMINAL_TYPES = ['pos', 'handheld', 'kds', 'hub'] as const;

/** Purpose and protocol of network printers (RF-F17). */
export const PRINTER_KINDS = ['receipt', 'kitchen'] as const;
export type PrinterKind = (typeof PRINTER_KINDS)[number];

export const PRINTER_PROTOCOLS = ['escpos', 'epson_epos', 'star_cloudprnt'] as const;
export type PrinterProtocol = (typeof PRINTER_PROTOCOLS)[number];
