'use client';

import { cn } from '@pos/ui/utils';
import {
  type CSSProperties,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * The dining room drawn as a room (DEC-057): a wooden floor laid back in perspective, square
 * tables with their edge, shadow and chairs. Light on purpose, so a phone runs it: ONE plane is
 * tilted and everything on it is flat 2D (no 3D layer per table); depth comes from box-shadows.
 * `plan` is the same room seen from above. The POS and the plan editor share it.
 */

export type RoomView = 'plan' | '3d';

const ROOM_VIEW_KEY = 'zitas-floor-view';
/** An empty row or column of the plan becomes an aisle this wide (in cells): tables sit closer. */
const AISLE = 0.35;

export function storedRoomView(): RoomView {
  if (typeof window === 'undefined') return '3d';
  return window.localStorage.getItem(ROOM_VIEW_KEY) === 'plan' ? 'plan' : '3d';
}

export function saveRoomView(view: RoomView): void {
  window.localStorage.setItem(ROOM_VIEW_KEY, view);
}

export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

interface Box {
  posX: number;
  posY: number;
  width: number;
  height: number;
}

/**
 * The room's tracks: a row or column with a table is one cell; an empty one shrinks to an aisle,
 * so the tables keep the plan's arrangement but sit closer. `place()` gives a table's box in
 * percent of the room.
 */
export function roomTracks(boxes: readonly Box[], cols: number, rows: number) {
  const usedCols = Array.from({ length: cols }, () => false);
  const usedRows = Array.from({ length: rows }, () => false);
  for (const box of boxes) {
    for (let x = box.posX; x < box.posX + box.width && x < cols; x += 1) usedCols[x] = true;
    for (let y = box.posY; y < box.posY + box.height && y < rows; y += 1) usedRows[y] = true;
  }
  const starts = (used: boolean[]) => {
    const out = [0];
    for (const isUsed of used) out.push(out[out.length - 1]! + (isUsed ? 1 : AISLE));
    return out;
  };
  const xs = starts(usedCols);
  const ys = starts(usedRows);
  const unitsX = xs[cols]!;
  const unitsY = ys[rows]!;
  return {
    unitsX,
    unitsY,
    place(box: Box): CSSProperties {
      const x2 = Math.min(cols, box.posX + box.width);
      const y2 = Math.min(rows, box.posY + box.height);
      return {
        position: 'absolute',
        left: `${(xs[box.posX]! / unitsX) * 100}%`,
        top: `${(ys[box.posY]! / unitsY) * 100}%`,
        width: `${((xs[x2]! - xs[box.posX]!) / unitsX) * 100}%`,
        height: `${((ys[y2]! - ys[box.posY]!) / unitsY) * 100}%`,
      };
    },
  };
}

/** The tracks of a set of tables, kept while they do not change. */
export function useRoomTracks(boxes: readonly Box[], cols: number, rows: number) {
  return useMemo(() => roomTracks(boxes, cols, rows), [boxes, cols, rows]);
}

/** Cell size (px) the room gives `unitsX` cells in `width`, with its rim. */
export const roomCellSize = (width: number, unitsX: number) => width / (unitsX + 0.28);

/**
 * The floor: `unitsX` × `unitsY` cells (aisles included), laid back in 3D. Children are placed
 * with `place()`; they get the cell size as `--cell`. Only this element is transformed.
 */
export function FloorRoom({
  unitsX,
  unitsY,
  width,
  view,
  label,
  className,
  children,
}: {
  unitsX: number;
  unitsY: number;
  /** The width available, measured by the caller (`useElementWidth`). */
  width: number;
  view: RoomView;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  // Less tilt on a phone, where the room is small: closer, and the numbers stay readable.
  const tilt = view === '3d' ? (width < 640 ? 26 : 32) : 0;
  const cell = roomCellSize(width, unitsX);
  const pad = cell * 0.14;
  const floorHeight = cell * unitsY + pad * 2;
  // Seen from the front: the far side recedes, the near side keeps its size (origin at the
  // bottom edge); the box is as tall as the floor projects.
  const perspective = Math.max(900, width * 2.2);
  const radians = (tilt * Math.PI) / 180;
  const projected =
    (floorHeight * Math.cos(radians) * perspective) /
    (perspective + floorHeight * Math.sin(radians));
  if (width <= 0) return <div className={cn('min-h-64', className)} />;
  return (
    <div
      className={cn('relative w-full', className)}
      style={{
        height: Math.ceil(projected) + 14,
        perspective: tilt ? `${perspective}px` : undefined,
        perspectiveOrigin: '50% 100%',
      }}
    >
      <div
        role="group"
        aria-label={label}
        data-view={view}
        className={cn(
          'absolute inset-x-0 bottom-2 rounded-[1.25rem] [--chair-edge:#a48c6b] [--chair:#d9c6a5] [--table-edge:#9a8160]',
          'bg-[#efe6d6] shadow-[0_0_0_5px_#ddcfb6] dark:bg-[#24201b] dark:shadow-[0_0_0_5px_#3a3229]',
          'dark:[--chair-edge:#3e3326] dark:[--chair:#6e5b44] dark:[--table-edge:#14110d]',
        )}
        style={
          {
            '--cell': `${cell}px`,
            height: floorHeight,
            transform: tilt ? `rotateX(${tilt}deg)` : undefined,
            transformOrigin: '50% 100%',
            transition: 'transform 350ms cubic-bezier(.2,.8,.2,1)',
          } as CSSProperties
        }
      >
        <div className="absolute" style={{ inset: pad }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Chairs around a square table: along the long sides, then the ends; a few per cell. */
function chairSpots(width: number, height: number, seats: number) {
  const horizontal = width >= height;
  const long = horizontal ? width : height;
  const short = horizontal ? height : width;
  const perSide = Math.min(2 * long, Math.ceil(seats / 2));
  const sides = Math.min(seats, perSide * 2);
  const ends = Math.min(Math.max(0, seats - sides), 2 * short);
  const spots: { side: 'a' | 'b' | 'start' | 'end'; at: number }[] = [];
  const sideA = Math.ceil(sides / 2);
  const sideB = sides - sideA;
  for (let i = 0; i < sideA; i += 1) spots.push({ side: 'a', at: ((i + 1) / (sideA + 1)) * 100 });
  for (let i = 0; i < sideB; i += 1) spots.push({ side: 'b', at: ((i + 1) / (sideB + 1)) * 100 });
  const start = Math.ceil(ends / 2);
  const end = ends - start;
  for (let i = 0; i < start; i += 1) {
    spots.push({ side: 'start', at: ((i + 1) / (start + 1)) * 100 });
  }
  for (let i = 0; i < end; i += 1) spots.push({ side: 'end', at: ((i + 1) / (end + 1)) * 100 });
  const margin = 'calc(var(--inset) * 0.45)';
  const far = `calc(100% - ${margin})`;
  return spots.map(({ side, at }): CSSProperties => {
    if (horizontal) {
      if (side === 'a') return { left: `${at}%`, top: margin };
      if (side === 'b') return { left: `${at}%`, top: far };
      return { left: side === 'start' ? margin : far, top: `${at}%` };
    }
    if (side === 'a') return { top: `${at}%`, left: margin };
    if (side === 'b') return { top: `${at}%`, left: far };
    return { top: side === 'start' ? margin : far, left: `${at}%` };
  });
}

/**
 * One square table: chairs, then the top with a solid edge and a soft shadow (the depth, on the
 * same flat plane). `topClassName` colours the top (the state on the POS); `children` is what is
 * written on it. `attention` rings a table that wants the waiter (food ready).
 */
export function RoomTable({
  width,
  height,
  seats,
  chairs = true,
  topClassName,
  selected,
  attention,
  children,
}: {
  /** In cells. */
  width: number;
  height: number;
  seats: number;
  /** Off when the cells are too small for them (a crowded room on a phone). */
  chairs?: boolean;
  topClassName?: string;
  selected?: boolean;
  attention?: boolean;
  children?: ReactNode;
}) {
  const radius = 'clamp(6px, calc(var(--cell) * 0.1), 14px)';
  return (
    <span
      className="pointer-events-none absolute inset-0"
      style={{ '--inset': 'clamp(5px, calc(var(--cell) * 0.12), 20px)' } as CSSProperties}
    >
      {chairs
        ? chairSpots(width, height, seats).map((spot, index) => (
            <span
              key={index}
              aria-hidden
              className="absolute size-[clamp(7px,calc(var(--cell)*0.12),18px)] -translate-x-1/2 -translate-y-1/2 rounded-[30%] bg-[var(--chair)] shadow-[0_2px_0_0_var(--chair-edge)]"
              style={spot}
            />
          ))
        : null}
      {attention ? (
        <span
          aria-hidden
          className="absolute border-[3px] border-emerald-500 motion-safe:animate-pulse"
          style={{ inset: 'calc(var(--inset) - 5px)', borderRadius: radius }}
        />
      ) : null}
      <span
        className={cn(
          'pointer-events-auto absolute flex flex-col items-center justify-center overflow-hidden border-2 text-center',
          'group-focus-visible:outline-[3px] group-focus-visible:outline-offset-2 group-focus-visible:outline-ring',
          selected && 'outline-[3px] outline-offset-2 outline-brand',
          topClassName ?? 'border-border bg-card text-foreground',
        )}
        style={{
          inset: 'var(--inset)',
          borderRadius: radius,
          // The edge of the table under its top, and its shadow on the floor.
          boxShadow:
            '0 calc(var(--cell) * 0.055) 0 0 var(--table-edge), 0 calc(var(--cell) * 0.1) calc(var(--cell) * 0.1) rgb(40 25 10 / 0.25)',
        }}
      >
        {children}
      </span>
    </span>
  );
}
