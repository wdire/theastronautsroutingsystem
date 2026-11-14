import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const sheetTop = (page: import('@playwright/test').Page, name: RegExp) =>
  page
    .getByRole('button', { name })
    .boundingBox()
    .then((b) => b?.y ?? -1);

test('on a phone the panels are sheets over a bottom bar, and nothing spills off the screen', async ({ page }) => {
  await page.goto('/#c=77.45,18.44,11.5,0,0');
  await page.waitForFunction(() => window.__areo?.getState().mode === 'map' && Boolean(window.__areoMap));

  const nav = page.getByRole('navigation', { name: 'Panels' });
  await expect(nav.getByRole('button')).toHaveText(['Plan', 'Layers', 'Discover', 'Missions', 'How']);
  // Every bar item is a full touch target.
  for (const box of await nav.getByRole('button').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect))) {
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  // A panel opens half way and leaves the map visible above it.
  await nav.getByRole('button', { name: 'Layers' }).click();
  await expect(page.getByRole('heading', { name: 'Map layers' })).toBeVisible();
  const handle = /Panel: half height/;
  await expect(page.getByRole('button', { name: handle })).toBeVisible();
  // The sheet slides into place: wait for it to settle between a third and a little over half way down.
  await expect.poll(() => sheetTop(page, handle)).toBeGreaterThan(300);
  await expect.poll(() => sheetTop(page, handle)).toBeLessThan(460);

  // The handle steps it to full height, where it still stops below the search box.
  await page.getByRole('button', { name: handle }).click();
  await expect(page.getByRole('button', { name: /Panel: full height/ })).toBeVisible();
  await expect.poll(() => sheetTop(page, /Panel: full height/)).toBeLessThan(120);
  expect(await sheetTop(page, /Panel: full height/)).toBeGreaterThan(56);
  await expect(page.getByRole('combobox', { name: 'Search places or coordinates' })).toBeVisible();

  // Another bar item swaps the panel; the same item again closes it.
  await nav.getByRole('button', { name: 'Discover' }).click();
  await expect(page.getByRole('heading', { name: 'Discover', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Map layers' })).toHaveCount(0);
  await nav.getByRole('button', { name: 'Discover' }).click();
  await expect(page.getByRole('heading', { name: 'Discover', exact: true })).toHaveCount(0);
});

test('on a phone, picking a point on the map moves the mission plan out of the way', async ({ page }) => {
  await page.goto('/#c=77.45,18.44,12.5,0,0');
  await page.waitForFunction(() => window.__areo?.getState().mode === 'map' && Boolean(window.__areoMap));
  await page.getByRole('navigation', { name: 'Panels' }).getByRole('button', { name: 'Plan' }).click();
  const plan = page.getByRole('region', { name: 'Mission plan' });
  await expect(plan).toBeVisible();

  await plan.getByRole('button', { name: /on the map/i }).first().click();
  await expect(page.getByRole('status')).toContainText('Tap the map');
  await expect(page.getByRole('button', { name: /Mission plan: small/ })).toBeVisible();
  // The sheet is down at its small stop: most of the map can be tapped.
  await expect.poll(() => sheetTop(page, /Mission plan: small/)).toBeGreaterThan(600);

  await page.touchscreen.tap(195, 330);
  await expect.poll(() => page.evaluate(() => window.__areo?.getState().plan.start !== null)).toBe(true);
  await expect(page.getByRole('button', { name: /Mission plan: half height/ })).toBeVisible();
});
