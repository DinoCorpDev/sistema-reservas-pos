import type { Metadata, Viewport } from 'next';
import { KdsApp } from '@/kds/ui/kds-app';

// Installable on the tablet's home screen (DEC-030, DEC-045): its own name, icon and color.
export const metadata: Metadata = {
  title: 'Küche',
  manifest: '/kds.webmanifest',
  appleWebApp: { capable: true, title: 'Küche', statusBarStyle: 'default' },
  icons: { apple: '/icons/kds-apple-180.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0b0f19',
};

/**
 * The kitchen display (RF-C20…RF-C28). Like the POS it always answers 200 without redirects or
 * server data, so the service worker can precache it and open it without network (DEC-030).
 */
export default function KdsPage() {
  return <KdsApp />;
}
