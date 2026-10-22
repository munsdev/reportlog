/**
 * The site menu, as a person uses it (docs/design/navigation.md): the Menu
 * button in the header, the panel (desktop) or the sheet (phone, below
 * 768px), and the staff areas, which fold on a phone.
 *
 * Every browser test that goes somewhere "from the menu" goes through here,
 * so the next change to the menu's shape is one file's change.
 */
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/** The menu, opened if it is not open already. */
export async function openMenu(page: Page): Promise<Locator> {
  const nav = page.getByRole('navigation', { name: 'Main menu' });
  if (!(await nav.isVisible())) {
    await page.getByRole('banner').getByRole('button', { name: /Menu$/ }).click();
  }
  await expect(nav).toBeVisible();
  return nav;
}

/** Whether this page is the phone's shape (the sheet, with folding areas). */
export function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 768;
}

/**
 * A link in the menu, the menu opened and, on a phone, the area holding it
 * unfolded. `area` names the staff area for a staff page; leave it out for
 * anything else (a public link, the "You" row).
 */
export async function menuLink(
  page: Page,
  name: string | RegExp,
  { area }: { area?: string } = {},
): Promise<Locator> {
  const nav = await openMenu(page);
  if (area && isPhone(page)) {
    const fold = nav.getByRole('button', { name: area, exact: true });
    if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
  }
  return nav.getByRole('link', { name: typeof name === 'string' ? named(name) : name });
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A menu link's name: its label, then, when work is waiting there, the
 * count's words after a comma ("Queue, 2 reports waiting for a moderator").
 */
export function named(label: string): RegExp {
  // The browser joins the label and the count's hidden words with a space
  // ("Queue , 2 reports…"), so the space is allowed before the comma.
  return new RegExp(`^${escape(label)}\\s*(,|$)`);
}

/** Go somewhere from the menu, as a person would. */
export async function goViaMenu(
  page: Page,
  name: string | RegExp,
  options: { area?: string } = {},
): Promise<void> {
  await (await menuLink(page, name, options)).click();
  await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeHidden();
}

/** Sign out from the menu, and see the visitor's menu come back. */
export async function signOut(page: Page): Promise<void> {
  const nav = await openMenu(page);
  await nav.getByRole('button', { name: 'Sign out' }).click();
  await expect(nav).toBeHidden();
  const after = await openMenu(page);
  await expect(after.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await page.keyboard.press('Escape');
}
