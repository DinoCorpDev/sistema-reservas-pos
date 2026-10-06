/** Consent purposes recorded when a customer is created (RF-E16, RN-23, revDSG). */
export const CONSENT_PURPOSES = ['data_processing', 'marketing'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/** Where the consent was captured. */
export const CONSENT_SOURCES = ['pos', 'qr', 'web', 'zitas', 'phone', 'backoffice'] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];
