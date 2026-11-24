import { cn } from '@pos/ui/utils';

export interface BrandLogos {
  light: string | null;
  dark: string | null;
}

export const hasBrandLogo = (logo: BrandLogos | null | undefined): logo is BrandLogos =>
  !!(logo && (logo.light || logo.dark));

/**
 * The restaurant's own logo (DEC-058): the version for light surfaces and the one for dark ones,
 * switched with the theme. Data URLs from the brand, so it shows offline too. The height comes
 * from `className`; the width follows the image.
 */
export function BrandLogo({
  logo,
  name,
  className,
}: {
  logo: BrandLogos;
  name: string;
  className?: string;
}) {
  const light = logo.light ?? logo.dark;
  const dark = logo.dark ?? logo.light;
  if (!light || !dark) return null;
  return (
    <span className={cn('inline-flex h-10 items-center', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing to optimise */}
      <img src={light} alt={name} className="h-full w-auto max-w-full object-contain dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing to optimise */}
      <img
        src={dark}
        alt={name}
        className="hidden h-full w-auto max-w-full object-contain dark:block"
      />
    </span>
  );
}
