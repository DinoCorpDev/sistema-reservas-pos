import { ApiError, catalog } from '@pos/api';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { currentActor, deps } from '@/server/actor';
import { ModifierGroupEditor } from './modifier-group-editor';

export const metadata: Metadata = { title: 'Zusatzoptionen bearbeiten' };

/** One modifier group: selection rules, options with surcharge and allergens, translations. */
export default async function ModifierGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = await currentActor();
  // A removed group leads back to the list, also right after "Entfernen".
  const group = await catalog.getModifierGroup(deps(), actor, id).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') {
      redirect('/backoffice/catalog/modifiers');
    }
    throw error;
  });

  return (
    <ModifierGroupEditor
      key={group.id}
      group={group}
      permissions={{
        manage: actor.permissions.has('catalog.manage'),
        priceChange: actor.permissions.has('catalog.price_change'),
      }}
    />
  );
}
