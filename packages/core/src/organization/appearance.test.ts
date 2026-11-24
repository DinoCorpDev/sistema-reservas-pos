import { describe, expect, it } from 'vitest';
import {
  appearanceCss,
  appearanceSchema,
  appearanceTokens,
  contrastRatio,
  DEFAULT_APPEARANCE,
  isZitasAppearance,
  MAX_LOGO_DATA_URL_LENGTH,
  parseAppearance,
  readableOn,
} from './appearance';

/** Lalín Tapas' brandbook: warm gold, terracotta, carbon black and soft ivory. */
const LALIN = appearanceSchema.parse({
  colors: { primary: '#C8A76A', accent: '#BD5A2E', chrome: '#0A0A0A', background: '#F5EFE6' },
  fonts: 'editorial',
});
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('the restaurant brand (DEC-058)', () => {
  it('is Zitas until a restaurant sets one: no tokens, no stylesheet', () => {
    expect(isZitasAppearance(DEFAULT_APPEARANCE)).toBe(true);
    expect(appearanceTokens(DEFAULT_APPEARANCE)).toBeNull();
    expect(appearanceCss(DEFAULT_APPEARANCE)).toBe('');
    expect(isZitasAppearance(LALIN)).toBe(false);
  });

  it('measures contrast like WCAG', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(readableOn('#c8a76a', '#ffffff', 4.5)).not.toBe('#c8a76a');
    expect(contrastRatio(readableOn('#c8a76a', '#ffffff', 4.5), '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps every text readable in light and dark', () => {
    const tokens = appearanceTokens(LALIN)!;
    for (const mode of [tokens.light, tokens.dark]) {
      const on = (fg: string, bg: string) => contrastRatio(mode[fg]!, mode[bg]!);
      expect(on('--foreground', '--background')).toBeGreaterThanOrEqual(7);
      expect(on('--card-foreground', '--card')).toBeGreaterThanOrEqual(7);
      expect(on('--primary-foreground', '--primary')).toBeGreaterThanOrEqual(4.5);
      expect(on('--brand-strong', '--card')).toBeGreaterThanOrEqual(4.5);
      expect(on('--muted-foreground', '--background')).toBeGreaterThanOrEqual(4.5);
      expect(on('--chrome-foreground', '--chrome')).toBeGreaterThanOrEqual(7);
    }
  });

  it('puts dark text on a light gold button and keeps the brand colours themselves', () => {
    const { light, dark } = appearanceTokens(LALIN)!;
    expect(light['--primary']).toBe('#c8a76a');
    expect(light['--background']).toBe('#f5efe6');
    expect(light['--chrome']).toBe('#0a0a0a');
    expect(light['--primary-foreground']).toBe('#0a0a0a');
    // Terracotta stays terracotta as accent text, only as dark as the contrast needs.
    expect(contrastRatio(light['--brand-strong']!, '#bd5a2e')).toBeLessThan(1.6);
    expect(dark['--brand']).toBe('#c8a76a');
  });

  it('writes a stylesheet that outranks the defaults and switches the fonts', () => {
    const css = appearanceCss(LALIN);
    expect(css).toContain(':root:root{--background:#f5efe6;');
    expect(css).toContain(':root:root.dark{');
    expect(css).toContain('--font-display:var(--font-cormorant)');
    expect(css).toContain('--font-ui:var(--font-manrope)');
    expect(css).toContain('.font-brand{font-variant-numeric:lining-nums tabular-nums}');
    // Only the fonts: no colour tokens.
    const fontsOnly = appearanceCss(appearanceSchema.parse({ fonts: 'editorial' }));
    expect(fontsOnly).not.toContain('--primary');
  });

  it('accepts only hex colours and small image data URLs', () => {
    expect(appearanceSchema.safeParse({ colors: { ...LALIN.colors, primary: 'red' } }).success).toBe(false);
    expect(
      appearanceSchema.safeParse({ colors: { ...LALIN.colors, accent: '#bd5a2e;}body{x:y' } }).success,
    ).toBe(false);
    expect(appearanceSchema.safeParse({ logo: { light: PNG } }).success).toBe(true);
    expect(appearanceSchema.safeParse({ logo: { light: 'https://example.com/logo.png' } }).success).toBe(false);
    expect(
      appearanceSchema.safeParse({ logo: { light: 'data:text/html;base64,PHNjcmlwdD4=' } }).success,
    ).toBe(false);
    const huge = `data:image/png;base64,${'A'.repeat(MAX_LOGO_DATA_URL_LENGTH)}`;
    expect(appearanceSchema.safeParse({ logo: { light: huge } }).success).toBe(false);
  });

  it('reads a stored brand leniently: what no longer validates is Zitas', () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance({ fonts: 'comic-sans' })).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance(LALIN)).toEqual(LALIN);
  });
});
