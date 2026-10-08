import type { Metadata } from 'next';
import { KdsApp } from '@/kds/ui/kds-app';

export const metadata: Metadata = { title: 'Küche' };

/**
 * The kitchen display (RF-C20…RF-C28). Like the POS it always answers 200 without redirects or
 * server data, so the service worker can precache it and open it without network (DEC-030).
 */
export default function KdsPage() {
  return <KdsApp />;
}
