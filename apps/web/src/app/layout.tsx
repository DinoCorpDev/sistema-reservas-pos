import type { Metadata, Viewport } from 'next';
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
  // En tablets de sala no se hace zoom; los objetivos táctiles ya miden ≥ 44 px (RNF-22).
  maximumScale: 1,
  userScalable: false,
};

// El idioma real por usuario y por cliente llega con next-intl en la Fase 1 (RF-A08).
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
