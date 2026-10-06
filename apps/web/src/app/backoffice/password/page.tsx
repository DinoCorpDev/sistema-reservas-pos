import { Alert } from '@pos/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@pos/ui/card';
import { getTranslations } from 'next-intl/server';
import { ForcedPasswordChange } from './forced-password-change';

/** First sign-in with the temporary password set by support (Flujo 7): choose your own. */
export default async function ForcedPasswordPage() {
  const t = await getTranslations('account');
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('passwordTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="info">{t('mustChange')}</Alert>
          <ForcedPasswordChange />
        </CardContent>
      </Card>
    </main>
  );
}
