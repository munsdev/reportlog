/**
 * A titled panel (mockup/Panel.tsx): a section with its title as a heading.
 * The redesign's panels carry no accessible name of their own, so they are
 * not landmarks, and a test finds one by its heading: the nearest section or
 * article around the heading with exactly that title.
 */
import type { Locator, Page } from '@playwright/test';

export function panel(scope: Page | Locator, title: string): Locator {
  return scope
    .getByRole('heading', { name: title, exact: true })
    .locator('xpath=ancestor::*[self::section or self::article][1]');
}
