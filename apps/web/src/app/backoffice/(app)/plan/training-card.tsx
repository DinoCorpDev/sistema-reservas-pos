'use client';

import type { platform } from '@pos/api';
import { Badge } from '@pos/ui/badge';
import { Button } from '@pos/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pos/ui/card';
import { ConfirmButton } from '@pos/ui/confirm';
import { GraduationCapIcon, LinkIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useDateTime } from '@/components/backoffice/people/use-date-time';
import { useServerAction } from '@/components/backoffice/use-server-action';
import type { ActionResult } from '@/server/action';
import { type Pairing, PairingDialog } from '../devices/pairing-dialog';
import { createTraining, issueTrainingPairingCode } from './actions';

/**
 * «Übungsbetrieb» (RF-F22): a copy of the restaurant to practise on — same menu, floor and PINs —
 * whose orders, payments and receipts are never real. Its devices are paired from here.
 */
export function TrainingCard({ training }: { training: platform.TrainingDto | null }) {
  const t = useTranslations('myPlan.training');
  const tt = useTranslations('terminals');
  const tc = useTranslations('common');
  const formatDate = useDateTime();
  const router = useRouter();
  const [pairing, setPairing] = useState<Pairing | null>(null);

  const create = useServerAction(createTraining, { successMessage: t('created') });
  const pair = useServerAction(
    async (terminal: { id: string; name: string }): Promise<ActionResult<Pairing>> => {
      const result = await issueTrainingPairingCode(terminal.id);
      if (!result.ok) return result;
      return {
        ok: true,
        data: { ...result.data, kind: 'device', terminalId: terminal.id, name: terminal.name },
      };
    },
    { successMessage: false, onSuccess: setPairing },
  );

  return (
    <Card className="mt-6" data-testid="training-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GraduationCapIcon className="size-5 text-orange-500" aria-hidden />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {training ? (
          <>
            <p className="text-sm text-muted-foreground">
              {t('since', { date: formatDate(training.createdAt) ?? '' })}
            </p>
            <ul className="grid gap-2">
              {training.terminals.map((terminal) => (
                <li
                  key={terminal.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
                  data-testid="training-terminal"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{terminal.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {tt(`types.${terminal.type}`)}
                    </span>
                    {terminal.isPaired ? <Badge variant="success">{t('paired')}</Badge> : null}
                  </span>
                  <Button
                    variant="outline"
                    disabled={pair.pending || !terminal.isActive}
                    onClick={() => void pair.run({ id: terminal.id, name: terminal.name })}
                  >
                    <LinkIcon /> {t('pair')}
                  </Button>
                </li>
              ))}
            </ul>
            <div>
              <ConfirmButton
                variant="outline"
                title={t('renewTitle')}
                description={t('renewText')}
                confirmLabel={t('renew')}
                cancelLabel={tc('cancel')}
                disabled={create.pending}
                onConfirm={() => create.run()}
              >
                {t('renew')}
              </ConfirmButton>
            </div>
          </>
        ) : (
          <div>
            <Button onClick={() => void create.run()} disabled={create.pending}>
              {create.pending ? t('creating') : t('create')}
            </Button>
          </div>
        )}
      </CardContent>
      <PairingDialog
        pairing={pairing}
        renewing={pair.pending}
        onRenew={() =>
          pairing?.kind === 'device' &&
          void pair.run({ id: pairing.terminalId, name: pairing.name })
        }
        onClose={() => {
          setPairing(null);
          router.refresh();
        }}
      />
    </Card>
  );
}
