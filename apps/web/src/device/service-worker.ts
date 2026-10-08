/**
 * Registers the POS service worker (docs/SYNC.md §13). A new version never takes over by
 * itself: the POS calls `activateWaitingWorker()` when it is idle (not in the middle of a
 * payment) and then reloads.
 */
export async function registerPosWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    // No worker in development (Serwist is disabled there) or on insecure origins.
    return null;
  }
}

/** True when a newer version of the POS is installed and waiting. */
export function hasWaitingWorker(registration: ServiceWorkerRegistration | null): boolean {
  return Boolean(registration?.waiting);
}

/** Lets the waiting worker take over; the page reloads when the new one controls it. */
export function activateWaitingWorker(registration: ServiceWorkerRegistration): void {
  const waiting = registration.waiting;
  if (!waiting) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
    once: true,
  });
  waiting.postMessage({ type: 'SKIP_WAITING' });
}
