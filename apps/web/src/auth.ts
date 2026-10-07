import { type BackofficeSession, hasActiveSupportGrant } from '@pos/api';
import NextAuth, { CredentialsSignin, type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import {
  checkStaffCredentials,
  checkUserCredentials,
  locationBelongs,
  userWorksAt,
} from './server/credentials';
import { getDb } from './server/db';

/**
 * Backoffice and support console authentication (Auth.js v5, RF-A07, RF-A10).
 * JWT sessions; the token carries who the user is and which organization/location they act on.
 * Location and organization switches are re-validated against the database (never trusted from
 * the client).
 */

declare module 'next-auth' {
  interface Session {
    user: {
      kind: 'user' | 'support';
      id: string;
      organizationId: string | null;
      locationId: string | null;
      /** Null for DINOLABS support: their UI follows the language picker, else Spanish (DEC-020). */
      uiLanguage: string | null;
      mustChangePassword: boolean;
    } & DefaultSession['user'];
  }
  interface User {
    kind?: 'user' | 'support';
    organizationId?: string | null;
    locationId?: string | null;
    uiLanguage?: string | null;
    mustChangePassword?: boolean;
  }
}

class SignInError extends CredentialsSignin {
  constructor(code: string) {
    super();
    this.code = code;
  }
}

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
  totp: z.string().max(12).optional().nullable(),
});

const SESSION_HOURS = 12;

export const {
  handlers,
  auth,
  signIn,
  signOut,
  unstable_update: updateSession,
} = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt', maxAge: SESSION_HOURS * 60 * 60 },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      id: 'user',
      credentials: { email: {}, password: {}, totp: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) throw new SignInError('invalid');
        const result = await checkUserCredentials(parsed.data);
        if (!result.ok) throw new SignInError(result.reason);
        const identity = result.value;
        return {
          id: identity.userId,
          name: identity.displayName,
          kind: 'user',
          organizationId: identity.organizationId,
          locationId: identity.locationId,
          uiLanguage: identity.uiLanguage,
          mustChangePassword: identity.mustChangePassword,
        };
      },
    }),
    Credentials({
      id: 'staff',
      credentials: { email: {}, password: {}, totp: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) throw new SignInError('invalid');
        const result = await checkStaffCredentials(parsed.data);
        if (!result.ok) throw new SignInError(result.reason);
        return {
          id: result.value.staffId,
          name: result.value.displayName,
          kind: 'support',
          organizationId: null,
          locationId: null,
          uiLanguage: null,
          mustChangePassword: false,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.kind = user.kind ?? 'user';
        token.uid = user.id;
        token.org = user.organizationId ?? null;
        token.loc = user.locationId ?? null;
        token.lang = user.uiLanguage ?? null;
        token.mcp = user.mustChangePassword ?? false;
      }
      if (trigger === 'update' && session && typeof session === 'object') {
        const patch = session as {
          locationId?: string;
          organizationId?: string | null;
          uiLanguage?: string;
          mustChangePassword?: false;
        };
        const uid = token.uid as string;
        if (token.kind === 'user') {
          if (patch.locationId && (await userWorksAt(uid, token.org as string, patch.locationId))) {
            token.loc = patch.locationId;
          }
        } else if (patch.organizationId !== undefined) {
          // Support staff enter an organization only with the owner's grant (RF-A10).
          const allowed =
            patch.organizationId === null ||
            (await hasActiveSupportGrant(getDb(), patch.organizationId, uid));
          if (allowed) {
            token.org = patch.organizationId;
            token.loc =
              patch.organizationId &&
              patch.locationId &&
              (await locationBelongs(patch.organizationId, patch.locationId))
                ? patch.locationId
                : null;
          }
        } else if (
          patch.locationId &&
          token.org &&
          (await locationBelongs(token.org as string, patch.locationId))
        ) {
          token.loc = patch.locationId;
        }
        if (patch.uiLanguage && /^(de|fr|it|en|es)$/.test(patch.uiLanguage))
          token.lang = patch.uiLanguage;
        if (patch.mustChangePassword === false) token.mcp = false;
      }
      return token;
    },
    session({ session, token }) {
      session.user = {
        ...session.user,
        kind: (token.kind as 'user' | 'support') ?? 'user',
        id: token.uid as string,
        organizationId: (token.org as string | null) ?? null,
        locationId: (token.loc as string | null) ?? null,
        uiLanguage: (token.lang as string | null) ?? null,
        mustChangePassword: Boolean(token.mcp),
      };
      return session;
    },
  },
});

/** The session in the shape the API understands (BackofficeSession). */
export async function backofficeSession(): Promise<BackofficeSession | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return null;
  if (user.kind === 'support') {
    return {
      kind: 'support',
      staffId: user.id,
      organizationId: user.organizationId,
      locationId: user.locationId,
    };
  }
  if (!user.organizationId) return null;
  return {
    kind: 'user',
    userId: user.id,
    organizationId: user.organizationId,
    locationId: user.locationId,
  };
}
