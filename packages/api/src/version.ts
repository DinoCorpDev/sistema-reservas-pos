/**
 * The version of this build (RNF-16, RNF-17): what `/health` reports and what each device and hub
 * says on every sync, so support sees which terminals have not updated yet. Set `APP_VERSION` at
 * deploy time; the web build also inlines it as `NEXT_PUBLIC_APP_VERSION`.
 */
export const APP_VERSION =
  process.env.APP_VERSION?.trim() || process.env.NEXT_PUBLIC_APP_VERSION?.trim() || 'dev';

/** A version sent by a device: short and printable, or nothing. */
export const cleanVersion = (value: string | null | undefined): string | null => {
  const version = value?.trim();
  return version && /^[\w.+-]{1,64}$/.test(version) ? version : null;
};
