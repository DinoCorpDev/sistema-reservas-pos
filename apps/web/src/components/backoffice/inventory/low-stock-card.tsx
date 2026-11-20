import { inventory } from '@pos/api';
import { Card, CardContent } from '@pos/ui/card';
import { cn } from '@pos/ui/utils';
import { ChevronRightIcon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { currentActor, deps } from '@/server/actor';

/**
 * «Running low» on the overview (DEC-051): how many raw materials are at or under their alert
 * level, with their names. Hidden while the restaurant keeps no inventory.
 */
export async function LowStockCard() {
  const actor = await currentActor();
  const t = await getTranslations('inventory');
  const ingredients = await inventory.listIngredients(deps(), actor);
  if (ingredients.length === 0) return null;
  const low = ingredients.filter((i) => i.isLow);
  return (
    <Link href="/backoffice/inventory" className="mb-6 block" data-testid="low-stock-card">
      <Card
        className={cn(
          'transition-colors hover:bg-accent/40',
          low.length > 0 && 'border-destructive/40 bg-destructive/5',
        )}
      >
        <CardContent className="flex items-center gap-4 pt-6">
          <span
            className={cn(
              'flex size-12 shrink-0 items-center justify-center rounded-2xl',
              low.length > 0
                ? 'bg-destructive/15 text-destructive'
                : 'bg-brand-soft text-brand-strong',
            )}
          >
            <TriangleAlertIcon className="size-6" />
          </span>
          <div className="grid min-w-0 flex-1 gap-1">
            <p className="text-sm text-muted-foreground">{t('card.label')}</p>
            <p className="text-2xl font-semibold tabular-nums">
              {low.length > 0 ? low.length : '0'}{' '}
              <span className="text-base font-normal text-muted-foreground">
                {t('card.detail', { count: low.length })}
              </span>
            </p>
            {low.length > 0 ? (
              <p className="truncate text-sm font-medium text-destructive">
                {low.map((i) => i.name).join(' · ')}
              </p>
            ) : null}
          </div>
          <ChevronRightIcon className="size-5 text-muted-foreground" aria-hidden />
        </CardContent>
      </Card>
    </Link>
  );
}
