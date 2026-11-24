import { Toaster } from '@pos/ui/toaster';
import type { Metadata, Viewport } from 'next';
import { Chakra_Petch, Cormorant_Garamond, Inter, Manrope } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { SiteUpdateBanner } from '@/device/ui/update-banner';
import './globals.css';
import { THEME_SCRIPT } from '@/components/theme/theme';

// The brand's typefaces (DEC-049), served with the build, so the POS has them offline too.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const chakra = Chakra_Petch({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-chakra',
  display: 'swap',
});
// A restaurant's brand may use the editorial pair (DEC-058). Not preloaded: the files are fetched
// only where a brand uses them, and they are in the build, so they work offline too.
const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-cormorant',
  display: 'swap',
  preload: false,
});
const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
  display: 'swap',
  preload: false,
});

export const metadata: Metadata = {
  title: { default: 'Zitas POS', template: '%s · Zitas POS' },
  description:
    'Core POS für Restaurants in der Schweiz: Tisch, Bestellung, Küche, Zahlung, Abschluss.',
  applicationName: 'Zitas POS',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // No zoom on floor tablets; touch targets already measure ≥ 44 px (RNF-22).
  maximumScale: 1,
  userScalable: false,
};

/** The UI language is the user's own (RF-A08), resolved in src/i18n/request.ts. */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      className={`${inter.variable} ${chakra.variable} ${cormorant.variable} ${manrope.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Light or dark before the first paint (DEC-049). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <NextIntlClientProvider>
          <SiteUpdateBanner />
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
