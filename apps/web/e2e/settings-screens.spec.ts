/**
 * The site settings screens in a real browser (docs/design/checks.md §03,
 * SETTINGS, and the axe check on the settings overview and Look in every
 * named look):
 *
 *   - only one setting panel is open at a time, and opening a second with
 *     changes in the first asks first;
 *   - the Save bar names what it saves, sits at the foot of the screen, and
 *     Escape cancels;
 *   - on Look, choosing a look changes the two previews and nothing else on
 *     the site until "Apply to the site"; "Back to what the site shows"
 *     restores the previews;
 *   - applying a look asks for no step-up, even when one has expired.
 *
 * Applying a look changes the whole site, and the other tests run at the
 * same time, so that test runs on one project only and puts the look back
 * at once. Everything else here only reads, or changes a form it does not
 * save.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { axe, describeViolation } from './a11y.ts';
import { ADMIN } from './auth.ts';
import { identityState } from './identity/mail.ts';
import { signInWithSecondFactor } from './second-factor.ts';

interface PackLook {
  id: string;
  label: string;
  palette: string;
  theme: string;
}
interface Pack {
  looks: PackLook[];
  themes: { id: string; panelHead: string; texture: string }[];
}
/** The built-in pack, read from the file the site's stylesheet is made from. */
const PACK = JSON.parse(
  readFileSync(
    new URL('../../../packages/contracts/src/look/reportlog-core.look.json', import.meta.url),
    'utf8',
  ),
) as Pack;

/** Every named look, and the Easier reading pair on a dark site no named look uses. */
const PAIRS = [
  ...PACK.looks.map((l) => ({ name: l.label, palette: l.palette, theme: l.theme })),
  { name: 'High contrast dark with Commons', palette: 'contrast-dark', theme: 'commons' },
];

/**
 * A named look's radio. On a phone the looks are in two groups, the full
 * chooser and the bar pinned to the bottom; the bar comes last in the page and
 * is the one in view, so `.last()` is the bar there and the only one on a desktop.
 */
/** A look's card: a label over a hidden radio, so the label is what a person clicks. */
function lookRadio(page: Page, name: string | RegExp) {
  return page
    .locator('label')
    .filter({ has: page.getByRole('radio', { name }) })
    .last();
}

/** Paint a look on <html> in the test, not by saving it, with nothing mid-transition. */
async function wear(page: Page, palette: string, theme: string) {
  const t = PACK.themes.find((x) => x.id === theme);
  await page.evaluate(
    ([p, th, head, texture]) => {
      const html = document.documentElement;
      html.setAttribute('data-palette', p ?? '');
      html.setAttribute('data-theme', th ?? '');
      html.setAttribute('data-panel-head', head ?? 'plain');
      html.setAttribute('data-texture', texture ?? 'none');
    },
    [palette, theme, t?.panelHead, t?.texture],
  );
}

async function stillness(page: Page) {
  await page.addStyleTag({
    content: '*,*::before,*::after{transition:none!important;animation:none!important}',
  });
}

const unique = () => `${Date.now().toString(36)}${String(Math.floor(Math.random() * 1e6))}`;

/** An administrator of this file's own, signed in as a person would be. */
async function administrator(browser: Browser): Promise<{ page: Page; email: string }> {
  const email = `e2e-settings-admin-${unique()}@example.org`;
  identityState('seat', email, 'admin');
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  await signInWithSecondFactor(context.request, email);
  return { page: await context.newPage(), email };
}

test.describe('as an administrator', () => {
  test.use({ storageState: ADMIN });

  test('one panel at a time: opening a second with changes in the first asks first', async ({
    page,
  }) => {
    await page.goto('/settings/legal');
    const imprint = page.getByRole('region', { name: 'Imprint' });
    const privacy = page.getByRole('region', { name: 'Privacy policy' });
    await imprint.getByRole('button', { name: 'Change Imprint' }).click();
    // The end of the whole text, not of its first line.
    await page.getByRole('textbox', { name: 'Imprint' }).press('ControlOrMeta+End');
    await page.getByRole('textbox', { name: 'Imprint' }).pressSequentially(' x');

    await privacy.getByRole('button', { name: 'Change Privacy policy' }).click();
    const ask = page.getByRole('dialog', { name: 'Leave your changes to Imprint?' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByRole('textbox', { name: 'Imprint' })).toHaveValue(/ x$/);
    await expect(page.getByRole('textbox', { name: 'Privacy policy' })).toHaveCount(0);

    await privacy.getByRole('button', { name: 'Change Privacy policy' }).click();
    await page
      .getByRole('dialog', { name: 'Leave your changes to Imprint?' })
      .getByRole('button', { name: 'Leave them' })
      .click();
    await expect(page.getByRole('textbox', { name: 'Privacy policy' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Imprint' })).toHaveCount(0);
  });

  test('the Save bar names what it saves, sits at the foot of the screen, and Escape cancels', async ({
    page,
  }) => {
    await page.goto('/settings/legal');
    await page.getByRole('button', { name: 'Change Privacy policy' }).click();
    const bar = page.getByRole('region', { name: 'Unsaved changes' });
    await expect(bar).toContainText('Changes to Privacy policy are not saved.');
    const box = await bar.boundingBox();
    const viewport = page.viewportSize();
    // Floating 12px above the foot (site.css .savebar), in view without scrolling.
    expect(box && viewport ? Math.round(viewport.height - (box.y + box.height)) : -1).toBe(12);

    // Escape with nothing changed closes it; with a change, it asks first.
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
    await page.getByRole('button', { name: 'Change Privacy policy' }).click();
    await page.getByRole('textbox', { name: 'Privacy policy' }).pressSequentially('x');
    await page.getByRole('textbox', { name: 'Privacy policy' }).blur();
    await page.keyboard.press('Escape');
    await page
      .getByRole('dialog', { name: 'Leave your changes to Privacy policy?' })
      .getByRole('button', { name: 'Leave them' })
      .click();
    await expect(bar).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Privacy policy' })).toHaveCount(0);
  });

  test('on Look, choosing a look changes the previews and nothing else; Back puts them back', async ({
    page,
  }) => {
    await page.goto('/settings/look');
    const status = page.getByRole('status').filter({ hasText: /The site is (still )?showing/ });
    await expect(status).toBeVisible();
    const html = page.locator('html');
    const before = await html.getAttribute('data-palette');
    // One frame since 28 Oct: the site itself, at a desktop's or a phone's width.
    const frame = page.locator('.live-preview iframe');

    let writes = 0;
    page.on('request', (r) => {
      if (r.method() !== 'GET' && r.url().includes('/api/')) writes += 1;
    });
    await lookRadio(page, 'Green screen').click();
    await expect(status).toContainText('You are previewing Green screen.');
    // The preview is painted by naming the look on its own document.
    await expect(frame.contentFrame().locator('html')).toHaveAttribute('data-palette', 'phosphor');
    await expect(frame.contentFrame().locator('html')).toHaveAttribute('data-theme', 'console');
    // The page the administrator is using does not repaint, and nothing is sent.
    expect(await html.getAttribute('data-palette')).toBe(before);
    expect(writes).toBe(0);

    // Beside the status on a desktop; in the bar at the foot on a phone.
    await page.getByRole('button', { name: /^Back( to what the site shows)?$/ }).click();
    await expect(status).not.toContainText('previewing');
    await expect(frame.contentFrame().locator('html')).not.toHaveAttribute(
      'data-palette',
      'phosphor',
    );
    expect(writes).toBe(0);
  });

  test('on Look, the previews stay in view while the looks scroll (desktop), or a bar of looks stays pinned (phone)', async ({
    page,
  }) => {
    await page.goto('/settings/look');
    await expect(page.getByRole('status').filter({ hasText: /The site is/ })).toBeVisible();
    const inView = async (selector: string) => {
      const box = await page.locator(selector).boundingBox();
      const height = page.viewportSize()?.height ?? 0;
      return box !== null && box.y >= 0 && box.y + box.height <= height + 1;
    };
    // Far enough down that the first screen's content has gone.
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(300);
    // The preview is pinned at every width (beside the looks from 1100px,
    // above them below that).
    await expect.poll(() => inView('.live-preview iframe')).toBe(true);
    await lookRadio(page, 'Green screen').click();
    await expect(page.getByRole('status').filter({ hasText: /previewing/ })).toHaveCount(1);
    if ((page.viewportSize()?.width ?? 0) < 900) {
      // On a phone the decision is a bar pinned at the foot.
      await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeInViewport();
    }
  });

  test('the overview and Look pass the accessibility check in every look', async ({ page }) => {
    test.setTimeout(240_000);
    for (const path of ['/settings', '/settings/look']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      await stillness(page);
      for (const pair of PAIRS) {
        await wear(page, pair.palette, pair.theme);
        const found = await axe(page);
        expect(
          found.violations.map(describeViolation),
          `${path} in ${pair.name} (${pair.palette} with ${pair.theme})`,
        ).toEqual([]);
      }
    }
  });

  test('neither screen asks a third party for anything', async ({ page }) => {
    const outside: string[] = [];
    page.on('request', (r) => {
      const host = new URL(r.url()).hostname;
      if (host !== '127.0.0.1' && host !== 'localhost') outside.push(r.url());
    });
    for (const path of ['/settings', '/settings/look', '/settings/words', '/settings/legal']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
    }
    expect(outside).toEqual([]);
  });
});

test('applying a look asks for no step-up, even with the step-up expired', async ({ browser }) => {
  test.skip(
    test.info().project.name !== 'chromium',
    'changes the whole site’s look; one project at a time',
  );
  const { page, email } = await administrator(browser);
  // As far as the server knows, the second factor was proved long ago.
  identityState('stale-step-up', email);
  const start = (await (await page.request.get('/api/admin/site')).json()) as {
    look: { palette: string; theme: string };
  };
  try {
    await page.goto('/settings/look');
    const target = start.look.palette === 'phosphor' ? 'Campfire' : 'Green screen';
    await lookRadio(page, target).click();
    await page.getByRole('button', { name: 'Apply to the site' }).click();
    await expect(page.getByText('The new look is live.')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Confirm it is you' })).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute(
      'data-palette',
      target === 'Campfire' ? 'campfire' : 'phosphor',
    );
    await expect(lookRadio(page, new RegExp(`^${target}\\s*On the site$`))).toBeChecked();
  } finally {
    const back = await page.request.put('/api/admin/site/look', { data: start.look });
    expect(back.ok(), await back.text()).toBe(true);
    await page.context().close();
  }
});
