import type { Metadata } from 'next';
import { PosApp } from '@/pos/ui/pos-app';

export const metadata: Metadata = { title: 'Kasse' };

/**
 * The POS (RF-C, RF-D). Always answers 200 without redirects or server data, so the service
 * worker can precache it and open it without network (docs/SYNC.md §13).
 */
export default function PosPage() {
  return <PosApp />;
}
