'use client';

import {
  FLOOR_GRID_MAX,
  FLOOR_GRID_MIN,
  findFreeSpot,
  fitsGrid,
  gridOf,
  nextTableLabel,
  tablesOverlap,
} from '@pos/core';
import { Alert } from '@pos/ui/alert';
import { Button } from '@pos/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { cn } from '@pos/ui/utils';
import {
  BoxIcon,
  CameraIcon,
  MinusIcon,
  MousePointerClickIcon,
  PencilRulerIcon,
  PlusIcon,
  SaveIcon,
  SparklesIcon,
  Trash2Icon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useServerAction } from '@/components/backoffice/use-server-action';
import { FloorRoom, RoomTable, roomTracks, useElementWidth } from '@/components/floor/floor-room';
import * as actions from '../actions';

type Shape = 'rect' | 'round';

export interface PlanTable {
  id: string;
  label: string;
  capacity: number;
  shape: Shape;
  posX: number;
  posY: number;
  width: number;
  height: number;
}

interface EditorTable extends Omit<PlanTable, 'id'> {
  key: string;
  id: string | null;
  /** An existing table the photo did not show: kept, placed where there was room. */
  notInPhoto?: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const byLabel = (a: { label: string }, b: { label: string }) =>
  a.label.localeCompare(b.label, undefined, { numeric: true });

/**
 * The tables as they come: kept where they are when they form a plan; otherwise (never placed,
 * all at 0,0) set out in order on an 8-wide grid, for the person to arrange.
 */
function startingPlan(tables: readonly PlanTable[]): { tables: EditorTable[]; arranged: boolean } {
  const list = tables.map((table) => ({ ...table, key: table.id }));
  const usable =
    list.every((t) => fitsGrid(t, FLOOR_GRID_MAX, FLOOR_GRID_MAX)) &&
    list.every((t, i) => list.slice(0, i).every((other) => !tablesOverlap(t, other)));
  if (usable) return { tables: list, arranged: false };
  const placed: EditorTable[] = [];
  for (const table of [...list].sort(byLabel)) {
    const size = { width: clamp(table.width, 1, 4), height: clamp(table.height, 1, 4) };
    const spot = findFreeSpot(placed, size, 8, FLOOR_GRID_MAX);
    if (spot) {
      placed.push({ ...table, ...size, ...spot });
      continue;
    }
    const small = findFreeSpot(placed, { width: 1, height: 1 }, FLOOR_GRID_MAX, FLOOR_GRID_MAX);
    if (small) placed.push({ ...table, width: 1, height: 1, ...small });
  }
  return { tables: placed, arranged: true };
}

const initialGrid = (tables: readonly EditorTable[]) => {
  const grid = gridOf(tables);
  return { cols: Math.max(grid.cols, 8), rows: Math.max(grid.rows, 6) };
};

/** A photo scaled down in the browser: at most 1568 px, JPEG, never stored (DEC-056). */
async function shrinkPhoto(file: File) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.8),
  );
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return {
    mediaType: 'image/jpeg' as const,
    data: dataUrl.slice(dataUrl.indexOf(',') + 1),
    url: URL.createObjectURL(blob),
  };
}

/**
 * The floor plan editor of an area (DEC-056): the grid the POS draws (at most 16 × 16), tables
 * dragged with a finger or the mouse, or moved with the arrow keys (Shift resizes). From a
 * photo, the AI proposes the tables and the person adjusts them before saving (PA-07).
 */
export function FloorEditor({
  areaId,
  tables: saved,
  otherLabels,
  canEdit,
  canReadPhotos,
}: {
  areaId: string;
  tables: PlanTable[];
  /** Labels of the tables of the other areas: a new table never takes one. */
  otherLabels: string[];
  canEdit: boolean;
  canReadPhotos: boolean;
}) {
  const t = useTranslations('floor.plan');
  const router = useRouter();
  const [start] = useState(() => startingPlan(saved));
  const [tables, setTables] = useState<EditorTable[]>(start.tables);
  const [grid, setGrid] = useState(() => initialGrid(start.tables));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [dirty, setDirty] = useState(start.arranged);
  const [arranged, setArranged] = useState(start.arranged);
  const [photo, setPhoto] = useState<{ url: string; notes: string | null } | null>(null);
  const [reading, setReading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  // The room as the POS will show it, in 3D; editing happens on the plan (DEC-057).
  const [preview, setPreview] = useState(false);
  const [canvasWidth, setCanvasWidth] = useState(0);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setCanvasWidth(canvas.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setCanvasWidth(entry.contentRect.width);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{
    key: string;
    startX: number;
    startY: number;
    posX: number;
    posY: number;
  } | null>(null);

  // After a save the page brings the tables with their ids: show them while nothing is pending.
  useEffect(() => {
    if (dirty) return;
    const next = startingPlan(saved);
    setTables(next.tables);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the saved tables change
  }, [saved]);
  useEffect(() => () => (photo ? URL.revokeObjectURL(photo.url) : undefined), [photo]);

  const save = useServerAction(
    (input: { tables: unknown[] }) => actions.saveFloorLayout(areaId, input),
    {
      successMessage: t('saved'),
      onSuccess: () => {
        setDirty(false);
        setArranged(false);
        setPhoto(null);
        router.refresh();
      },
    },
  );

  // Tables that overlap, leave the grid or repeat a label: marked red; saving waits for them.
  const problems = useMemo(() => {
    const keys = new Set<string>();
    const labels = new Map<string, string>();
    tables.forEach((table, i) => {
      if (!fitsGrid(table, grid.cols, grid.rows)) keys.add(table.key);
      for (const other of tables.slice(0, i)) {
        if (tablesOverlap(table, other)) {
          keys.add(table.key);
          keys.add(other.key);
        }
      }
      const label = table.label.trim().toLowerCase();
      const first = labels.get(label);
      if (!label || first !== undefined) {
        keys.add(table.key);
        if (first) keys.add(first);
      } else {
        labels.set(label, table.key);
      }
    });
    return keys;
  }, [tables, grid]);

  const selected = tables.find((table) => table.key === selectedKey) ?? null;
  const update = (key: string, change: (table: EditorTable) => Partial<EditorTable>) => {
    setTables((current) =>
      current.map((table) => (table.key === key ? { ...table, ...change(table) } : table)),
    );
    setDirty(true);
  };
  const extent = gridOf(tables);
  // The grid the POS draws (`planLayout`): as wide as the tables reach (at least 4), as deep as
  // they reach, without the editor's spare rows.
  const [previewRef, previewWidth] = useElementWidth<HTMLDivElement>();
  const tillGrid = {
    cols: extent.cols,
    rows: Math.max(1, ...tables.map((table) => table.posY + table.height)),
  };
  const tillTracks = roomTracks(tables, tillGrid.cols, tillGrid.rows);

  const addTable = () => {
    let spot = findFreeSpot(tables, { width: 1, height: 1 }, grid.cols, grid.rows);
    let rows = grid.rows;
    while (!spot && rows < FLOOR_GRID_MAX) {
      rows += 1;
      spot = findFreeSpot(tables, { width: 1, height: 1 }, grid.cols, rows);
    }
    if (!spot) return;
    if (rows !== grid.rows) setGrid({ ...grid, rows });
    const label = nextTableLabel(new Set([...otherLabels, ...tables.map((table) => table.label)]));
    const key = `new-${crypto.randomUUID()}`;
    setTables((current) => [
      ...current,
      { key, id: null, label, capacity: 4, shape: 'rect', width: 1, height: 1, ...spot },
    ]);
    setSelectedKey(key);
    setDirty(true);
  };

  const onPhoto = async (file: File) => {
    setPhotoError(null);
    setReading(true);
    try {
      const shrunk = await shrinkPhoto(file);
      const result = await actions.readFloorPhoto(areaId, {
        mediaType: shrunk.mediaType,
        data: shrunk.data,
      });
      if (!result.ok) {
        URL.revokeObjectURL(shrunk.url);
        setPhotoError(t(`photoErrors.${result.reason}`));
        return;
      }
      // A table the AI names like an existing one is that table; the others are new.
      const existing = new Map(saved.map((table) => [table.label.toLowerCase(), table]));
      const matched = new Set<string>();
      const next: EditorTable[] = result.tables.map((planned, index) => {
        const match = existing.get(planned.label.toLowerCase());
        if (match) matched.add(match.id);
        return {
          ...planned,
          key: match?.id ?? `new-${index}-${crypto.randomUUID()}`,
          id: match?.id ?? null,
        };
      });
      for (const table of saved.filter((candidate) => !matched.has(candidate.id))) {
        const size = { width: table.width, height: table.height };
        const spot = findFreeSpot(next, size, FLOOR_GRID_MAX, FLOOR_GRID_MAX);
        const small = spot
          ? null
          : findFreeSpot(next, { width: 1, height: 1 }, FLOOR_GRID_MAX, FLOOR_GRID_MAX);
        if (!spot && !small) continue;
        next.push({
          ...table,
          ...(spot ? size : { width: 1, height: 1 }),
          ...(spot ?? small!),
          key: table.id,
          notInPhoto: true,
        });
      }
      setTables(next);
      setGrid(gridOf(next));
      setPhoto((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return { url: shrunk.url, notes: result.notes };
      });
      setSelectedKey(null);
      setArranged(false);
      setDirty(true);
    } catch {
      setPhotoError(t('photoErrors.file'));
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // ── Dragging: whole cells, inside the grid ──
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>, table: EditorTable) => {
    setSelectedKey(table.key);
    if (!canEdit) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      key: table.key,
      startX: event.clientX,
      startY: event.clientY,
      posX: table.posX,
      posY: table.posY,
    };
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    const canvas = canvasRef.current;
    if (!current || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dx = Math.round((event.clientX - current.startX) / (rect.width / grid.cols));
    const dy = Math.round((event.clientY - current.startY) / (rect.height / grid.rows));
    const table = tables.find((candidate) => candidate.key === current.key);
    if (!table) return;
    const posX = clamp(current.posX + dx, 0, grid.cols - table.width);
    const posY = clamp(current.posY + dy, 0, grid.rows - table.height);
    if (posX !== table.posX || posY !== table.posY) update(table.key, () => ({ posX, posY }));
  };
  const endDrag = () => {
    drag.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, table: EditorTable) => {
    if (!canEdit) return;
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
      event.key
    ];
    if (!step) return;
    event.preventDefault();
    const [dx, dy] = step as [number, number];
    if (event.shiftKey) {
      update(table.key, (t) => ({
        width: clamp(t.width + dx, 1, Math.min(4, grid.cols - t.posX)),
        height: clamp(t.height + dy, 1, Math.min(4, grid.rows - t.posY)),
      }));
    } else {
      update(table.key, (t) => ({
        posX: clamp(t.posX + dx, 0, grid.cols - t.width),
        posY: clamp(t.posY + dy, 0, grid.rows - t.height),
      }));
    }
  };

  const changeGrid = (side: 'cols' | 'rows', delta: number) => {
    const min = Math.max(FLOOR_GRID_MIN, side === 'cols' ? extent.cols : extent.rows);
    setGrid({ ...grid, [side]: clamp(grid[side] + delta, min, FLOOR_GRID_MAX) });
  };

  const submit = () =>
    void save.run({
      tables: tables.map(({ id, label, capacity, shape, posX, posY, width, height }) => ({
        id,
        label: label.trim(),
        capacity,
        shape,
        posX,
        posY,
        width,
        height,
      })),
    });

  return (
    <div className="grid gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 shadow-card">
        {canEdit ? (
          <>
            <Button variant="outline" onClick={addTable}>
              <PlusIcon /> {t('add')}
            </Button>
            <Button
              variant="outline"
              disabled={!canReadPhotos || reading}
              onClick={() => fileRef.current?.click()}
              title={canReadPhotos ? undefined : t('photoNeedsKey')}
            >
              {reading ? <SparklesIcon className="animate-pulse" /> : <CameraIcon />}
              {reading ? t('reading') : t('photo')}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              // Opened by the button above; hidden so assistive tech finds one control.
              hidden
              tabIndex={-1}
              aria-hidden
              data-testid="floor-photo-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onPhoto(file);
              }}
            />
          </>
        ) : null}
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <span className="ml-2">{t('cols')}</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('fewerCols')}
            disabled={!canEdit}
            onClick={() => changeGrid('cols', -1)}
          >
            <MinusIcon />
          </Button>
          <span className="w-6 text-center font-medium text-foreground tabular-nums">
            {grid.cols}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('moreCols')}
            disabled={!canEdit}
            onClick={() => changeGrid('cols', 1)}
          >
            <PlusIcon />
          </Button>
          <span className="ml-2">{t('rows')}</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('fewerRows')}
            disabled={!canEdit}
            onClick={() => changeGrid('rows', -1)}
          >
            <MinusIcon />
          </Button>
          <span className="w-6 text-center font-medium text-foreground tabular-nums">
            {grid.rows}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('moreRows')}
            disabled={!canEdit}
            onClick={() => changeGrid('rows', 1)}
          >
            <PlusIcon />
          </Button>
        </div>
        <Button
          variant="outline"
          className="ml-auto"
          aria-pressed={preview}
          data-testid="floor-preview-toggle"
          onClick={() => setPreview((value) => !value)}
        >
          {preview ? <PencilRulerIcon /> : <BoxIcon />} {preview ? t('editPlan') : t('view3d')}
        </Button>
        {canEdit ? (
          <Button onClick={submit} disabled={!dirty || problems.size > 0 || save.pending}>
            <SaveIcon /> {photo ? t('saveProposal') : t('save')}
          </Button>
        ) : null}
      </div>

      {!canReadPhotos && canEdit ? (
        <p className="text-sm text-muted-foreground">{t('photoNeedsKey')}</p>
      ) : null}
      {photoError ? <Alert variant="destructive">{photoError}</Alert> : null}
      {arranged ? <Alert variant="info">{t('arranged')}</Alert> : null}
      {photo ? (
        <Alert variant="info" data-testid="photo-proposal">
          <strong>{t('proposalTitle')}</strong> {t('proposalHint')}
          {photo.notes ? <span className="mt-1 block">{photo.notes}</span> : null}
        </Alert>
      ) : null}
      {problems.size > 0 ? <Alert variant="warning">{t('problems')}</Alert> : null}
      {save.fieldErrors.label ? <Alert variant="destructive">{t('labelTaken')}</Alert> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        {/* The grid, the same proportions as on the POS */}
        <div className="min-w-0" ref={previewRef}>
          <div
            ref={canvasRef}
            hidden={preview}
            data-testid="floor-canvas"
            className="relative mx-auto rounded-[1.25rem] border-4 border-[#ddcfb6] bg-[#efe6d6] dark:border-[#3a3229] dark:bg-[#24201b]"
            style={{
              ['--cell' as string]: `${canvasWidth / grid.cols}px`,
              aspectRatio: `${grid.cols} / ${grid.rows}`,
              width: `min(100%, calc(70vh * ${grid.cols} / ${grid.rows}))`,
              backgroundImage:
                'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
              backgroundSize: `${100 / grid.cols}% ${100 / grid.rows}%`,
            }}
          >
            {tables.length === 0 ? (
              <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">
                {t('empty')}
              </p>
            ) : null}
            {tables.map((table) => {
              const isSelected = table.key === selectedKey;
              const bad = problems.has(table.key);
              return (
                <button
                  key={table.key}
                  type="button"
                  data-testid={`plan-table-${table.label}`}
                  aria-label={t('tableAria', { label: table.label, seats: table.capacity })}
                  aria-pressed={isSelected}
                  className="group absolute touch-none outline-none select-none"
                  style={{
                    left: `${(table.posX / grid.cols) * 100}%`,
                    top: `${(table.posY / grid.rows) * 100}%`,
                    width: `${(table.width / grid.cols) * 100}%`,
                    height: `${(table.height / grid.rows) * 100}%`,
                    cursor: canEdit ? 'grab' : 'default',
                  }}
                  onPointerDown={(event) => onPointerDown(event, table)}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onKeyDown={(event) => onKeyDown(event, table)}
                  onFocus={() => setSelectedKey(table.key)}
                >
                  <RoomTable
                    width={table.width}
                    height={table.height}
                    seats={table.capacity}
                    selected={isSelected}
                    topClassName={cn(
                      '@container border-border bg-card text-foreground',
                      table.id === null && 'border-brand/60',
                      table.notInPhoto && 'border-dashed',
                      bad && 'border-destructive bg-destructive/10',
                    )}
                  >
                    <span className="truncate px-0.5 text-[clamp(10px,calc(var(--cell)*0.24),16px)] leading-tight font-semibold">
                      {table.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground tabular-nums @max-[3.25rem]:hidden">
                      {t('seatsShort', { count: table.capacity })}
                    </span>
                  </RoomTable>
                </button>
              );
            })}
          </div>
          {preview ? (
            <div data-testid="floor-3d-preview">
              <FloorRoom
                unitsX={tillTracks.unitsX}
                unitsY={tillTracks.unitsY}
                width={previewWidth}
                view="3d"
                label={t('preview')}
              >
                {tables.map((table) => (
                  <button
                    key={table.key}
                    type="button"
                    className="group outline-none"
                    style={tillTracks.place(table)}
                    aria-label={t('tableAria', { label: table.label, seats: table.capacity })}
                    aria-pressed={table.key === selectedKey}
                    onClick={() => setSelectedKey(table.key)}
                  >
                    <RoomTable
                      width={table.width}
                      height={table.height}
                      seats={table.capacity}
                      selected={table.key === selectedKey}
                      topClassName={cn(
                        'border-border bg-card text-foreground',
                        problems.has(table.key) && 'border-destructive bg-destructive/10',
                      )}
                    >
                      <span className="truncate px-0.5 text-[clamp(10px,calc(var(--cell)*0.24),16px)] leading-tight font-semibold">
                        {table.label}
                      </span>
                    </RoomTable>
                  </button>
                ))}
              </FloorRoom>
            </div>
          ) : null}
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {preview ? t('previewHint') : t('keyboardHint')}
          </p>
        </div>

        {/* The selected table, and the photo to compare */}
        <div className="grid content-start gap-4">
          {photo ? (
            <Card>
              <CardHeader icon={<CameraIcon />}>
                <CardTitle>{t('yourPhoto')}</CardTitle>
                <CardDescription>{t('privacy')}</CardDescription>
              </CardHeader>
              {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
              <img src={photo.url} alt={t('yourPhoto')} className="rounded-lg border" />
            </Card>
          ) : null}
          <Card>
            {selected ? (
              <div className="grid gap-3">
                <CardTitle>{t('tableTitle', { label: selected.label || '—' })}</CardTitle>
                {selected.notInPhoto ? (
                  <p className="text-sm text-muted-foreground">{t('notInPhoto')}</p>
                ) : null}
                <Field label={t('label')} htmlFor="plan-label">
                  <Input
                    id="plan-label"
                    value={selected.label}
                    maxLength={16}
                    disabled={!canEdit}
                    onChange={(event) =>
                      update(selected.key, () => ({ label: event.target.value }))
                    }
                  />
                </Field>
                <Field label={t('seats')} htmlFor="plan-seats">
                  <Input
                    id="plan-seats"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={50}
                    value={selected.capacity}
                    disabled={!canEdit}
                    onChange={(event) =>
                      update(selected.key, () => ({
                        capacity: clamp(Number(event.target.value) || 1, 1, 50),
                      }))
                    }
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {(['width', 'height'] as const).map((side) => {
                    const room =
                      side === 'width' ? grid.cols - selected.posX : grid.rows - selected.posY;
                    return (
                      <div key={side} className="grid gap-1">
                        <span className="font-medium">{t(side)}</span>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label={t(`${side}Less`)}
                            disabled={!canEdit || selected[side] <= 1}
                            onClick={() =>
                              update(selected.key, (table) => ({ [side]: table[side] - 1 }))
                            }
                          >
                            <MinusIcon />
                          </Button>
                          <span className="w-6 text-center tabular-nums">{selected[side]}</span>
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label={t(`${side}More`)}
                            disabled={!canEdit || selected[side] >= Math.min(4, room)}
                            onClick={() =>
                              update(selected.key, (table) => ({ [side]: table[side] + 1 }))
                            }
                          >
                            <PlusIcon />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {selected.id === null && canEdit ? (
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => {
                      setTables((current) => current.filter((t) => t.key !== selected.key));
                      setSelectedKey(null);
                      setDirty(true);
                    }}
                  >
                    <Trash2Icon /> {t('removeNew')}
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">{t('removeHint')}</p>
                )}
              </div>
            ) : (
              <div className="grid justify-items-center gap-2 py-4 text-center text-sm text-muted-foreground">
                <MousePointerClickIcon className="size-6" aria-hidden />
                {t('selectHint')}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
