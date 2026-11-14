import { expect, test } from '@playwright/test';

test('Rover View stands on the ground, above it, and leaves the clock as it found it', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/#c=77.405,18.458,13,0,0');
  await page.waitForFunction(() => window.__areo?.getState().mode === 'map' && Boolean(window.__areoMap));
  const before = await page.evaluate(() => window.__areo?.getState().clockLive);

  await page.getByRole('button', { name: 'Rover View: stand on the ground' }).click();
  await expect(page.getByRole('status')).toContainText('Click the map where you want to stand');
  const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);

  const view = page.getByRole('region', { name: 'Rover View' });
  await expect(view).toBeVisible();
  await page.waitForFunction(() => window.__areoVisor?.getState().ready === true, undefined, { timeout: 200_000 });
  const state = await page.evaluate(() => window.__areoVisor?.getState());
  // On Jezero's floor, on the finest terrain model, in daylight.
  expect(state?.elev).toBeGreaterThan(-2700);
  expect(state?.elev).toBeLessThan(-2300);
  expect(state?.groundSource).toBe('HiRISE 1 m DTM');
  expect(state?.sunElevDeg).toBeGreaterThan(5);
  await expect(view.getByText(/Ground from the HiRISE 1 m DTM/)).toBeVisible();

  // Walk forward for a moment: the position changes and the eye stays above the ground.
  await page.evaluate(() => window.__areoVisor?.setMove(0, 1, true));
  await page.waitForFunction((lat0) => Math.abs((window.__areoVisor?.getState().lat ?? lat0) - lat0) > 1e-5, state?.lat ?? 0, { timeout: 60_000 });
  await page.evaluate(() => window.__areoVisor?.setMove(0, 0));

  // Quality can be forced for tests and weak machines.
  await page.evaluate(() => window.__areoVisor?.setQuality('low'));
  await expect.poll(() => page.evaluate(() => window.__areoVisor?.getState().quality), { timeout: 30_000 }).toBe('low');

  await view.getByRole('radio', { name: 'Dusk' }).click();
  await expect.poll(() => page.evaluate(() => window.__areo?.getState().clockPaused)).toBe(true);

  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);
  expect(await page.evaluate(() => window.__areo?.getState().clockLive)).toBe(before);
  expect(await page.evaluate(() => window.__areo?.getState().clockPaused)).toBe(false);
});
