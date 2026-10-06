'use client';

import { Toaster as Sonner, toast } from 'sonner';

/** Toast notifications (sonner), placed where a thumb does not cover them on tablets. */
export function Toaster() {
  return <Sonner position="top-center" richColors closeButton toastOptions={{ className: 'text-base' }} />;
}

export { toast };
