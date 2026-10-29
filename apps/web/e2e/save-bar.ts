/**
 * The strip that opens under an edited settings panel (mockup/SaveBar.tsx):
 * a region named "Unsaved changes", with Save and Cancel. Every browser test
 * that saves a panel finds it here, so the next rename is one file's change.
 */
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

export function saveBar(page: Page): Locator {
  return page.getByRole('region', { name: 'Unsaved changes' });
}

/**
 * Press the bar's Save and wait for the answer: Save is busy until the server
 * has said yes (the panel closes) or no (the panel stays open, saying why).
 */
export async function saveChanges(page: Page): Promise<void> {
  const bar = saveBar(page);
  await bar.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(bar.locator('[aria-busy="true"]')).toHaveCount(0);
}
