/** Terminal types of a location (RF-A03). */
/** `hub` is the LAN hub of the location, paired like a terminal (docs/SYNC.md §11.2). */
export const TERMINAL_TYPES = ['pos', 'handheld', 'kds', 'hub'] as const;
export type TerminalType = (typeof TERMINAL_TYPES)[number];

/** Purpose and protocol of network printers (RF-F17). */
export const PRINTER_KINDS = ['receipt', 'kitchen'] as const;
export type PrinterKind = (typeof PRINTER_KINDS)[number];

export const PRINTER_PROTOCOLS = ['escpos', 'epson_epos', 'star_cloudprnt'] as const;
export type PrinterProtocol = (typeof PRINTER_PROTOCOLS)[number];
