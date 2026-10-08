import { describe, expect, it } from 'vitest';
import { decodeEscPos, decodeText, encodeEscPos, encodeText } from './escpos';

describe('ESC/POS encoding (DEC-031)', () => {
  it('writes the special characters of DE, FR and IT in code page 858', () => {
    expect(encodeText('Rösti à la crème, Spätzle, città, 5 €')).toEqual([
      ...Buffer.from('R'),
      0x94,
      ...Buffer.from('sti '),
      0x85,
      ...Buffer.from(' la cr'),
      0x8a,
      ...Buffer.from('me, Sp'),
      0x84,
      ...Buffer.from('tzle, citt'),
      0x85,
      ...Buffer.from(', 5 '),
      0xd5,
    ]);
    const all = 'ÄÖÜäöüß éèêàâçëïîôûù ÉÈÀÇ €';
    expect(decodeText(encodeText(all))).toBe(all);
  });

  it('writes characters outside the code page the way a person would', () => {
    expect(decodeText(encodeText('Œufs “bio” – fresh…'))).toBe('OEufs "bio" - fresh...');
    // "á" exists in the code page; "ř" and "ő" lose their accent.
    expect(decodeText(encodeText('Dvořák ő'))).toBe('Dvorák o');
  });

  it('encodes styles, cut and drawer; the test printer reads them back', () => {
    const bytes = encodeEscPos({
      lines: [
        { text: 'KÜCHE', bold: true, align: 'center' },
        { text: 'Tisch 5', bold: true, size: 'large' },
        { text: '2x Rösti', size: 'tall' },
        { text: '   + Spiegelei' },
      ],
      cut: true,
      openDrawer: true,
    });
    // Initialise and select PC858 first.
    expect([...bytes.subarray(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
    // Double width and height for the table.
    expect(bytes.includes(Buffer.from([0x1d, 0x21, 0x11]))).toBe(true);
    expect(decodeEscPos(bytes)).toEqual({
      lines: ['KÜCHE', 'Tisch 5', '2x Rösti', '   + Spiegelei'],
      emphasized: ['KÜCHE', 'Tisch 5', '2x Rösti'],
      cuts: 1,
      drawerKicks: 1,
    });
  });

  it('a drawer kick alone prints nothing and does not cut', () => {
    const job = decodeEscPos(encodeEscPos({ lines: [], cut: false, openDrawer: true }));
    expect(job).toEqual({ lines: [], emphasized: [], cuts: 0, drawerKicks: 1 });
  });
});
