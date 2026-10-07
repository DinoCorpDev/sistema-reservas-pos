'use client';

import { Button } from '@pos/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@pos/ui/card';
import { useTranslations } from 'next-intl';
import {
  incompleteLanguages,
  textDraftOf,
  textTranslationsInput,
} from '@/components/backoffice/catalog/catalog-data';
import { TextTranslationFields } from '@/components/backoffice/catalog/translation-fields';
import { useDraft } from '@/components/backoffice/catalog/use-draft';
import { useServerAction } from '@/components/backoffice/use-server-action';
import { replaceTranslations } from '../../actions';
import type { EditorLocation, TabProps } from './editor-shared';

/** Name and description in DE, FR, IT and EN (RF-B07); missing ones fall back to the location language. */
export function TranslationsTab({
  product,
  permissions,
  location,
}: TabProps & { location: EditorLocation | null }) {
  const t = useTranslations('productTranslations');
  const te = useTranslations('productEditor');
  const tc = useTranslations('common');
  const tl = useTranslations('languages');
  const { draft, dirty, setDraft, reset } = useDraft(textDraftOf(product.translations));
  const save = useServerAction((input: unknown) => replaceTranslations(product.id, input), {
    onSuccess: (saved) => reset(textDraftOf(saved.translations)),
  });
  const canEdit = permissions.manage;
  const incomplete = incompleteLanguages(draft);

  return (
    <Card>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (incomplete.length > 0) return;
          void save.run(textTranslationsInput(draft));
        }}
      >
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>
            {t('hint', { name: product.name })}{' '}
            {location
              ? t('locationLanguages', {
                  location: location.name,
                  languages: location.languages.map((code) => tl(code)).join(', '),
                })
              : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TextTranslationFields
            idPrefix="product-translation"
            value={draft}
            disabled={!canEdit}
            locationLanguages={location?.languages ?? []}
            defaultLanguage={location?.defaultLanguage}
            onChange={setDraft}
          />
        </CardContent>
        {canEdit ? (
          <CardFooter>
            {dirty ? (
              <Button type="button" variant="outline" onClick={() => reset()}>
                {te('discard')}
              </Button>
            ) : null}
            <Button type="submit" disabled={save.pending || !dirty || incomplete.length > 0}>
              {save.pending ? tc('saving') : tc('save')}
            </Button>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  );
}
