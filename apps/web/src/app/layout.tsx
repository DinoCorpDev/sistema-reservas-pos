import { Toaster } from '@pos/ui/toaster';
import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Sistema Reservas POS', template: '%s · Sistema Reservas POS' },
  description:
    'Core POS für Restaurants in der Schweiz: Tisch, Bestellung, Küche, Zahlung, Abschluss.',
  applicationName: 'Sistema Reservas POS',
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
    <html lang={locale}>
      <body className="min-h-dvh">
        <NextIntlClientProvider>
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
