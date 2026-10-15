'use client';

import { Button } from '@pos/ui/button';
import { useTranslations } from 'next-intl';
import { usePos } from '@/device/store';
import { StatusIndicator } from '@/device/ui/status-indicator';

interface ChoosableStation {
  id: string;
  name: string;
}

/**
 * Before the PIN, a kitchen display without a fixed station asks where the cook works (DEC-042):
 * one large button per active station. Locking asks again for the next person.
 */
export function StationPicker({ stations }: { stations: readonly ChoosableStation[] }) {
  const t = useTranslations('kds.chooseStation');
  const location = usePos((state) => state.bootstrap?.location.name);
  const terminal = usePos((state) => state.device?.terminalName);

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-lg font-semibold">{location}</p>
        <p className="text-sm text-muted-foreground">{terminal}</p>
        <StatusIndicator className="mt-2" />
      </div>
      <div className="text-center">
        <h1 className="text-3xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('hint')}</p>
      </div>
      {stations.length === 0 ? (
        <p className="text-center text-lg" role="alert">
          {t('none')}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stations.map((station) => (
            <Button
              key={station.id}
              variant="outline"
              className="h-28 text-2xl font-semibold whitespace-normal"
              data-testid="station-choice"
              onClick={() => usePos.setState({ kitchenStationId: station.id })}
            >
              {station.name}
            </Button>
          ))}
        </div>
      )}
    </main>
  );
}

/**
 * The station above the PIN pad, large, so nobody signs in at the wrong one (DEC-042). A display
 * that chose it can go back to the choice.
 */
export function StationHeading({ name, canChange }: { name: string; canChange: boolean }) {
  const t = useTranslations('kds.chooseStation');
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <p className="text-sm text-muted-foreground">{t('station')}</p>
      <p className="text-4xl font-bold" data-testid="kds-pin-station">
        {name}
      </p>
      {canChange && (
        <Button
          variant="ghost"
          onClick={() => usePos.setState({ kitchenStationId: null })}
          data-testid="other-station"
        >
          {t('other')}
        </Button>
      )}
    </div>
  );
}
