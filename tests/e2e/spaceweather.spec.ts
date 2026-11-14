import { expect, test } from '@playwright/test';

const HOUR = 3_600_000;

/** A DONKI answer in the real feed's shape, with one cloud due at Mars `hoursAhead` from now. */
function feed(hoursAhead: number | null) {
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16) + 'Z';
  const run = (arrival: number) => ({
    simulationID: 'WSA-ENLIL/1/1',
    modelCompletionTime: iso(Date.now() - 6 * HOUR),
    cmeInputs: [{ speed: 726 }],
    impactList: [{ location: 'Mars', arrivalTime: iso(arrival), isGlancingBlow: true, isMinorImpact: false }],
    link: 'https://ccmc.gsfc.nasa.gov/DONKI/view/WSA-ENLIL/1/-1',
  });
  return { fetched: new Date().toISOString(), enlil: hoursAhead === null ? [] : [run(Date.now() + hoursAhead * HOUR)], sep: [], flr: null };
}

test('a storm due at Mars shows on the clock, in its menu and in one toast', async ({ page }) => {
  await page.route('**/api/spaceweather', (route) => route.fulfill({ json: feed(6) }));
  await page.goto('/#c=77.45,18.44,11.5,0,0');
  await page.waitForFunction(() => window.__areo?.getState().mode === 'map');

  const clock = page.getByRole('button', { name: /Local time at Jezero/ });
  await expect(clock).toHaveAccessibleName(/Space weather warning/);
  await expect(page.getByText('Space weather warning', { exact: true })).toBeVisible();

  await clock.click();
  const menu = page.getByRole('dialog');
  await expect(menu.getByText(/A solar storm cloud reaches Mars in 6 hours/)).toBeVisible();
  await expect(menu.getByText(/Reaches Mars/)).toBeVisible();
  await expect(menu.getByText(/726 km\/s/)).toBeVisible();
  // One feed did not answer: the menu says which, and the rest still stands.
  await expect(menu.getByText(/NASA did not answer for solar flares/)).toBeVisible();

  await menu.getByRole('button', { name: 'Plan for a solar particle event' }).click();
  expect(await page.evaluate(() => window.__areo?.getState().scenario.solarEvent)).toBe(true);
  await expect(menu.getByRole('button', { name: 'Plan for a solar particle event' })).toBeHidden();
});

test('quiet space weather stays out of the way, and a dead service says so', async ({ page }) => {
  await page.route('**/api/spaceweather', (route) => route.fulfill({ json: feed(null) }));
  await page.goto('/#c=77.45,18.44,11.5,0,0');
  await page.waitForFunction(() => window.__areo?.getState().spaceWeather !== null);
  const clock = page.getByRole('button', { name: /Local time at Jezero/ });
  await expect(clock).not.toHaveAccessibleName(/Space weather/);
  await clock.click();
  await expect(page.getByRole('dialog').getByText('No solar storm is forecast at Mars this week.')).toBeVisible();
  await expect(page.getByText('Space weather warning', { exact: true })).toHaveCount(0);

  // Nothing answers at all: the app's function and NASA's own server.
  await page.evaluate(() => localStorage.clear());
  await page.route('**/api/spaceweather', (route) => route.abort());
  await page.route('**/ccmc.gsfc.nasa.gov/**', (route) => route.abort());
  await page.goto('/?again=1#c=77.45,18.44,11.5,0,0');
  await page.waitForFunction(() => window.__areo?.getState().spaceWeatherFailed === true);
  await page.getByRole('button', { name: /Local time at Jezero/ }).click();
  await expect(page.getByRole('dialog').getByText(/did not answer, so there is no live forecast/)).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Try again' })).toBeVisible();
});
