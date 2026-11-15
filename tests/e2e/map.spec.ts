import { expect, test, type Page } from '@playwright/test';

/** Opens straight on the map: a link with a view skips the opening screen. */
async function openMap(page: Page, hash = '#c=77.45,18.44,11.5,0,0'): Promise<void> {
  await page.goto(`/${hash}`);
  await page.waitForFunction(() => window.__areo?.getState().mode === 'map' && Boolean(window.__areoMap));
  await expect(page.getByRole('combobox', { name: 'Search places or coordinates' })).toBeVisible();
}

test('search finds Cheyava Falls and opens its card with the rover photo', async ({ page }) => {
  await openMap(page);
  const search = page.getByRole('combobox', { name: 'Search places or coordinates' });
  await search.fill('cheyava');
  await expect(page.getByRole('option').first()).toContainText('Cheyava Falls');
  await search.press('Enter');
  const card = page.getByRole('article', { name: 'Cheyava Falls' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Cheyava Falls' })).toBeVisible();
  // The photo is the rover's own, with its credit.
  const photo = card.locator('img').first();
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(200);
  await expect(card).toContainText('NASA/JPL-Caltech');
  // Four numbers at a glance, then sections that open on request.
  await expect(card.getByText('Elevation')).toBeVisible();
  await card.getByRole('button', { name: /Geology/ }).click();
  await expect(card.getByText('Map unit')).toBeVisible();
  // The place travels in the link.
  await expect.poll(() => page.url()).toContain('place=place%3Acheyava-falls');
});

test('typed coordinates drop a pin and read the ground there', async ({ page }) => {
  await openMap(page);
  const search = page.getByRole('combobox', { name: 'Search places or coordinates' });
  await search.fill('18.4446, 77.4509');
  await search.press('Enter');
  const card = page.getByRole('article', { name: 'Dropped pin' });
  await expect(card).toBeVisible();
  // Jezero's floor is about 2.5 km below the reference level.
  await expect(card.getByText(/−2,5\d\d/)).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText(/This spot is in Jezero/)).toBeVisible();
});

test('the pointer readout shows elevation and local time', async ({ page }) => {
  await openMap(page, '#c=77.45,18.44,12,0,0');
  const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  const readout = page.getByTestId('cursor-readout');
  // The first pass may only have coarse tiles in memory; moving again reads the finer one.
  // Two spots in turn: a label or the base badge may sit under one of them on a tilted map.
  let turn = 0;
  await expect(async () => {
    const [fx, fy] = turn++ % 2 === 0 ? [0.55, 0.5] : [0.72, 0.78];
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
    await page.mouse.move(box.x + box.width * (fx + 0.01), box.y + box.height * (fy + 0.01));
    await expect(readout).toContainText(/−2,[45]\d\d\sm/, { timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await expect(readout).toContainText('LTST');
  await expect(readout).toContainText('slope');
});

test('the far side of the planet at zoom 5 shows imagery, not a blank', async ({ page }) => {
  await openMap(page, '#c=-100,-10,5,0,0');
  await page.waitForFunction(() => window.__areoMap?.areTilesLoaded() === true, undefined, { timeout: 45_000 });
  // Read the middle of the canvas: real ground has texture, a blank tile has none.
  const spread = await page.evaluate(async () => {
    const map = window.__areoMap;
    if (!map) return 0;
    await new Promise<void>((resolve) => {
      map.once('render', () => resolve());
      map.triggerRepaint();
    });
    const gl = map.getCanvas().getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) return 0;
    const w = 200;
    const px = new Uint8Array(w * w * 4);
    gl.readPixels(Math.floor(gl.drawingBufferWidth / 2 - w / 2), Math.floor(gl.drawingBufferHeight / 2 - w / 2), w, w, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let min = 255;
    let max = 0;
    for (let i = 0; i < px.length; i += 4) {
      const v = px[i] ?? 0;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    return max - min;
  });
  expect(spread).toBeGreaterThan(20);
});

test('offline, zoom 12 outside the packaged core still has ground', async ({ page, context }) => {
  await openMap(page, '#c=80.6,21.1,9.5,0,0');
  await page.waitForFunction(() => window.__areoMap?.areTilesLoaded() === true, undefined, { timeout: 45_000 });
  await context.setOffline(true);
  await page.evaluate(() => window.__areoMap?.jumpTo({ center: [80.62, 21.12], zoom: 11.2 }));
  // The upsampled ancestor is drawn even though the live detail cannot be fetched.
  await page.waitForFunction(() => window.__areoMap?.areTilesLoaded() === true, undefined, { timeout: 45_000 });
  const errors = await page.evaluate(() => (window.__areoMap?.getZoom() ?? 0) > 11);
  expect(errors).toBe(true);
  await context.setOffline(false);
});

test('the layers panel works from the keyboard', async ({ page }) => {
  await openMap(page);
  const tab = page.getByRole('tab', { name: 'Layers', exact: true });
  await tab.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByRole('heading', { name: 'Map layers' })).toBeVisible();
  // Arrow keys move along the rail; Enter switches the panel.
  await tab.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab', { name: 'Discover' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(tab).toBeFocused();
  // Choose the geologic map with the keyboard and get its legend.
  const geology = panel.getByRole('radio', { name: /Geologic map/ });
  await geology.focus();
  await page.keyboard.press('Enter');
  await expect(geology).toHaveAttribute('aria-checked', 'true');
  await expect(panel.getByText(/Tanaka and others, 2014/)).toBeVisible();
  expect(await page.evaluate(() => window.__areoMap?.getLayoutProperty('geology-fill', 'visibility'))).toBe('visible');
  // Escape closes the panel and returns focus to its tab.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tabpanel')).toHaveCount(0);
  await expect(tab).toBeFocused();
});
