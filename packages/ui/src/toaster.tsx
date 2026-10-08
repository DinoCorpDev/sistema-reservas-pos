'use client';

import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { type ExternalToast, Toaster as Sonner, toast as sonnerToast } from 'sonner';

/**
 * Toast notifications (sonner), placed where a thumb does not cover them on tablets. A tap
 * anywhere on a toast closes it (no small close button to aim at). Sonner has no such option, so
 * every toast carries its id in its content and the toaster reads it back on the tap.
 */
export function Toaster() {
  return (
    <div onClick={dismissTapped} onKeyDown={dismissTapped}>
      <Sonner
        position="top-center"
        richColors
        toastOptions={{ className: 'text-base cursor-pointer select-none' }}
      />
    </div>
  );
}

function dismissTapped(event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) {
  if ('key' in event && event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target as HTMLElement;
  // A button inside a toast (an action) does its own thing.
  if (target.closest('button, a')) return;
  const item = target.closest('[data-sonner-toast]');
  const id = item?.querySelector<HTMLElement>('[data-toast-id]')?.dataset.toastId;
  if (id) sonnerToast.dismiss(id);
}

type Message = ReactNode | (() => ReactNode);

let counter = 0;

/** Gives the toast an id and puts it in the content, where `dismissTapped` finds it. */
function tagged(message: Message, data?: ExternalToast): [ReactNode, ExternalToast] {
  const id = data?.id === undefined ? `toast-${++counter}` : String(data.id);
  const content = typeof message === 'function' ? message() : message;
  return [<span data-toast-id={id}>{content}</span>, { ...data, id }];
}

export const toast = Object.assign(
  (message: Message, data?: ExternalToast) => sonnerToast(...tagged(message, data)),
  {
    success: (message: Message, data?: ExternalToast) =>
      sonnerToast.success(...tagged(message, data)),
    error: (message: Message, data?: ExternalToast) => sonnerToast.error(...tagged(message, data)),
    info: (message: Message, data?: ExternalToast) => sonnerToast.info(...tagged(message, data)),
    warning: (message: Message, data?: ExternalToast) =>
      sonnerToast.warning(...tagged(message, data)),
    dismiss: sonnerToast.dismiss,
  },
);
