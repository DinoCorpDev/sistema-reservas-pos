import type { Metadata, Viewport } from 'next';
import { PosApp } from '@/pos/ui/pos-app';

// Installable on the tablet's home screen (DEC-030, DEC-045): its own name, icon and color.
export const metadata: Metadata = {
  title: 'Kasse',
  manifest: '/pos.webmanifest',
  appleWebApp: { capable: true, title: 'Kasse', statusBarStyle: 'default' },
  icons: { apple: '/icons/pos-apple-180.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#2a4fa6',
};

/**
 * The POS (RF-C, RF-D). Always answers 200 without redirects or server data, so the service
 * worker can precache it and open it without network (docs/SYNC.md §13).
 */
export default function PosPage() {
  return <PosApp />;
}
