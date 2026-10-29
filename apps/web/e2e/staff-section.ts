/**
 * The staff sidebar's sections (features/nav/StaffShell.tsx) fold: only the
 * one holding the current page, and any with work waiting, start open. A
 * person going to a page in another section opens that section first, and
 * so does a test, before it goes there from the menu (menu.ts).
 */
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { staffNav } from './menu.ts';

export async function openStaffSection(page: Page, label: string): Promise<void> {
  const nav = await staffNav(page);
  const section = nav
    .getByRole('group')
    .filter({ has: page.getByRole('heading', { name: label, exact: true }) });
  const title = section.getByRole('heading', { name: label, exact: true });
  if (!(await section.evaluate((d) => (d as HTMLDetailsElement).open))) await title.click();
  await expect(section).toHaveJSProperty('open', true);
}
