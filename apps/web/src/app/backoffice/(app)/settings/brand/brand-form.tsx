'use client';

import {
  type Appearance,
  type AppearanceFonts,
  appearanceFontVars,
  appearanceSchema,
  appearanceTokens,
  contrastRatio,
  MAX_LOGO_DATA_URL_LENGTH,
} from '@pos/core';
import { Alert } from '@pos/ui/alert';
import { Button } from '@pos/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import { Input } from '@pos/ui/input';
import { Field, Label } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { Switch } from '@pos/ui/switch';
import { toast } from '@pos/ui/toaster';
import { cn } from '@pos/ui/utils';
import { ImageUpIcon, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type CSSProperties, useMemo, useRef, useState } from 'react';
import { BrandLogo, type BrandLogos } from '@/components/brand/brand-logo';
import { useServerAction } from '@/components/backoffice/use-server-action';
import { saveAppearance } from './actions';

type ColorKey = 'primary' | 'accent' | 'chrome' | 'background';
const COLOR_KEYS: ColorKey[] = ['primary', 'accent', 'chrome', 'background'];
/** Where a restaurant's own colours start: the Zitas palette (DEC-049). */
const ZITAS_COLORS: Record<ColorKey, string> = {
  primary: '#20b8bd',
  accent: '#0e7f83',
  chrome: '#0b0f19',
  background: '#f1f7f8',
};
const HEX = /^#[0-9a-fA-F]{6}$/;

/** A logo file as a small data URL: raster images scaled to 600 × 240 px, SVG as it is. */
async function logoDataUrl(file: File): Promise<string> {
  if (file.type === 'image/svg+xml') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 600 / bitmap.width, 240 / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const webp = canvas.toDataURL('image/webp', 0.92);
  // Browsers that cannot write WebP give PNG back.
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}

/** The restaurant's brand: colours, fonts and logo, with a live preview (DEC-058). */
export function BrandForm({ appearance, name }: { appearance: Appearance; name: string }) {
  const t = useTranslations('brand');
  const [ownColors, setOwnColors] = useState(appearance.colors !== null);
  const [colors, setColors] = useState<Record<ColorKey, string>>(appearance.colors ?? ZITAS_COLORS);
  const [fonts, setFonts] = useState<AppearanceFonts>(appearance.fonts);
  const [logo, setLogo] = useState<BrandLogos>(appearance.logo);
  const { run, pending } = useServerAction(saveAppearance, { successMessage: t('saved') });

  const valid = COLOR_KEYS.every((key) => HEX.test(colors[key]));
  const draft = useMemo<Appearance | null>(() => {
    const parsed = appearanceSchema.safeParse({ colors: ownColors ? colors : null, fonts, logo });
    return parsed.success ? parsed.data : null;
  }, [ownColors, colors, fonts, logo]);

  const warnings = [
    ownColors && valid && contrastRatio(colors.background, '#000000') < 12 ? t('warnBackground') : null,
    ownColors && valid && contrastRatio(colors.chrome, '#ffffff') < 7 ? t('warnChrome') : null,
  ].filter((warning): warning is string => warning !== null);

  const save = () => {
    if (draft) void run(draft);
  };
  const reset = () => {
    setOwnColors(false);
    setColors(ZITAS_COLORS);
    setFonts('zitas');
    setLogo({ light: null, dark: null });
    void run({});
  };

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('colors')}</CardTitle>
            <CardDescription>{t('ownColorsHint')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="flex items-center gap-3">
              <Switch
                id="brand-own-colors"
                checked={ownColors}
                onCheckedChange={setOwnColors}
                data-testid="brand-own-colors"
              />
              <Label htmlFor="brand-own-colors">{t('ownColors')}</Label>
            </div>
            {ownColors ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {COLOR_KEYS.map((key) => (
                  <Field
                    key={key}
                    label={t(key)}
                    hint={t(`${key}Hint`)}
                    htmlFor={`brand-${key}`}
                    error={HEX.test(colors[key]) ? undefined : '#RRGGBB'}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        aria-label={t(key)}
                        value={HEX.test(colors[key]) ? colors[key] : '#000000'}
                        onChange={(event) =>
                          setColors((current) => ({ ...current, [key]: event.target.value }))
                        }
                        className="size-11 shrink-0 cursor-pointer rounded-lg border bg-card p-1"
                      />
                      <Input
                        id={`brand-${key}`}
                        value={colors[key]}
                        maxLength={7}
                        spellCheck={false}
                        className="font-mono uppercase"
                        onChange={(event) =>
                          setColors((current) => ({ ...current, [key]: event.target.value.trim() }))
                        }
                      />
                    </div>
                  </Field>
                ))}
              </div>
            ) : null}
            {warnings.map((warning) => (
              <Alert key={warning} variant="warning">
                {warning}
              </Alert>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('fonts')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={fonts} onValueChange={(value) => setFonts(value as AppearanceFonts)}>
              <SelectTrigger aria-label={t('fonts')} data-testid="brand-fonts">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zitas">{t('fonts_zitas')}</SelectItem>
                <SelectItem value="editorial">{t('fonts_editorial')}</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('logo')}</CardTitle>
            <CardDescription>{t('logoHint')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <LogoSlot
              label={t('logoLight')}
              value={logo.light}
              surface={ownColors && HEX.test(colors.background) ? colors.background : '#ffffff'}
              testId="brand-logo-light"
              onChange={(light) => setLogo((current) => ({ ...current, light }))}
            />
            <LogoSlot
              label={t('logoDark')}
              value={logo.dark}
              surface={ownColors && HEX.test(colors.chrome) ? colors.chrome : ZITAS_COLORS.chrome}
              testId="brand-logo-dark"
              onChange={(dark) => setLogo((current) => ({ ...current, dark }))}
            />
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-3">
          <Button onClick={save} disabled={pending || !draft} data-testid="brand-save">
            {t('save')}
          </Button>
          <Button variant="outline" onClick={reset} disabled={pending}>
            {t('reset')}
          </Button>
        </div>
      </div>

      <section aria-label={t('preview')} className="grid gap-3 xl:sticky xl:top-20">
        <h2 className="eyebrow">{t('preview')}</h2>
        <Preview appearance={draft} name={name} mode="light" />
        <Preview appearance={draft} name={name} mode="dark" />
      </section>
    </div>
  );
}

function LogoSlot({
  label,
  value,
  surface,
  testId,
  onChange,
}: {
  label: string;
  value: string | null;
  surface: string;
  testId: string;
  onChange: (value: string | null) => void;
}) {
  const t = useTranslations('brand');
  const input = useRef<HTMLInputElement>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      const url = await logoDataUrl(file);
      if (url.length > MAX_LOGO_DATA_URL_LENGTH) {
        toast.error(t('logoTooBig'));
        return;
      }
      onChange(url);
    } catch {
      toast.error(t('logoUnreadable'));
    }
  };
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">{label}</span>
      <div
        className="flex h-28 items-center justify-center rounded-xl border p-3"
        style={{ background: surface }}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing to optimise
          <img src={value} alt={label} className="max-h-full max-w-full object-contain" />
        ) : (
          <span
            className="text-sm"
            style={{ color: contrastRatio(surface, '#000000') > 7 ? '#55606f' : '#c7ced8' }}
          >
            {t('noLogo')}
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => input.current?.click()}>
          <ImageUpIcon aria-hidden />
          {t('upload')}
        </Button>
        {value ? (
          <Button variant="ghost" onClick={() => onChange(null)} aria-label={`${t('remove')}: ${label}`}>
            <Trash2Icon aria-hidden />
            {t('remove')}
          </Button>
        ) : null}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/webp,image/jpeg,image/svg+xml"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        data-testid={testId}
        onChange={(event) => {
          void pick(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </div>
  );
}

/**
 * A small sample of the screens with the brand being edited: its tokens set on this box only, so
 * the page around it keeps the saved look until "save".
 */
function Preview({
  appearance,
  name,
  mode,
}: {
  appearance: Appearance | null;
  name: string;
  mode: 'light' | 'dark';
}) {
  const t = useTranslations('brand');
  const tokens = appearance ? appearanceTokens(appearance) : null;
  const fontVars = appearance ? appearanceFontVars(appearance.fonts) : null;
  const style = { ...(tokens?.[mode] ?? {}), ...(fontVars ?? {}) } as CSSProperties;
  const dark = mode === 'dark';
  return (
    <figure
      className={cn('overflow-hidden rounded-xl border bg-background font-sans text-foreground', dark && 'dark')}
      style={style}
      data-testid={`brand-preview-${mode}`}
    >
      <figcaption className="sr-only">{t(dark ? 'previewDark' : 'previewLight')}</figcaption>
      <div
        className={cn(
          'flex h-14 items-center gap-3 border-b px-4',
          dark ? 'bg-chrome text-chrome-foreground' : 'bg-card',
        )}
      >
        {appearance && (appearance.logo.light || appearance.logo.dark) ? (
          <BrandLogo logo={appearance.logo} name={name} className="h-9" />
        ) : (
          <span className="font-brand text-lg font-semibold">{name}</span>
        )}
      </div>
      <div className="grid gap-3 p-4">
        <div>
          <p className="eyebrow">{t('sampleSection')}</p>
          <p className="font-brand text-2xl font-semibold">{t('sampleTitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-[0_0_0_1px_var(--glow),0_10px_24px_-12px_var(--glow)]">
            {t('sampleSave')}
          </span>
          <span className="rounded-lg border bg-card px-3 py-2 text-sm">{t('sampleCancel')}</span>
          <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-strong">
            {t('sampleActive')}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {['4', '7', '12'].map((label, index) => (
            <div
              key={label}
              className={cn(
                'flex h-24 flex-col items-center justify-center rounded-xl border shadow-card',
                index === 1 ? 'border-primary bg-primary text-primary-foreground' : 'bg-card',
              )}
            >
              <span className="text-[0.65rem] uppercase opacity-70">{t('sampleTable')}</span>
              <span className="font-brand text-3xl leading-none font-semibold">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}
