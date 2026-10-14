import { getMeta, setMeta } from './db';
import { type DeviceLanguage, asDeviceLanguage } from './i18n';
import { getPos, usePos } from './store';

/**
 * Each person reads the POS and the kitchen display in their own language (RF-A08). The default
 * is the language of their user in the backoffice; a choice made on the device (the globe next to
 * their name) is remembered on that device for that person, also without network.
 */

/** The language this person chose on this device, or their default. */
export async function preferredLanguage(userId: string, fallback: string): Promise<string> {
  const chosen = (await getMeta('languages'))?.[userId];
  return chosen ?? fallback;
}

/** Switches the screens of the person on the device to this language, and remembers it. */
export async function chooseLanguage(language: DeviceLanguage): Promise<void> {
  const { user } = getPos();
  if (!user) return;
  usePos.setState({ user: { ...user, uiLanguage: language } });
  const chosen = (await getMeta('languages')) ?? {};
  await setMeta('languages', { ...chosen, [user.id]: asDeviceLanguage(language) });
}
