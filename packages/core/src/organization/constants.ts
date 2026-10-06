/** Tipos de terminal de una sede (RF-A03). */
export const TERMINAL_TYPES = ['pos', 'handheld', 'kds'] as const;
export type TerminalType = (typeof TERMINAL_TYPES)[number];

/** Uso y protocolo de las impresoras de red (RF-F17). */
export const PRINTER_KINDS = ['receipt', 'kitchen'] as const;
export type PrinterKind = (typeof PRINTER_KINDS)[number];

export const PRINTER_PROTOCOLS = ['escpos', 'epson_epos', 'star_cloudprnt'] as const;
export type PrinterProtocol = (typeof PRINTER_PROTOCOLS)[number];
