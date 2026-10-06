import { z } from 'zod';
import { CONTENT_LANGUAGES } from '../shared/languages';
import { CONSENT_PURPOSES, CONSENT_SOURCES } from './constants';
import { normalizePhone } from './privacy';

/**
 * Input schemas of the customer commands (RF-E14…RF-E16, RN-23), shared by the REST API and the
 * backoffice forms. They only validate; the use case normalizes the phone (E.164) and the email.
 */

const optionalText = (max: number) => z.string().trim().max(max).nullable();

const phone = z
  .string()
  .trim()
  .max(32)
  .refine(
    (value) => normalizePhone(value) !== null,
    'Invalid phone number (e.g. +41 79 123 45 67)',
  );

/** Consent as the customer accepted it: purpose, channel and exact text (RN-23, revDSG). */
export const consentInputSchema = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  source: z.enum(CONSENT_SOURCES),
  textVersion: z.string().trim().min(1).max(32),
  textSnapshot: z.string().trim().min(1).max(5000),
});
export type ConsentInput = z.infer<typeof consentInputSchema>;

const customerFields = {
  firstName: optionalText(100),
  lastName: optionalText(100),
  phone: phone.nullable(),
  email: z.email().max(254).nullable(),
  language: z.enum(CONTENT_LANGUAGES).nullable(),
  notes: optionalText(2000),
  /** Allergies declared by the customer themselves (RF-E15). */
  declaredAllergies: optionalText(1000),
  tags: z.array(z.string().trim().min(1).max(32)).max(20),
};

const hasContact = (value: { phone?: string | null; email?: string | null }) =>
  !!value.phone || !!value.email;
const hasContactIssue = { path: ['phone'], message: 'A phone number or an email is required' };

/** A customer is identified by phone or email and is never created without consent (RN-23). */
export const createCustomerSchema = z
  .object({
    firstName: customerFields.firstName.default(null),
    lastName: customerFields.lastName.default(null),
    phone: customerFields.phone.default(null),
    email: customerFields.email.default(null),
    language: customerFields.language.default(null),
    notes: customerFields.notes.default(null),
    declaredAllergies: customerFields.declaredAllergies.default(null),
    tags: customerFields.tags.default([]),
    consent: consentInputSchema,
  })
  .refine(hasContact, hasContactIssue);
export type CreateCustomerInput = z.output<typeof createCustomerSchema>;

export const updateCustomerSchema = z.object(customerFields).partial();
export type UpdateCustomerInput = z.output<typeof updateCustomerSchema>;

export const anonymizeCustomerSchema = z.object({
  /** Why the data is erased, e.g. "Request by e-mail of 2026-10-06" (audit). */
  reason: z.string().trim().min(1).max(500).nullable().default(null),
});
export type AnonymizeCustomerInput = z.output<typeof anonymizeCustomerSchema>;
