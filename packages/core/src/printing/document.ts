import type { ReceiptContent } from '../receipts/content';
import { renderReceiptText } from '../receipts/render';

/**
 * A printed document independent of the printer protocol (DEC-031): lines of text with a few
 * styles. The hub encodes it for the printer (ESC/POS in Phase 3); the layout lives here so the
 * same document can be tested and shown on screen.
 */

export type PrintSize = 'normal' | 'tall' | 'large';

export interface PrintLine {
  text: string;
  bold?: boolean;
  /** `tall` doubles the height; `large` doubles height and width (half the columns). */
  size?: PrintSize;
  align?: 'left' | 'center' | 'right';
}

export interface PrintDocument {
  lines: PrintLine[];
  /** Feed and cut the paper at the end. */
  cut: boolean;
  /** Kick the cash drawer connected to the printer (RF-D18). */
  openDrawer: boolean;
}

/** Characters per line at the normal size: Font A on 80 mm and 58 mm paper. */
export const PAPER_COLUMNS: Readonly<Record<58 | 80, number>> = { 80: 48, 58: 32 };

export function columnsFor(paperWidthMm: number): number {
  return paperWidthMm <= 58 ? PAPER_COLUMNS[58] : PAPER_COLUMNS[80];
}

/** Columns available to a line of this size. */
export function columnsAt(width: number, size: PrintSize = 'normal'): number {
  return size === 'large' ? Math.floor(width / 2) : width;
}

/** Word wrap; a word longer than the line is cut. Keeps empty paragraphs as empty lines. */
export function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter((w) => w !== '')) {
      let rest = word;
      while (rest.length > width) {
        if (line !== '') {
          out.push(line);
          line = '';
        }
        out.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      if (line === '') line = rest;
      else if (line.length + 1 + rest.length <= width) line = `${line} ${rest}`;
      else {
        out.push(line);
        line = rest;
      }
    }
    out.push(line);
  }
  return out;
}

/** Same text wrapped at the columns of its size, one print line per wrapped line. */
export function wrapped(
  text: string,
  width: number,
  style: Omit<PrintLine, 'text'> = {},
  indent = '',
): PrintLine[] {
  const columns = columnsAt(width, style.size) - indent.length;
  return wrapText(text, Math.max(columns, 1)).map((line, index) => ({
    ...style,
    text: index === 0 ? `${indent}${line}` : `${' '.repeat(indent.length)}${line}`,
  }));
}

export const rule = (width: number, char = '-'): PrintLine => ({ text: char.repeat(width) });

/** The frozen receipt as printed (DEC-024, DEC-031): the same lines the screen shows. */
export function receiptDocument(
  content: ReceiptContent,
  options: { width: number; copyAt?: string; openDrawer?: boolean },
): PrintDocument {
  const lines = renderReceiptText(content, { width: options.width, copyAt: options.copyAt });
  return {
    lines: lines.map((text) => ({ text })),
    cut: true,
    openDrawer: options.openDrawer ?? false,
  };
}

/** Only the drawer kick (cash payment or "open drawer"), nothing printed. */
export function drawerDocument(): PrintDocument {
  return { lines: [], cut: false, openDrawer: true };
}
