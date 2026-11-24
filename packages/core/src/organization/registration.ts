import { z } from 'zod';
import { UI_LANGUAGES } from '../shared/languages';

/**
 * A new waiter joins from their own phone (DEC-055): the manager shows a QR with a short-lived
 * code, the waiter enters name, PIN and language, and the manager approves before the PIN opens
 * anything. The code is the only credential of the public form.
 */

/** An invitation lasts an hour… */
export const STAFF_INVITE_TTL_MINUTES = 60;
/** …serves a whole new team at once… */
export const STAFF_INVITE_MAX_USES = 10;
/** …and dies after a few rejected attempts (a taken PIN counts: PINs are not to be guessed). */
export const STAFF_INVITE_MAX_FAILURES = 5;

export const REGISTRATION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/** What the waiter's phone sends. The PIN is typed twice on the phone, checked there. */
export const submitRegistrationSchema = z.object({
  code: z
    .string()
    .trim()
    .min(4)
    .max(32)
    .transform((value) => value.toUpperCase()),
  displayName: z.string().trim().min(2).max(100),
  pin: z.string().regex(/^\d{4,6}$/, 'PIN: 4 to 6 digits'),
  uiLanguage: z.enum(UI_LANGUAGES),
});
export type SubmitRegistrationInput = z.infer<typeof submitRegistrationSchema>;
