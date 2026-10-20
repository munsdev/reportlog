/**
 * Heat maps in a real browser: an administrator makes one on the staff
 * screen, turns it on, and a reader sees it; two maps on the front page keep
 * to themselves; and NO PAGE WITH A MAP ASKS ANY OTHER HOST FOR ANYTHING. A
 * tile request would tell a third party which places the readers of an
 * incident archive are looking at.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN } from './auth.ts';

test.use({ storageState: ADMIN });

/** A launched logbook with approved reports in six places (src/maps/dev-state.ts). */
function fixture(): { id: number; slug: string; title: string } {
  const api = fileURLToPath(new URL('../../api/', import.meta.url));
  const out = execFileSync(
    'node',
    ['--env-file-if-exists=../../.env', 'src/maps/dev-state.ts', 'fixture'],
    { cwd: api, encoding: 'utf8' },
  );
  return JSON.parse(out.trim().split('\n').pop() ?? '{}') as {
    id: number;
    slug: string;
    title: string;
  };
}

/** Every request this page makes to a host that is not this site. */
function watchOutside(page: Page): string[] {
  const outside: string[] = [];
  page.on('request', (r) => {
    const host = new URL(r.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
  });
  return outside;
}

/** Every request this page makes for the map outlines (one file, about half a megabyte). */
function watchOutlines(page: Page): string[] {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (/\/outlines[^/]*\.json(\?|$)/.test(new URL(r.url()).pathname)) asked.push(r.url());
  });
  return asked;
}

const unique = (stem: string) =>
  `${stem}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

test('an administrator makes a map, turns it on, and a reader sees it without any other host being asked', async ({
  page,
}) => {
  const outside = watchOutside(page);
  const lb = fixture();
  const slug = unique('e2e-map');
  const title = `Where it happened ${slug}`;

  await page.goto('/maps');
  await expect(page.getByRole('heading', { level: 1, name: 'Maps' })).toBeVisible();

  // Which question places the fixture logbook's reports.
  await page.getByLabel(lb.title).selectOption('where');
  await expect(page.getByLabel(lb.title)).toHaveValue('where');

  await page.getByLabel('Title').first().fill(title);
  await page.getByLabel('Short name').first().fill(slug);
  await page.getByRole('button', { name: 'Make the map' }).click();

  const card = page.getByRole('listitem').filter({ hasText: `/map/${slug}` });
  await expect(card).toContainText('Off');
  await card.getByRole('button', { name: 'Change' }).click();
  const form = card.getByRole('form', { name: `Change ${title}` });

  // A threshold of 1 is refused, in words.
  await form.getByLabel('Threshold').fill('1');
  await form.getByRole('button', { name: 'Save the map' }).click();
  await expect(form).toContainText('A threshold of 1 is the protection switched off');

  await form.getByLabel('Threshold').fill('3');
  await form.getByRole('checkbox', { name: lb.title }).click();
  await form.getByRole('checkbox', { name: 'On: readers can see this map' }).click();
  await form.getByRole('button', { name: 'Save the map' }).click();
  await expect(form.getByRole('status')).toHaveText('Saved.');
  await expect(card).toContainText('On');

  // What it would publish, before a reader sees it.
  await form.getByRole('button', { name: 'What would it publish?' }).click();
  await expect(form.getByRole('status').last()).toContainText('Arizona 4');
  await expect(form.getByRole('status').last()).toContainText('Nevada');

  await card.getByRole('link', { name: 'Open it' }).click();
  await expect(page).toHaveURL(new RegExp(`/map/${slug}$`));
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  const map = page.getByRole('img', { name: `${title}: United States` });
  await expect(map).toBeVisible();

  // Arizona is shaded and says its count; Nevada says only that it is under the threshold.
  await map.locator('path[data-code="US-AZ"]').click();
  await expect(page.getByRole('heading', { level: 3, name: 'Arizona' })).toBeVisible();
  await expect(page.getByText(/^4 published reports$/)).toBeVisible();
  await map.locator('path[data-code="US-NV"]').click();
  await expect(page.getByRole('heading', { level: 3, name: 'Nevada' })).toBeVisible();
  await expect(
    page.getByText(/Fewer than 3 published reports, so this area is not shaded/),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guam <3: fewer than 3, not shown' })).toHaveText(
    /<3/,
  );
  await expect(page.getByRole('button', { name: 'Alaska 3: 3 published reports' })).toBeVisible();

  // Zooming redraws the same outlines; nothing is fetched to do it.
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByRole('button', { name: 'Whole map' })).toBeEnabled();

  // The map's own payload, as the network carried it: Nevada and Wyoming
  // are bare codes, with no count behind them anywhere.
  const res = await page.request.get(`/api/maps/${slug}`);
  const body = await res.text();
  expect(body).toContain('"US-WY"');
  expect(body).not.toMatch(/"US-(NV|WY|GU)"\s*:/);

  expect(outside).toEqual([]);

  // Tidy: a map holds no reports, so deleting it takes nothing else.
  await page.goto('/maps');
  const again = page.getByRole('listitem').filter({ hasText: `/map/${slug}` });
  await again.getByRole('button', { name: 'Change' }).click();
  await again.getByRole('button', { name: 'Delete the map' }).click();
  await again.getByRole('button', { name: 'Yes, delete this map' }).click();
  await expect(page.getByText(`/map/${slug}`)).toHaveCount(0);
  expect((await page.request.get(`/api/maps/${slug}`)).status()).toBe(404);
});

test('two maps on the front page keep to themselves, and the page asks no other host', async ({
  page,
}) => {
  const lb = fixture();
  const api = page.request;
  expect(
    (
      await api.put(`/api/admin/maps/places/logbooks/${String(lb.id)}`, { data: { key: 'where' } })
    ).ok(),
  ).toBe(true);
  const made: { id: number; title: string }[] = [];
  for (const [title, min_area] of [
    [`Strict ${unique('m')}`, 4],
    [`Loose ${unique('m')}`, 2],
  ] as const) {
    const r = await api.post('/api/admin/maps', {
      data: {
        title,
        slug: unique('front'),
        enabled: true,
        min_area,
        slot: 'home',
        logbook_ids: [lb.id],
      },
    });
    expect(r.ok(), await r.text()).toBe(true);
    made.push({ id: ((await r.json()) as { id: number }).id, title });
  }
  try {
    const outside = watchOutside(page);
    const outlines = watchOutlines(page);
    await page.goto('/');
    const [strict, loose] = made.map((m) => page.getByRole('figure').filter({ hasText: m.title }));
    if (!strict || !loose) throw new Error('two maps expected');
    await expect(strict.getByRole('img')).toBeVisible();
    await expect(loose.getByRole('img')).toBeVisible();

    // NOTHING INSIDE EITHER MAP HAS AN ID.
    expect(await strict.locator('[id]').count()).toBe(0);
    expect(await loose.locator('[id]').count()).toBe(0);

    // The same archive at two thresholds: California (3) is shaded on one only.
    await loose.locator('path[data-code="US-CA"]').click();
    await expect(loose.getByRole('heading', { level: 3, name: 'California' })).toBeVisible();
    await expect(loose).toContainText('3 published reports');
    await expect(strict.getByRole('heading', { level: 3 })).toHaveCount(0);
    await strict.locator('path[data-code="US-CA"]').click();
    await expect(strict).toContainText(/Fewer than 4 published reports/);
    // Selecting in one did not move the other.
    await expect(loose.getByRole('heading', { level: 3, name: 'California' })).toBeVisible();
    await expect(loose.locator('path[data-selected="true"]')).toHaveAttribute('data-code', 'US-CA');

    expect(outside).toEqual([]);
    // FETCHED ON FIRST USE AND SHARED: two maps, one download.
    expect(outlines).toHaveLength(1);
  } finally {
    for (const m of made) await api.delete(`/api/admin/maps/${String(m.id)}`);
  }
});

test('the staff screen says "No maps yet." when there are none, and draws no map, so it fetches no outlines', async ({
  page,
}) => {
  const outlines = watchOutlines(page);
  // Other tests leave maps behind in a shared database, so the empty list is
  // the server's answer replaced, and only that one call.
  await page.route('**/api/admin/maps', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const real = await route.fetch();
    const body = (await real.json()) as { slots: unknown };
    return route.fulfill({ json: { maps: [], slots: body.slots } });
  });
  await page.goto('/maps');
  await expect(page.getByRole('heading', { level: 1, name: 'Maps' })).toBeVisible();
  await expect(page.getByText('No maps yet.')).toBeVisible();
  await page.unrouteAll({ behavior: 'wait' });

  // With a map listed, its threshold is said in words, not as a bare number.
  const slug = unique('words');
  const made = await page.request.post('/api/admin/maps', {
    data: { title: `Words ${slug}`, slug, min_area: 4 },
  });
  expect(made.ok(), await made.text()).toBe(true);
  const { id } = (await made.json()) as { id: number };
  try {
    await page.reload();
    const card = page.getByRole('listitem').filter({ hasText: `/map/${slug}` });
    await expect(card).toContainText('an area shows its number at 4 reports or more');
    await expect(card).not.toContainText(/threshold 4/);
    // The editor's preview is words too: nothing on this screen draws a map.
    await page.waitForLoadState('networkidle');
    expect(outlines).toEqual([]);
  } finally {
    await page.request.delete(`/api/admin/maps/${String(id)}`);
  }
});

test('the map editor warns before unsaved changes are lost, and not after they are saved', async ({
  page,
}) => {
  const slug = unique('unsaved');
  const title = `Unsaved ${slug}`;
  const made = await page.request.post('/api/admin/maps', { data: { title, slug } });
  expect(made.ok(), await made.text()).toBe(true);
  const { id } = (await made.json()) as { id: number };
  const asked: string[] = [];
  let answer = false;
  page.on('dialog', (d) => {
    asked.push(d.message());
    void (answer ? d.accept() : d.dismiss());
  });
  try {
    await page.goto('/maps');
    const card = page.getByRole('listitem').filter({ hasText: `/map/${slug}` });
    await card.getByRole('button', { name: 'Change' }).click();
    const form = card.getByRole('form', { name: `Change ${title}` });

    // Ticking a box and unticking it again leaves nothing to lose.
    const world = form.getByRole('checkbox', { name: 'The world, by country' });
    await world.click();
    await world.click();
    await card.getByRole('button', { name: 'Close' }).click();
    await expect(form).toHaveCount(0);
    expect(asked).toEqual([]);

    // A changed threshold is something to lose: closing the editor asks, and "no" keeps it.
    await card.getByRole('button', { name: 'Change' }).click();
    await form.getByLabel('Threshold').fill('5');
    await card.getByRole('button', { name: 'Close' }).click();
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]).toBe(
      `You have changes to the map “${title}” that are not saved. Leave without saving them?`,
    );
    await expect(form.getByLabel('Threshold')).toHaveValue('5');

    // So does leaving the screen, and "no" stays on it.
    await page.getByRole('banner').getByRole('link').first().click();
    await expect.poll(() => asked.length).toBe(2);
    await expect(page).toHaveURL(/\/maps$/);
    await expect(form.getByLabel('Threshold')).toHaveValue('5');

    // Saved, there is nothing to lose, and leaving asks nothing.
    await form.getByRole('button', { name: 'Save the map' }).click();
    await expect(form.getByRole('status')).toHaveText('Saved.');
    await expect(card).toContainText('at 5 reports or more');
    await page.getByRole('banner').getByRole('link').first().click();
    await expect(page).not.toHaveURL(/\/maps$/);
    expect(asked).toHaveLength(2);

    // And "yes" does leave, with the change not saved.
    await page.goto('/maps');
    await card.getByRole('button', { name: 'Change' }).click();
    await form.getByLabel('Title').fill(`${title} renamed`);
    answer = true;
    await page.getByRole('banner').getByRole('link').first().click();
    await expect(page).not.toHaveURL(/\/maps$/);
    expect(asked).toHaveLength(3);
    const after = await page.request.get('/api/admin/maps');
    const maps = ((await after.json()) as { maps: { id: number; title: string }[] }).maps;
    expect(maps.find((m) => m.id === id)?.title).toBe(title);
  } finally {
    await page.request.delete(`/api/admin/maps/${String(id)}`);
  }
});
