'use client';

import {
  type DiscountState,
  discountsOf,
  type FoldState,
  itemsOf,
  type OrderItemState,
  type OrderState,
  paymentsOf,
} from '@pos/core';
import {
  type CSSProperties,
  type DependencyList,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { correctedNow } from '@/device/clock';
import { usePos } from '@/device/store';

/**
 * Derives data from the fold of the location's orders. The engine mutates the fold in place for
 * speed and bumps `foldVersion` on every change, so derived data is computed once per change
 * (RNF-06) and never kept as a local copy that could go stale.
 */
export function useFoldMemo<T>(derive: (fold: FoldState) => T, deps: DependencyList = []): T {
  const fold = usePos((state) => state.fold);
  const version = usePos((state) => state.foldVersion);
  // `version` marks in-place changes of `fold`; `deps` are the caller's inputs of `derive`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => derive(fold), [fold, version, ...deps]);
}

/** One order as the screens show it: shallow copies, so every change re-renders. */
export interface OrderData {
  order: OrderState;
  /** Every line, voided ones included, in the order they were added. */
  items: OrderItemState[];
  /** Active discounts (line and order). */
  discounts: DiscountState[];
  hasPayments: boolean;
}

export function useOrderData(orderId: string): OrderData | null {
  return useFoldMemo(
    (fold) => {
      const order = fold.orders.get(orderId);
      if (!order) return null;
      return {
        order: { ...order },
        items: itemsOf(fold, orderId).map((item) => ({ ...item })),
        discounts: discountsOf(fold, orderId)
          .filter((discount) => discount.removedAt === null)
          .map((discount) => ({ ...discount })),
        hasPayments: paymentsOf(fold, orderId).length > 0,
      };
    },
    [orderId],
  );
}

/** Open orders other than `exceptId`, for transfer and merge targets (RF-C13). */
export function useOpenOrders(exceptId?: string): OrderState[] {
  return useFoldMemo(
    (fold) =>
      [...fold.orders.values()]
        .filter((order) => order.status === 'open' && order.id !== exceptId)
        .map((order) => ({ ...order }))
        .sort((a, b) => a.openedAt.localeCompare(b.openedAt)),
    [exceptId],
  );
}

/** Corrected device time, refreshed every `intervalMs` (elapsed minutes, RF-C19). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(correctedNow);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(correctedNow()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Tables, areas and people of the location by id, from the offline configuration. */
export function useLookups() {
  const bootstrap = usePos((state) => state.bootstrap);
  return useMemo(
    () => ({
      tables: new Map((bootstrap?.tables ?? []).map((table) => [table.id, table])),
      areas: new Map((bootstrap?.areas ?? []).map((area) => [area.id, area])),
      users: new Map((bootstrap?.users ?? []).map((user) => [user.id, user])),
    }),
    [bootstrap],
  );
}

export type Lookups = ReturnType<typeof useLookups>;

/**
 * Makes an element fill the viewport from where it starts down to the bottom, so its panes scroll
 * on their own and the action bar stays in reach of the thumb.
 */
export function useViewportFill<T extends HTMLElement>() {
  const [element, ref] = useState<T | null>(null);
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => setTop(element.getBoundingClientRect().top + window.scrollY);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [element]);
  const style: CSSProperties | undefined =
    top === null ? undefined : { height: `calc(100dvh - ${Math.round(top)}px)` };
  return { ref, style };
}

/** Width of an element, kept up to date (the floor map scales to its container). */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}
