/**
 * The moderator's report page folds its less-used actions (severity, threat,
 * same incident, evidence, the board, who filed it, the record) into one
 * "More" box (features/moderation/Item.tsx). A test that reaches one opens
 * it first, as a moderator would.
 */
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function openMore(page: Page): Promise<void> {
  const more = page.locator('details.more');
  await expect(more).toBeVisible();
  if ((await more.getAttribute('open')) === null) {
    await more.locator('summary').click();
  }
  await expect(more).toHaveAttribute('open', '');
}
