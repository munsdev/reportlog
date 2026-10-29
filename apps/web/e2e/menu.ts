/**
 * Getting around, as a person does (docs/design/navigation.md):
 *
 *   - On the PUBLIC site, MENU in the header opens the "Site menu" dialog
 *     (mockup/SiteMenu.tsx). For somebody with staff pages it has one staff
 *     link, "Your dashboard".
 *   - In the STAFF AREA (features/nav/StaffShell.tsx) the staff pages, and
 *     the person's own pages (My reports, Email updates, ...), are in the
 *     "Staff areas" sidebar, which below 900px is the "Staff menu" drawer
 *     behind MENU in the top bar. The account chip is one link.
 *
 * Every browser test that goes somewhere "from the menu" goes through here,
 * so the next change to either shape is one file's change.
 */
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { ALL_PAGES } from './navigation-table.ts';

/**
 * The menu button's name: "MENU", then, when reports wait, the count's words
 * ("MENU. 3 reports waiting for a moderator."). The same in both frames.
 */
export const MENU_BUTTON = /^menu\b/i;

/** The public menu, opened if it is not open already. */
export async function openMenu(page: Page): Promise<Locator> {
  const menu = page.getByRole('dialog', { name: 'Site menu' });
  if (!(await menu.isVisible())) {
    await page.getByRole('banner').getByRole('button', { name: MENU_BUTTON }).click();
  }
  await expect(menu).toBeVisible();
  return menu;
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
  // The sidebar is the "Staff menu" drawer below 900px, the mock-up's
  // breakpoint; the desktop sidebar is still in the page, hidden, so the one
  // that shows is the one asked for.
  if ((page.viewportSize()?.width ?? 1280) < 900) {
    const button = page.getByRole('banner').getByRole('button', { name: MENU_BUTTON });
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
    await expect(page.getByRole('dialog', { name: 'Staff menu' })).toBeVisible();
  }
  const sidebar = page
    .getByRole('navigation', { name: 'Staff areas' })
    .filter({ visible: true })
    .first();
  await expect(sidebar).toBeVisible();
  await openGroups(sidebar);
  return sidebar;
}

/**
 * The sidebar's groups fold (`<details>`); only the current page's is open.
 * A person opens a group to reach a page in it: so does this, every one.
 */
export async function openGroups(sidebar: Locator): Promise<void> {
  const shut = sidebar.locator('details:not([open]) > summary');
  for (let n = await shut.count(); n > 0; n = await shut.count()) {
    await shut.first().click();
    await expect(shut).toHaveCount(n - 1);
  }
}

/**
 * Where the person's own pages are in the staff area: the sidebar, since the
 * redesign replaced the account menu with one link (the account chip).
 */
export async function accountMenu(page: Page): Promise<Locator> {
  return staffNav(page);
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
    // Beside the sections, not among them: at the foot of the desktop sidebar,
    // or at the top of the phone's drawer.
    await accountMenu(page);
    await page
      .getByRole('complementary', { name: 'Staff areas' })
      .or(page.getByRole('dialog', { name: 'Staff menu' }))
      .filter({ visible: true })
      .getByRole('button', { name: 'Sign out' })
      .click();
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
