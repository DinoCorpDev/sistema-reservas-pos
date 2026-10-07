'use client';

import type { people } from '@pos/api';
import { Alert } from '@pos/ui/alert';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@pos/ui/card';
import { Label } from '@pos/ui/label';
import { Checkbox } from '@pos/ui/switch';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useDraft } from '@/components/backoffice/catalog/use-draft';
import { useServerAction } from '@/components/backoffice/use-server-action';
import { replaceStations } from '../../actions';
import type { EditorLocation, TabProps } from './editor-shared';

/**
 * Kitchen stations of the current location the product is routed to (RF-B11); a product can go
 * to several stations at once (RF-C21).
 */
export function StationsTab({
  product,
  permissions,
  location,
  stations,
}: TabProps & { location: EditorLocation | null; stations: people.KitchenStationDto[] | null }) {
  const t = useTranslations('productStations');
  const te = useTranslations('productEditor');
  const tc = useTranslations('common');
  const { draft: ids, dirty, setDraft: setIds, reset } = useDraft(product.stationIds);
  const save = useServerAction((input: unknown) => replaceStations(product.id, input), {
    onSuccess: (saved) => reset(saved.stationIds),
  });

  if (!location || !stations) return <Alert variant="info">{t('noLocation')}</Alert>;
  const canEdit = permissions.manage;

  return (
    <Card>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          // Routes to a station removed in the meantime are dropped.
          void save.run({ stationIds: ids.filter((id) => stations.some((s) => s.id === id)) });
        }}
      >
        <CardHeader>
          <CardTitle>{t('title', { location: location.name })}</CardTitle>
          <CardDescription>{t('hint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {stations.length === 0 ? (
            <Alert variant="warning">
              {t('noStations')}{' '}
              <Link href="/backoffice/devices?tab=stations" className="underline">
                {t('toStations')}
              </Link>
            </Alert>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {stations.map((station) => (
                <li key={station.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <Checkbox
                    id={`station-${station.id}`}
                    checked={ids.includes(station.id)}
                    disabled={!canEdit}
                    onCheckedChange={(checked) =>
                      setIds((list) =>
                        checked === true
                          ? [...list, station.id]
                          : list.filter((id) => id !== station.id),
                      )
                    }
                  />
                  <Label htmlFor={`station-${station.id}`} className="flex-1">
                    {station.name}
                  </Label>
                  {!station.isActive ? <Badge variant="outline">{tc('inactive')}</Badge> : null}
                </li>
              ))}
            </ul>
          )}
          {stations.length > 0 && ids.length === 0 ? (
            <Alert variant="warning">{t('none')}</Alert>
          ) : null}
        </CardContent>
        {canEdit && stations.length > 0 ? (
          <CardFooter>
            {dirty ? (
              <Button type="button" variant="outline" onClick={() => reset()}>
                {te('discard')}
              </Button>
            ) : null}
            <Button type="submit" disabled={save.pending || !dirty}>
              {save.pending ? tc('saving') : tc('save')}
            </Button>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  );
}
