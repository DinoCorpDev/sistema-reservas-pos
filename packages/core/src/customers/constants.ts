/** Finalidades de consentimiento registradas al crear un cliente (RF-E16, RN-23, revDSG). */
export const CONSENT_PURPOSES = ['data_processing', 'marketing'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/** Dónde se capturó el consentimiento. */
export const CONSENT_SOURCES = ['pos', 'qr', 'web', 'zitas', 'phone', 'backoffice'] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];
