'use server';

import { AuthError, CredentialsSignin } from 'next-auth';
import { cookies } from 'next/headers';
import { signIn } from '@/auth';
import { isUiLocale } from '@/i18n/locales';

export interface LoginState {
  error: string | null;
  email: string;
}

async function login(provider: 'user' | 'staff', formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '');
  try {
    await signIn(provider, {
      email,
      password: String(formData.get('password') ?? ''),
      totp: String(formData.get('totp') ?? '') || null,
      redirectTo: provider === 'user' ? '/backoffice' : '/support',
    });
    return { error: null, email };
  } catch (error) {
    if (error instanceof CredentialsSignin) return { error: error.code || 'invalid', email };
    if (error instanceof AuthError) return { error: 'invalid', email };
    throw error; // successful sign-in redirects by throwing NEXT_REDIRECT
  }
}

export async function loginUser(_state: LoginState, formData: FormData) {
  return login('user', formData);
}

export async function loginStaff(_state: LoginState, formData: FormData) {
  return login('staff', formData);
}

/** Language of the login page before sign-in; afterwards the user's own language applies. */
export async function setLoginLanguage(language: string) {
  if (!isUiLocale(language)) return;
  (await cookies()).set('NEXT_LOCALE', language, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
}
