import { expect, test, type Page } from '@playwright/test';

async function mode(page: Page): Promise<string> {
  return page.evaluate(() => window.__areo?.getState().mode ?? 'none');
}

test('opens on the planet, flies in and back out on one canvas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Plan a walk on Mars' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go to Jezero', exact: true })).toBeVisible();
  expect(await page.evaluate(() => typeof window.__areo)).toBe('function');
  expect(await mode(page)).toBe('globe');

  // The same canvas must carry the whole journey: no second screen is swapped in.
  await page.waitForFunction(() => Boolean(window.__areoMap));
  await page.evaluate(() => {
    (window as unknown as { __canvas: Element | null }).__canvas = document.querySelector('canvas.maplibregl-canvas');
  });
  const zoomBefore = await page.evaluate(() => window.__areoMap?.getZoom() ?? 0);

  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__areo?.getState().mode === 'map', undefined, { timeout: 30_000 });
  await expect(page.getByRole('combobox', { name: 'Search places or coordinates' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Plan a walk on Mars' })).toBeHidden();

  const state = await page.evaluate(() => ({
    sameCanvas: (window as unknown as { __canvas: Element | null }).__canvas === document.querySelector('canvas.maplibregl-canvas'),
    canvases: document.querySelectorAll('canvas.maplibregl-canvas').length,
    zoom: window.__areoMap?.getZoom() ?? 0,
    center: window.__areoMap?.getCenter().toArray() ?? [0, 0],
    landed: window.__areo?.getState().landed,
  }));
  expect(state.sameCanvas).toBe(true);
  expect(state.canvases).toBe(1);
  expect(state.zoom).toBeGreaterThan(zoomBefore + 5);
  expect(state.center[0]).toBeCloseTo(77.58, 1);
  expect(state.center[1]).toBeCloseTo(18.4, 1);
  expect(state.landed).toBe(true);

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Back to the planet' }).click();
  await page.waitForFunction(() => window.__areo?.getState().mode === 'globe' && !window.__areo.getState().flying, undefined, {
    timeout: 30_000,
  });
  await expect(page.getByRole('heading', { name: 'Plan a walk on Mars' })).toBeVisible();
  expect(await page.evaluate(() => window.__areoMap?.getZoom() ?? 99)).toBeLessThan(4);
  expect(errors).toEqual([]);
});

test('a click on the planet outside the region does not fly in; the marker does', async ({ page }) => {
  await page.goto('/');
  // The marker is added once the style has loaded.
  await expect(page.getByRole('button', { name: 'Go to Jezero crater' })).toBeVisible();
  // Far from Jezero: the opposite limb of the visible disc.
  const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.5);
  await page.waitForTimeout(600);
  expect(await mode(page)).toBe('globe');
  expect(await page.evaluate(() => window.__areo?.getState().flying)).toBe(false);

  await page.getByRole('button', { name: 'Go to Jezero crater' }).click();
  await page.waitForFunction(() => window.__areo?.getState().flying === true || window.__areo?.getState().mode === 'map');
});
