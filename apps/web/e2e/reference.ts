/**
 * The report's reference as the confirmation page shows it
 * (features/form/ConfirmPage.tsx): a card tagged "Its reference" with the
 * reference on a line of its own.
 */
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/** The line holding the reference, under its "Its reference" tag. */
export function referenceLine(page: Page): Locator {
  return page
    .getByText('Its reference', { exact: true })
    .locator('..')
    .getByText(/^RL-\S+$/);
}

/** The reference the page shows, read once it is there. */
export async function shownReference(page: Page): Promise<string> {
  const line = referenceLine(page);
  await expect(line).toBeVisible();
  const ref = ((await line.textContent()) ?? '').trim();
  expect(ref).toMatch(/^RL-\S+$/);
  return ref;
}
