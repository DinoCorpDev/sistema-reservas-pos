import { expect, test } from '@playwright/test';
import {
  closeSignInError,
  pairPos,
  setOneDevicePerPerson,
  tapDigits,
  unlockPos,
} from './pos-helpers';

/** One person, one device at a time (DEC-040); the refusal shows in a modal. */
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await setOneDevicePerPerson(true);
});

test.afterAll(async () => {
  await setOneDevicePerPerson(false);
});

test('a person signed in on one device cannot open another until they lock it', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    const one = await first.newPage();
    const two = await second.newPage();
    await pairPos(one, 'H1');
    await pairPos(two, 'H2');
    await unlockPos(one, '2000');
    // Give the first device a pull to tell the hub and the cloud who is signed in.
    await one.waitForTimeout(4_000);

    await tapDigits(two, '2000');
    await two.getByRole('button', { name: 'Entsperren' }).click();
    const refusal = two.getByTestId('sign-in-error');
    await expect(refusal).toContainText('Marco Brunner ist bereits auf «Handheld 1» angemeldet');
    await closeSignInError(two);

    // Locked on the first device, the person opens the second one.
    await one.getByRole('button', { name: 'Sperren' }).click();
    await one.waitForTimeout(4_000);
    await unlockPos(two, '2000');
    await expect(two.getByTestId('pos-user')).toHaveText('Marco Brunner');
  } finally {
    await first.close();
    await second.close();
  }
});
