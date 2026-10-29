/**
 * The strip that opens under an edited settings panel (mockup/SaveBar.tsx):
 * a region named "Unsaved changes", with Save and Cancel. Every browser test
 * that saves a panel finds it here, so the next rename is one file's change.
 */
import type { Locator, Page } from '@playwright/test';

export function saveBar(page: Page): Locator {
  return page.getByRole('region', { name: 'Unsaved changes' });
}

/** Press the bar's Save. */
export async function saveChanges(page: Page): Promise<void> {
  await saveBar(page).getByRole('button', { name: 'Save', exact: true }).click();
}
