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
  // No zoom on floor tablets; touch targets already measure ≥ 44 px (RNF-22).
  maximumScale: 1,
  userScalable: false,
};

// The actual per-user and per-customer language arrives with next-intl in Phase 1 (RF-A08).
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
