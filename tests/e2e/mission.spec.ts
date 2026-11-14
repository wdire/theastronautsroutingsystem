import { expect, test, type Page } from '@playwright/test';

const PLAN = '#c=77.42,18.455,13,0,0&from=77.4509,18.4446;Base&stops=77.4057,18.4586;Wildcat%20Ridge~s45';

/** A short walk: ten minutes of photographs 700 m from the start. */
const SHORT = '#c=77.445,18.446,14,0,0&from=77.4509,18.4446;Base&stops=77.4395,18.4470;Outcrop~p10';

async function start(page: Page, link = PLAN): Promise<void> {
  await page.goto(`/${link}`);
  await page.waitForFunction(() => window.__areo?.getState().route.status === 'ready', undefined, { timeout: 60_000 });
  const plan = page.getByRole('region', { name: 'Mission plan' });
  // The budget says whether the plan works before anyone sets off.
  await expect(plan.getByText('This plan works.')).toBeVisible();
  await expect(plan.getByText('Oxygen', { exact: true })).toBeVisible();
  await plan.getByRole('button', { name: 'Start the mission' }).click();
  await expect(page.getByRole('region', { name: 'Mission', exact: true })).toBeVisible();
}

const crewDist = (page: Page) =>
  page.evaluate(() => {
    const w = window.__areo?.getState().world;
    if (!w?.run) return -1;
    // Where the crew is along the route, from the progress bar's own value.
    return Number(document.querySelector('[aria-label="Mission progress"]')?.getAttribute('aria-valuenow') ?? -1);
  });

test('Start runs the mission by itself, faster on request, and the tasks get done', async ({ page }) => {
  await start(page, SHORT);
  const panel = page.getByRole('region', { name: 'Mission', exact: true });
  await expect(panel.getByText(/Walking to Outcrop/)).toBeVisible();
  // The app clock is now the mission clock.
  expect(await page.evaluate(() => window.__areo?.getState().clockLive)).toBe(false);

  await panel.getByRole('radio', { name: '100×' }).click();
  await expect.poll(() => crewDist(page), { timeout: 60_000 }).toBeGreaterThan(20);
  // At the stop the crew works its task, then the task is done.
  await expect(panel.getByText(/tasks 1 of 1/)).toBeVisible({ timeout: 90_000 });
  // A round trip ends at home with a result.
  await expect(panel.getByText('Mission over')).toBeVisible({ timeout: 120_000 });
  await expect(panel.getByText(/1 of 1 tasks done/)).toBeVisible();
  await panel.getByRole('button', { name: 'Back to planning' }).click();
  await expect(panel).toHaveCount(0);
  expect(await page.evaluate(() => window.__areo?.getState().clockLive)).toBe(true);
});

test('a dust devil on the route proposes a way round, shows it, and the crew takes it', async ({ page }) => {
  await start(page);
  await page.evaluate(() => window.__areoSim?.speed(5));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__areoSim?.force('dustDevil'));

  const alert = page.getByRole('status', { name: /Caution: Dust devil ahead/ });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/crosses the route/);
  const before = await page.evaluate(() => window.__areo?.getState().world?.run?.path.length ?? 0);
  await alert.getByRole('button', { name: 'Route around it' }).click();

  // The new route is shown, with what it costs, before anything changes.
  await expect(alert.getByText(/A new route, the dashed green line/)).toBeVisible({ timeout: 60_000 });
  expect(await page.evaluate(() => window.__areo?.getState().world?.run?.leg)).toBe(0);
  const proposed = await page.evaluate(() => {
    const s = window.__areo?.getState();
    const hazard = s?.world?.hazards[0];
    if (!s?.proposed || !hazard) return null;
    // How close the proposed route comes to the middle of the dust devil, in metres.
    const R = 3_396_190;
    let nearest = Infinity;
    for (const p of s.proposed.path) {
      const dx = ((p[0] - hazard.lon) * Math.PI) / 180 * R * Math.cos((hazard.lat * Math.PI) / 180);
      const dy = ((p[1] - hazard.lat) * Math.PI) / 180 * R;
      nearest = Math.min(nearest, Math.hypot(dx, dy));
    }
    return { nearest, radius: hazard.radiusM };
  });
  expect(proposed).not.toBeNull();
  expect(proposed?.nearest ?? 0).toBeGreaterThan((proposed?.radius ?? 0) * 0.95);

  await alert.getByRole('button', { name: 'Take this route' }).click();
  await expect(alert).toHaveCount(0);
  // The crew is on the new route, and the radio says what changed.
  await expect.poll(() => page.evaluate(() => window.__areo?.getState().world?.run?.leg)).toBe(1);
  expect(await page.evaluate(() => window.__areo?.getState().world?.run?.path.length ?? 0)).not.toBe(before);
  await page.getByRole('button', { name: /Talk to base/ }).click();
  await expect(page.getByRole('dialog').getByText(/New route/)).toBeVisible();
});

test('the base answers on the radio from the crew’s own numbers', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: /Talk to base/ }).click();
  const radio = page.getByRole('dialog');
  await radio.getByRole('textbox', { name: 'Message to base' }).fill('How is our oxygen?');
  await radio.getByRole('button', { name: 'Send' }).click();
  await expect(radio.getByText('How is our oxygen?')).toBeVisible();
  // The reply takes 30 to 120 simulated seconds; at 100x that is about a second.
  await page.evaluate(() => window.__areoSim?.speed(100));
  await expect(radio.getByText('Base', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(radio.locator('li').filter({ hasText: 'Base' })).toContainText(/\d/);
});
