/**
 * Getting around, as a person does (docs/design/navigation.md):
 *
 *   - On the PUBLIC site, the Menu button in the header opens the panel
 *     (desktop) or the sheet (phone, below 768px). For somebody with staff
 *     pages it has one staff link, "Your dashboard".
 *   - In the STAFF AREA (features/nav/StaffShell.tsx) the staff pages are in
 *     the sidebar, which on a phone is a drawer behind "Menu" in the
 *     top bar; the person's own links and Sign out are in the account menu.
 *
 * Every browser test that goes somewhere "from the menu" goes through here,
 * so the next change to either shape is one file's change.
 */
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { ALL_PAGES } from './navigation-table.ts';

/** The public menu, opened if it is not open already. */
export async function openMenu(page: Page): Promise<Locator> {
  const nav = page.getByRole('navigation', { name: 'Main menu' });
  if (!(await nav.isVisible())) {
    await page.getByRole('banner').getByRole('button', { name: /Menu$/ }).click();
  }
  await expect(nav).toBeVisible();
  return nav;
}

/** Whether this page is the phone's shape (the sheet; the staff drawer). */
export function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 768;
}

/** Whether this page is drawn in the staff area's frame. */
export async function inStaffArea(page: Page): Promise<boolean> {
  // Past the gate first: until it has answered, neither frame is drawn.
  await expect(page.getByRole('banner').first()).toBeVisible();
  return (await page.locator('[data-staff-app]').count()) > 0;
}

/**
 * The staff sidebar: entered from the public menu's "Your dashboard"
 * when not in the staff area already, and on a phone, its drawer opened.
 */
export async function staffNav(page: Page): Promise<Locator> {
  if (!(await inStaffArea(page))) {
    const menu = await openMenu(page);
    await menu.getByRole('link', { name: /^Your dashboard/ }).click();
    await expect(page.locator('[data-staff-app]')).toBeVisible();
  }
  const sidebar = page.getByRole('navigation', { name: 'Your pages' });
  // The staff sidebar is a drawer below 900px, the mock-up's breakpoint.
  if ((page.viewportSize()?.width ?? 1280) < 900) {
    const button = page.getByRole('banner').getByRole('button', { name: 'Menu' });
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  }
  await expect(sidebar).toBeVisible();
  return sidebar;
}

/** The staff area's account menu, opened. */
export async function accountMenu(page: Page): Promise<Locator> {
  const button = page.getByRole('banner').getByRole('button', { name: /^Account:/ });
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  const panel = page.locator('#staff-account');
  await expect(panel).toBeVisible();
  return panel;
}

const STAFF_PAGES = new Set(ALL_PAGES.map((p) => p.label));
const ACCOUNT_LINKS = new Set([
  'My reports',
  'Email updates',
  'Your account',
  'Account and security',
]);

/**
 * A link, wherever a person would find it from here: a staff page in the
 * staff sidebar (entering the staff area first if need be); the person's own
 * links in the account menu inside the staff area; anything else in the
 * public menu. `area` says it is a staff page; it is kept so a call reads as
 * where the page is.
 */
export async function menuLink(
  page: Page,
  name: string | RegExp,
  { area }: { area?: string } = {},
): Promise<Locator> {
  const label = typeof name === 'string' ? name : null;
  const pattern = label === null ? (name as RegExp) : named(label);
  const staffPage = Boolean(area) || (label !== null && STAFF_PAGES.has(label));
  if (await inStaffArea(page)) {
    if (label !== null && ACCOUNT_LINKS.has(label))
      return (await accountMenu(page)).getByRole('link', { name: pattern });
    return (await staffNav(page)).getByRole('link', { name: pattern });
  }
  if (staffPage) return (await staffNav(page)).getByRole('link', { name: pattern });
  return (await openMenu(page)).getByRole('link', { name: pattern });
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

/** Go somewhere from the menu or the sidebar, as a person would. */
export async function goViaMenu(
  page: Page,
  name: string | RegExp,
  options: { area?: string } = {},
): Promise<void> {
  await (await menuLink(page, name, options)).click();
  await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeHidden();
  await expect(page.locator('#staff-drawer')).toHaveCount(0);
}

/**
 * A tab in a row of tabs, made reachable: on a phone the row is one
 * dropdown, and on a narrow desktop the tab may be under "More".
 */
export async function tabLink(page: Page, row: string, name: string): Promise<Locator> {
  const nav = page.getByRole('navigation', { name: row });
  await expect(nav).toBeVisible();
  const link = nav.getByRole('link', { name, exact: true });
  if (!(await link.isVisible())) {
    const toggle = nav.getByRole('button', { expanded: false });
    if ((await toggle.count()) > 0) await toggle.last().click();
  }
  return link;
}

/** Sign out from the account menu or the public menu, and see the visitor's menu come back. */
export async function signOut(page: Page): Promise<void> {
  if (await inStaffArea(page)) {
    const panel = await accountMenu(page);
    await panel.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.locator('[data-staff-app]')).toHaveCount(0);
  } else {
    const nav = await openMenu(page);
    await nav.getByRole('button', { name: 'Sign out' }).click();
    await expect(nav).toBeHidden();
  }
  const after = await openMenu(page);
  await expect(after.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await page.keyboard.press('Escape');
}
