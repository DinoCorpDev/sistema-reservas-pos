import type { PrintDocument, PrintLine } from '@pos/core';

/**
 * ESC/POS encoding of a print document (DEC-031): the command set Epson TM and Star printers in
 * ESC/POS mode understand over TCP 9100. Text goes out in code page 858 (850 with the euro sign),
 * which covers German, French and Italian. No library: the few commands needed are listed here.
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** ESC t 19 selects PC858 on Epson and compatible printers. */
const CODE_PAGE_858 = 19;

/** Upper half of code page 858, 0x80…0xFF. */
const CP858_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈ€ÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ';

const ENCODE = new Map<string, number>(
  [...CP858_HIGH].map((char, index) => [char, 0x80 + index] as const),
);
const DECODE = new Map<number, string>([...ENCODE.entries()].map(([char, byte]) => [byte, char]));

/** Characters outside the code page, written the way a person would. */
const FALLBACK: Record<string, string> = {
  Œ: 'OE',
  œ: 'oe',
  '‘': "'",
  '’': "'",
  '‚': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '–': '-',
  '—': '-',
  '…': '...',
  '•': '*',
};

export function encodeText(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text.normalize('NFC')) {
    const code = char.codePointAt(0)!;
    if (code >= 0x20 && code < 0x7f) {
      bytes.push(code);
      continue;
    }
    const mapped = ENCODE.get(char);
    if (mapped !== undefined) {
      bytes.push(mapped);
      continue;
    }
    const fallback =
      FALLBACK[char] ??
      // Strip the accent if the plain letter exists (ő → o); otherwise a question mark.
      char.normalize('NFD').replace(/\p{M}/gu, '');
    for (const plain of fallback) {
      const plainCode = plain.codePointAt(0)!;
      bytes.push(plainCode >= 0x20 && plainCode < 0x7f ? plainCode : (ENCODE.get(plain) ?? 0x3f));
    }
  }
  return bytes;
}

export function decodeText(bytes: readonly number[]): string {
  return bytes
    .map((byte) => (byte < 0x80 ? String.fromCharCode(byte) : (DECODE.get(byte) ?? '?')))
    .join('');
}

const SIZE: Record<NonNullable<PrintLine['size']>, number> = {
  normal: 0x00,
  tall: 0x01,
  large: 0x11,
};
const ALIGN: Record<NonNullable<PrintLine['align']>, number> = { left: 0, center: 1, right: 2 };

export function encodeEscPos(doc: PrintDocument): Buffer {
  const out: number[] = [ESC, 0x40, ESC, 0x74, CODE_PAGE_858];
  for (const line of doc.lines) {
    out.push(ESC, 0x61, ALIGN[line.align ?? 'left']);
    out.push(ESC, 0x45, line.bold ? 1 : 0);
    out.push(GS, 0x21, SIZE[line.size ?? 'normal']);
    out.push(...encodeText(line.text), LF);
  }
  if (doc.lines.length > 0) out.push(ESC, 0x61, 0, ESC, 0x45, 0, GS, 0x21, 0);
  if (doc.cut) out.push(GS, 0x56, 0x42, 0x03); // feed 3 lines and partial cut
  if (doc.openDrawer) out.push(ESC, 0x70, 0x00, 0x19, 0xfa); // pulse on pin 2, 50 ms / 500 ms
  return Buffer.from(out);
}

export interface DecodedJob {
  /** The printed text, one entry per line. */
  lines: string[];
  /** Lines printed in bold or larger (what the cook sees first). */
  emphasized: string[];
  cuts: number;
  drawerKicks: number;
}

/**
 * Reads back what an ESC/POS printer would print: the test printer of the hub and the tests use
 * it. It understands exactly the commands `encodeEscPos` writes.
 */
export function decodeEscPos(bytes: Uint8Array): DecodedJob {
  const job: DecodedJob = { lines: [], emphasized: [], cuts: 0, drawerKicks: 0 };
  let text: number[] = [];
  let bold = false;
  let size = 0;
  for (let i = 0; i < bytes.length;) {
    const byte = bytes[i]!;
    if (byte === ESC) {
      const command = bytes[i + 1];
      if (command === 0x40) i += 2;
      else if (command === 0x70) {
        job.drawerKicks += 1;
        i += 5;
      } else {
        if (command === 0x45) bold = bytes[i + 2] === 1;
        i += 3; // ESC t n, ESC a n, ESC E n, ESC d n
      }
      continue;
    }
    if (byte === GS) {
      const command = bytes[i + 1];
      if (command === 0x56) {
        job.cuts += 1;
        i += bytes[i + 2] === 0x41 || bytes[i + 2] === 0x42 ? 4 : 3;
      } else {
        if (command === 0x21) size = bytes[i + 2] ?? 0;
        i += 3;
      }
      continue;
    }
    if (byte === LF) {
      const line = decodeText(text);
      job.lines.push(line);
      if (bold || size !== 0) job.emphasized.push(line);
      text = [];
      i += 1;
      continue;
    }
    text.push(byte);
    i += 1;
  }
  return job;
}
