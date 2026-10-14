/**
 * CSV for the fiduciary and spreadsheets (RF-D16, RF-F04, RF-F12): RFC 4180 quoting, `;` as the
 * separator and a UTF-8 BOM, which is what Excel expects in Switzerland. Amounts are written in
 * francs with two decimals and a point (`1234.50`), never as rappen or with thousands marks.
 */

export type CsvCell = string | number | boolean | null | undefined;

const BOM = String.fromCharCode(0xfeff);

function cell(value: CsvCell, separator: string): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // A leading = + - @ would run as a formula in a spreadsheet (CSV injection): quote it inert.
  const numeric = /^-?\d+(\.\d+)?$/.test(text);
  const guarded = !numeric && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /["\r\n]/.test(guarded) || guarded.includes(separator)
    ? `"${guarded.replace(/"/g, '""')}"`
    : guarded;
}

export function toCsv(
  header: readonly string[],
  rows: readonly (readonly CsvCell[])[],
  options: { separator?: string; bom?: boolean } = {},
): string {
  const separator = options.separator ?? ';';
  const lines = [header, ...rows].map((row) => row.map((v) => cell(v, separator)).join(separator));
  return `${options.bom === false ? '' : BOM}${lines.join('\r\n')}\r\n`;
}

/** Rappen as francs for a CSV: `-1250` → `-12.50`. */
export function csvFrancs(rappen: number): string {
  const sign = rappen < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(rappen));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
