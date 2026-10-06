'use client';

import type { AreaDto, TableDto } from '@pos/api';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Card, CardHeader, CardTitle } from '@pos/ui/card';
import { ConfirmButton } from '@pos/ui/confirm';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@pos/ui/dialog';
import { Input } from '@pos/ui/input';
import { Field } from '@pos/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@pos/ui/select';
import { Switch } from '@pos/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@pos/ui/table';
import { PencilIcon, PlusIcon, QrCodeIcon, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useServerAction } from '@/components/backoffice/use-server-action';
import * as actions from './actions';

const QR_MODES = ['disabled', 'view', 'order', 'order_pay'] as const;
const INHERIT = 'inherit';

type AreaDraft = { id?: string; name: string; qrMode: string; sortOrder: number };
type TableDraft = {
  id?: string;
  areaId: string;
  label: string;
  capacity: number;
  shape: string;
  qrMode: string;
};

export function FloorManager({ areas, tables, canEdit }: { areas: AreaDto[]; tables: TableDto[]; canEdit: boolean }) {
  const t = useTranslations('floor');
  const tc = useTranslations('common');
  const tq = useTranslations('qrModes');
  const [areaDraft, setAreaDraft] = useState<AreaDraft | null>(null);
  const [tableDraft, setTableDraft] = useState<TableDraft | null>(null);

  const saveArea = useServerAction(
    (draft: AreaDraft) =>
      draft.id
        ? actions.updateArea(draft.id, { name: draft.name, qrMode: draft.qrMode, sortOrder: draft.sortOrder })
        : actions.createArea({ name: draft.name, qrMode: draft.qrMode, sortOrder: draft.sortOrder }),
    { onSuccess: () => setAreaDraft(null) },
  );
  const toggleArea = useServerAction((id: string, isActive: boolean) => actions.updateArea(id, { isActive }));
  const removeArea = useServerAction(actions.deleteArea);
  const saveTable = useServerAction(
    (draft: TableDraft) => {
      const body = {
        areaId: draft.areaId,
        label: draft.label,
        capacity: draft.capacity,
        shape: draft.shape,
        qrMode: draft.qrMode === INHERIT ? null : draft.qrMode,
      };
      return draft.id ? actions.updateTable(draft.id, body) : actions.createTable(body);
    },
    { onSuccess: () => setTableDraft(null) },
  );
  const toggleTable = useServerAction((id: string, isActive: boolean) => actions.updateTable(id, { isActive }));
  const renewQr = useServerAction(actions.regenerateQr);
  const removeTable = useServerAction(actions.deleteTable);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('areas')}</CardTitle>
          {canEdit ? (
            <Button onClick={() => setAreaDraft({ name: '', qrMode: 'view', sortOrder: areas.length })}>
              <PlusIcon /> {t('newArea')}
            </Button>
          ) : null}
        </CardHeader>
        {areas.length === 0 ? (
          <p className="text-muted-foreground">{t('noAreas')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tc('name')}</TableHead>
                <TableHead>{t('qrMode')}</TableHead>
                <TableHead>{t('tables')}</TableHead>
                <TableHead>{tc('active')}</TableHead>
                {canEdit ? <TableHead className="text-right">{tc('actions')}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {areas.map((area) => (
                <TableRow key={area.id}>
                  <TableCell className="font-medium">{area.name}</TableCell>
                  <TableCell>{tq(area.qrMode as 'view')}</TableCell>
                  <TableCell>{tables.filter((tb) => tb.areaId === area.id).length}</TableCell>
                  <TableCell>
                    <Switch
                      checked={area.isActive}
                      disabled={!canEdit || toggleArea.pending}
                      onCheckedChange={(checked) => void toggleArea.run(area.id, checked)}
                      aria-label={tc('active')}
                    />
                  </TableCell>
                  {canEdit ? (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={tc('edit')}
                        onClick={() =>
                          setAreaDraft({ id: area.id, name: area.name, qrMode: area.qrMode, sortOrder: area.sortOrder })
                        }
                      >
                        <PencilIcon />
                      </Button>
                      <ConfirmButton
                        variant="ghost"
                        size="icon"
                        aria-label={tc('delete')}
                        disabled={removeArea.pending}
                        title={tc('confirmDeleteTitle')}
                        description={tc('confirmDeleteText')}
                        confirmLabel={tc('delete')}
                        cancelLabel={tc('cancel')}
                        onConfirm={() => removeArea.run(area.id)}
                      >
                        <Trash2Icon />
                      </ConfirmButton>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('tables')}</CardTitle>
          {canEdit && areas.length > 0 ? (
            <Button
              onClick={() =>
                setTableDraft({ areaId: areas[0]!.id, label: '', capacity: 4, shape: 'rect', qrMode: INHERIT })
              }
            >
              <PlusIcon /> {t('newTable')}
            </Button>
          ) : null}
        </CardHeader>
        {tables.length === 0 ? (
          <p className="text-muted-foreground">{tc('empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('label')}</TableHead>
                <TableHead>{t('area')}</TableHead>
                <TableHead>{t('capacity')}</TableHead>
                <TableHead>{t('qrMode')}</TableHead>
                <TableHead>{t('qrCode')}</TableHead>
                <TableHead>{tc('active')}</TableHead>
                {canEdit ? <TableHead className="text-right">{tc('actions')}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tables.map((table) => (
                <TableRow key={table.id}>
                  <TableCell className="font-medium">{table.label}</TableCell>
                  <TableCell>{areas.find((a) => a.id === table.areaId)?.name ?? '—'}</TableCell>
                  <TableCell>{table.capacity}</TableCell>
                  <TableCell>
                    {table.qrMode ? tq(table.qrMode as 'view') : <Badge variant="secondary">{t('qrModeInherit')}</Badge>}
                  </TableCell>
                  <TableCell>
                    <a href={`/qr/${table.qrCode}`} target="_blank" rel="noreferrer" className="font-mono text-xs underline">
                      /qr/{table.qrCode}
                    </a>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={table.isActive}
                      disabled={!canEdit || toggleTable.pending}
                      onCheckedChange={(checked) => void toggleTable.run(table.id, checked)}
                      aria-label={tc('active')}
                    />
                  </TableCell>
                  {canEdit ? (
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('newQr')}
                        disabled={renewQr.pending}
                        onClick={() => void renewQr.run(table.id)}
                      >
                        <QrCodeIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={tc('edit')}
                        onClick={() =>
                          setTableDraft({
                            id: table.id,
                            areaId: table.areaId,
                            label: table.label,
                            capacity: table.capacity,
                            shape: table.shape,
                            qrMode: table.qrMode ?? INHERIT,
                          })
                        }
                      >
                        <PencilIcon />
                      </Button>
                      <ConfirmButton
                        variant="ghost"
                        size="icon"
                        aria-label={tc('delete')}
                        disabled={removeTable.pending}
                        title={tc('confirmDeleteTitle')}
                        description={tc('confirmDeleteText')}
                        confirmLabel={tc('delete')}
                        cancelLabel={tc('cancel')}
                        onConfirm={() => removeTable.run(table.id)}
                      >
                        <Trash2Icon />
                      </ConfirmButton>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={!!areaDraft} onOpenChange={(open) => !open && setAreaDraft(null)}>
        <DialogContent closeLabel={tc('close')}>
          {areaDraft ? (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void saveArea.run(areaDraft);
              }}
            >
              <DialogHeader>
                <DialogTitle>{areaDraft.id ? tc('edit') : t('newArea')}</DialogTitle>
              </DialogHeader>
              <Field label={tc('name')} htmlFor="area-name" error={saveArea.fieldErrors.name}>
                <Input
                  id="area-name"
                  required
                  autoFocus
                  value={areaDraft.name}
                  onChange={(e) => setAreaDraft({ ...areaDraft, name: e.target.value })}
                />
              </Field>
              <Field label={t('qrMode')}>
                <Select value={areaDraft.qrMode} onValueChange={(qrMode) => setAreaDraft({ ...areaDraft, qrMode })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QR_MODES.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {tq(mode)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={tc('sortOrder')} htmlFor="area-sort">
                <Input
                  id="area-sort"
                  type="number"
                  min={0}
                  value={areaDraft.sortOrder}
                  onChange={(e) => setAreaDraft({ ...areaDraft, sortOrder: Number(e.target.value) })}
                />
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAreaDraft(null)}>
                  {tc('cancel')}
                </Button>
                <Button type="submit" disabled={saveArea.pending}>
                  {tc('save')}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!tableDraft} onOpenChange={(open) => !open && setTableDraft(null)}>
        <DialogContent closeLabel={tc('close')}>
          {tableDraft ? (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void saveTable.run(tableDraft);
              }}
            >
              <DialogHeader>
                <DialogTitle>{tableDraft.id ? tc('edit') : t('newTable')}</DialogTitle>
              </DialogHeader>
              <Field label={t('label')} htmlFor="table-label" error={saveTable.fieldErrors.label}>
                <Input
                  id="table-label"
                  required
                  autoFocus
                  maxLength={16}
                  value={tableDraft.label}
                  onChange={(e) => setTableDraft({ ...tableDraft, label: e.target.value })}
                />
              </Field>
              <Field label={t('area')}>
                <Select value={tableDraft.areaId} onValueChange={(areaId) => setTableDraft({ ...tableDraft, areaId })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {areas.map((area) => (
                      <SelectItem key={area.id} value={area.id}>
                        {area.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label={t('capacity')} htmlFor="table-capacity">
                  <Input
                    id="table-capacity"
                    type="number"
                    min={1}
                    max={50}
                    value={tableDraft.capacity}
                    onChange={(e) => setTableDraft({ ...tableDraft, capacity: Number(e.target.value) })}
                  />
                </Field>
                <Field label={t('shape')}>
                  <Select value={tableDraft.shape} onValueChange={(shape) => setTableDraft({ ...tableDraft, shape })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rect">{t('shape_rect')}</SelectItem>
                      <SelectItem value="round">{t('shape_round')}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field label={t('qrMode')}>
                <Select value={tableDraft.qrMode} onValueChange={(qrMode) => setTableDraft({ ...tableDraft, qrMode })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={INHERIT}>{t('qrModeInherit')}</SelectItem>
                    {QR_MODES.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {tq(mode)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setTableDraft(null)}>
                  {tc('cancel')}
                </Button>
                <Button type="submit" disabled={saveTable.pending}>
                  {tc('save')}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
