import { expect, test } from '@playwright/test';

const PLAN = '#c=77.41,18.46,12.3,0,0&from=77.4509,18.4446;Base&stops=77.42,18.452~s45|77.405,18.458~p10';

test('a two-leg mission finds, merges and labels its routes', async ({ page }) => {
  await page.goto(`/${PLAN}`);
  const plan = page.getByRole('region', { name: 'Mission plan' });
  await expect(plan).toBeVisible();
  await expect(plan.getByText('2 stops, 2 tasks')).toBeVisible();
  await page.waitForFunction(() => window.__areo?.getState().route.status === 'ready', undefined, { timeout: 60_000 });
  const route = await page.evaluate(() => {
    const r = window.__areo?.getState().route;
    if (r?.status !== 'ready') return null;
    return {
      labels: r.alternatives.map((a) => a.label),
      styles: r.alternatives.flatMap((a) => a.styles).sort(),
      // Out to stop 1, on to stop 2, and home: three legs joined.
      stops: r.alternatives[0]?.stopIndices.length,
      dist: r.alternatives[0]?.trip.totals.distM ?? 0,
      ends: [r.alternatives[0]?.path[0], r.alternatives[0]?.path.at(-1)],
    };
  });
  expect(route?.styles).toEqual(['eco', 'fastest', 'safest']);
  expect(route?.stops).toBe(4);
  expect(route?.dist).toBeGreaterThan(5000);
  expect(route?.dist).toBeLessThan(14_000);
  // A round trip ends where it began.
  expect(route?.ends[0]?.[0]).toBeCloseTo(77.4509, 2);
  expect(route?.ends[1]?.[0]).toBeCloseTo(77.4509, 2);
  for (const label of route?.labels ?? []) await expect(plan.getByText(label, { exact: false }).first()).toBeVisible();
  await expect(plan.getByText('Distance')).toBeVisible();
});

test('the mission editor adds, edits, reorders and removes, with undo', async ({ page }) => {
  await page.goto(`/${PLAN}`);
  const plan = page.getByRole('region', { name: 'Mission plan' });
  await expect(plan).toBeVisible();

  // Add a task to stop 1 and change its length.
  await plan.getByRole('button', { name: /^18\.452/ }).click();
  await plan.getByRole('button', { name: 'Add a task' }).click();
  await page.getByRole('menuitem', { name: /Survey the site/ }).click();
  await expect(plan.getByText('2 stops, 3 tasks')).toBeVisible();
  const minutes = plan.getByRole('spinbutton', { name: 'Minutes for Survey the site' });
  await minutes.fill('30');
  // Durations are set with non-breaking spaces, which \\s matches.
  await expect(plan.getByText(/1\sh\s25\smin of work/)).toBeVisible();

  // Reorder with the keyboard: pick stop 1 up, move it down, drop it.
  const before = await page.evaluate(() => window.__areo?.getState().plan.stops.map((s) => s.lon));
  await plan.getByRole('button', { name: /^Move stop 1/ }).focus();
  // The drag library measures the list after each key, so the keys are spaced like a person's.
  await page.keyboard.press('Space');
  await page.waitForTimeout(450);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(450);
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__areo?.getState().plan.stops.map((s) => s.lon))).toEqual([...(before ?? [])].reverse());

  // Remove a stop, then undo.
  await plan.getByRole('button', { name: 'Remove stop 2' }).click();
  await expect(plan.getByText(/^1 stop,/)).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(plan.getByText(/^2 stops,/)).toBeVisible();

  // Add a stop by clicking the map.
  await plan.getByRole('button', { name: 'Add a stop' }).click();
  await expect(page.getByText('Click the map to add a stop')).toBeVisible();
  const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.6);
  await expect(plan.getByText(/^3 stops,/)).toBeVisible();
  // The plan is in the link.
  await expect.poll(() => (page.url().match(/\|/g) ?? []).length).toBe(2);
});

test('a stop outside the region explains itself instead of hanging', async ({ page }) => {
  await page.goto('/#c=77.45,18.44,7,0,0&from=77.4509,18.4446&stops=95,18.4');
  const plan = page.getByRole('region', { name: 'Mission plan' });
  await expect(plan.getByRole('alert')).toBeVisible({ timeout: 60_000 });
  await expect(plan.getByRole('alert')).toContainText(/Leg 1 has no route/);
  expect(await page.evaluate(() => window.__areo?.getState().route.status)).toBe('failed');
});

test('the camera flies the route, names the next stop, and gives the view back', async ({ page }) => {
  await page.goto(`/${PLAN}`);
  const plan = page.getByRole('region', { name: 'Mission plan' });
  await page.waitForFunction(() => window.__areo?.getState().route.status === 'ready', undefined, { timeout: 60_000 });
  const before = await page.evaluate(() => ({ pitch: window.__areoMap?.getPitch() ?? -1, zoom: window.__areoMap?.getZoom() ?? -1 }));

  await plan.getByRole('button', { name: 'Fly along the route' }).click();
  const bar = page.getByRole('status').filter({ hasText: 'Next' });
  // Stops are named after what the visitor called them; this plan's stops have no names.
  await expect(bar).toContainText(/Next (stop 1|Base)/);
  await expect.poll(() => page.evaluate(() => window.__areoMap?.getPitch() ?? 0), { timeout: 20_000 }).toBeGreaterThan(55);
  // It moves: the distance to the next stop falls.
  const first = await page.evaluate(() => window.__areo?.getState().flyover?.remainingM ?? 0);
  await expect.poll(() => page.evaluate(() => window.__areo?.getState().flyover?.remainingM ?? 0), { timeout: 30_000 }).toBeLessThan(first - 20);

  await bar.getByRole('button', { name: 'Stop' }).click();
  await expect(bar).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__areoMap?.getPitch() ?? 99), { timeout: 20_000 }).toBeLessThan(before.pitch + 1);
  await expect.poll(() => page.evaluate(() => window.__areoMap?.getZoom() ?? 0)).toBeCloseTo(before.zoom, 1);
});

test('a click on the route adds a stop along the way, and a pin can be dragged', async ({ page }) => {
  await page.goto(`/${PLAN}`);
  await page.waitForFunction(() => window.__areo?.getState().route.status === 'ready', undefined, { timeout: 60_000 });
  // The middle of the second leg, between stop 1 and stop 2, as a point on the screen.
  const target = await page.evaluate(() => {
    const r = window.__areo?.getState().route;
    const map = window.__areoMap;
    if (r?.status !== 'ready' || !map) return null;
    const alt = r.alternatives.find((a) => a.id === r.selected) ?? r.alternatives[0];
    if (!alt) return null;
    const mid = Math.round(((alt.stopIndices[1] ?? 0) + (alt.stopIndices[2] ?? 0)) / 2);
    const p = alt.path[mid];
    if (!p) return null;
    const px = map.project([p[0], p[1]]);
    const box = map.getCanvas().getBoundingClientRect();
    return { x: box.left + px.x, y: box.top + px.y, lon: p[0], lat: p[1] };
  });
  if (!target) throw new Error('no route');
  // The route has to be drawn before it can be clicked.
  await page.waitForFunction(
    ([x, y]) => {
      const map = window.__areoMap;
      if (!map || x === undefined || y === undefined) return false;
      const box = map.getCanvas().getBoundingClientRect();
      return map.queryRenderedFeatures([x - box.left, y - box.top], { layers: ['route-line'] }).length > 0;
    },
    [target.x, target.y],
  );
  await page.mouse.click(target.x, target.y);
  await expect.poll(() => page.evaluate(() => window.__areo?.getState().plan.stops.length)).toBe(3);
  // It went in between the two stops it lies between, on the route.
  const added = await page.evaluate(() => window.__areo?.getState().plan.stops[1]);
  expect(added?.lon).toBeCloseTo(target.lon, 3);
  expect(added?.lat).toBeCloseTo(target.lat, 3);
  await expect(page.getByRole('region', { name: 'Mission plan' }).getByText('3 stops, 2 tasks')).toBeVisible();

  // Drag the first stop's pin a little north-east: the stop moves and the route is worked out again.
  await page.waitForFunction(() => window.__areo?.getState().route.status === 'ready', undefined, { timeout: 60_000 });
  const before = await page.evaluate(() => window.__areo?.getState().plan.stops[0]);
  const pin = page.locator('.route-pin-stop').first();
  const box = await pin.boundingBox();
  if (!box) throw new Error('no pin');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 50, box.y - 40, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__areo?.getState().plan.stops[0]?.lat ?? 0)).toBeGreaterThan((before?.lat ?? 0) + 0.0005);
  expect(await page.evaluate(() => window.__areo?.getState().plan.stops.length)).toBe(3);
});
