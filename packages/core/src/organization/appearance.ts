import { z } from 'zod';

/**
 * The restaurant's own look (DEC-058): four colours, a font pair and its logo, applied to its
 * backoffice, tills and kitchen screens. Without one, Zitas looks as always. Everything that
 * reaches a stylesheet is validated here (hex colours, a closed list of fonts), so the CSS built
 * from it cannot carry anything else.
 */

export const APPEARANCE_FONTS = ['zitas', 'editorial'] as const;
export type AppearanceFonts = (typeof APPEARANCE_FONTS)[number];

/** A logo is stored as a data URL (no file storage yet, DEC-045): small and of an image type. */
export const LOGO_MEDIA_TYPES = ['image/png', 'image/webp', 'image/jpeg', 'image/svg+xml'] as const;
export const MAX_LOGO_DATA_URL_LENGTH = 200_000;
const LOGO_DATA_URL = /^data:image\/(png|webp|jpeg|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'A colour like #C8A76A')
  .transform((value) => value.toLowerCase());

const logo = z.string().max(MAX_LOGO_DATA_URL_LENGTH).regex(LOGO_DATA_URL, 'An image data URL');

export const appearanceSchema = z.object({
  /** Buttons and highlights, accents in text, the dark surfaces, the page background. */
  colors: z
    .object({ primary: hexColor, accent: hexColor, chrome: hexColor, background: hexColor })
    .nullable()
    .default(null),
  /** `editorial`: Cormorant Garamond for titles and numbers, Manrope for the interface. */
  fonts: z.enum(APPEARANCE_FONTS).default('zitas'),
  /** For light surfaces and for dark ones (the dark one falls back to the light one). */
  logo: z
    .object({ light: logo.nullable().default(null), dark: logo.nullable().default(null) })
    .prefault({}),
});

export type Appearance = z.output<typeof appearanceSchema>;
export type AppearanceInput = z.input<typeof appearanceSchema>;

export const DEFAULT_APPEARANCE: Appearance = appearanceSchema.parse({});

/** What is stored, read leniently: anything that no longer validates is Zitas. */
export function parseAppearance(input: unknown): Appearance {
  const parsed = appearanceSchema.safeParse(input ?? {});
  return parsed.success ? parsed.data : DEFAULT_APPEARANCE;
}

export function isZitasAppearance(appearance: Appearance): boolean {
  return (
    appearance.colors === null &&
    appearance.fonts === 'zitas' &&
    appearance.logo.light === null &&
    appearance.logo.dark === null
  );
}

// ── Colour arithmetic (sRGB, WCAG 2.x contrast) ─────────────────────────────

type Rgb = readonly [number, number, number];

const toRgb = (hex: string): Rgb => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

const toHex = (rgb: Rgb): string =>
  `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;

/** `amount` of `b` into `a` (0 = a, 1 = b). */
export function mixColors(a: string, b: string, amount: number): string {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex([0, 1, 2].map((i) => x[i]! + (y[i]! - x[i]!) * amount) as unknown as Rgb);
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The brand's own colour when it reads well enough on `background`, white or near-white if not. */
function preferOn(background: string, preferred: string, ratio: number, fallback: string): string {
  return contrastRatio(preferred, background) >= ratio ? preferred : fallback;
}

/** Of the candidates, the most readable on `background`. */
function mostReadable(background: string, candidates: string[]): string {
  return candidates.reduce((best, next) =>
    contrastRatio(next, background) > contrastRatio(best, background) ? next : best,
  );
}

/**
 * `color` moved towards black or white (whichever the background is not) until it reaches
 * `ratio` on `background`: the colour stays recognisable but becomes readable as text.
 */
export function readableOn(color: string, background: string, ratio: number): string {
  const towards = luminance(background) > 0.18 ? '#000000' : '#ffffff';
  for (let step = 0; step <= 20; step += 1) {
    const candidate = mixColors(color, towards, step / 20);
    if (contrastRatio(candidate, background) >= ratio) return candidate;
  }
  return towards;
}

const alpha = (hex: string, percent: number) => `color-mix(in srgb, ${hex} ${percent}%, transparent)`;

// ── Tokens and stylesheet ───────────────────────────────────────────────────

export interface AppearanceTokens {
  light: Record<string, string>;
  dark: Record<string, string>;
}

/**
 * The design tokens (packages/ui globals.css) a brand replaces, for light and dark. Derived values
 * keep the contrast the interface needs: text on buttons, accents used as text, muted text.
 */
export function appearanceTokens(appearance: Appearance): AppearanceTokens | null {
  if (!appearance.colors) return null;
  const { primary, accent, chrome, background } = appearance.colors;

  // Light: the brand's background, cards a step lighter, text in its dark colour.
  const ink = readableOn(chrome, background, 7);
  const card = mixColors(background, '#ffffff', 0.65);
  const onPrimary = mostReadable(primary, [ink, '#ffffff']);
  const light: Record<string, string> = {
    '--background': background,
    '--foreground': ink,
    '--card': card,
    '--card-foreground': ink,
    '--primary': primary,
    '--primary-foreground': onPrimary,
    '--secondary': mixColors(background, ink, 0.07),
    '--secondary-foreground': ink,
    '--muted': mixColors(background, ink, 0.045),
    '--muted-foreground': readableOn(mixColors(ink, background, 0.42), background, 4.6),
    '--accent': mixColors(background, primary, 0.2),
    '--accent-foreground': ink,
    '--border': alpha(ink, 11),
    '--input': mixColors(background, ink, 0.18),
    '--ring': primary,
    '--brand': primary,
    '--brand-strong': readableOn(accent, card, 4.6),
    '--brand-foreground': onPrimary,
    '--brand-soft': mixColors(card, primary, 0.22),
    '--chrome': chrome,
    '--chrome-foreground': preferOn(chrome, background, 12, '#ffffff'),
    '--surface-2': mixColors(background, card, 0.45),
  };

  // Dark: the dark colour as the base, warmed by the background, accents in the primary colour.
  const base = luminance(chrome) < 0.03 ? chrome : readableOn(chrome, '#ffffff', 15);
  const darkBackground = mixColors(base, background, 0.04);
  const darkCard = mixColors(base, background, 0.085);
  const paper = preferOn(darkBackground, background, 12, '#f6f8fa');
  const onPrimaryDark = mostReadable(primary, [base, '#ffffff']);
  const dark: Record<string, string> = {
    '--background': darkBackground,
    '--foreground': paper,
    '--card': darkCard,
    '--card-foreground': paper,
    '--primary': primary,
    '--primary-foreground': onPrimaryDark,
    '--secondary': mixColors(base, background, 0.13),
    '--secondary-foreground': paper,
    '--muted': mixColors(base, background, 0.1),
    '--muted-foreground': readableOn(mixColors(paper, base, 0.38), darkBackground, 4.6),
    '--accent': mixColors(base, primary, 0.2),
    '--accent-foreground': paper,
    '--border': alpha(paper, 11),
    '--input': alpha(paper, 17),
    '--ring': primary,
    '--brand': primary,
    '--brand-strong': readableOn(primary, darkCard, 4.6),
    '--brand-foreground': onPrimaryDark,
    '--brand-soft': mixColors(base, primary, 0.18),
    '--chrome': mixColors(base, '#000000', 0.35),
    '--chrome-foreground': paper,
    '--surface-2': mixColors(base, background, 0.065),
  };
  return { light, dark };
}

const FONT_STACKS: Record<AppearanceFonts, { display: string; ui: string } | null> = {
  zitas: null,
  editorial: {
    display: 'var(--font-cormorant), Georgia, "Times New Roman", serif',
    ui: 'var(--font-manrope), ui-sans-serif, system-ui, sans-serif',
  },
};

/** The font variables of a pair (globals.css reads --font-display and --font-ui), null for Zitas. */
export function appearanceFontVars(fonts: AppearanceFonts): Record<string, string> | null {
  const stacks = FONT_STACKS[fonts];
  return stacks ? { '--font-display': stacks.display, '--font-ui': stacks.ui } : null;
}

const block = (selector: string, vars: Record<string, string>) =>
  `${selector}{${Object.entries(vars)
    .map(([name, value]) => `${name}:${value}`)
    .join(';')}}`;

/**
 * The stylesheet of a brand, '' for Zitas. The selectors outrank the defaults of globals.css
 * wherever the sheet is placed (`:root:root` over `:root`, `.dark` over `.dark`).
 */
export function appearanceCss(appearance: Appearance): string {
  const parts: string[] = [];
  const tokens = appearanceTokens(appearance);
  if (tokens) {
    parts.push(block(':root:root', tokens.light), block(':root:root.dark', tokens.dark));
  }
  const fonts = appearanceFontVars(appearance.fonts);
  if (fonts) {
    parts.push(
      block(':root:root', fonts),
      // Old-style figures are elegant in a title and hard to read on a table or a ticket.
      '.font-brand{font-variant-numeric:lining-nums tabular-nums}',
    );
  }
  return parts.join('');
}
