/**
 * What a report holds apart from its seal (W1): a logbook's note questions
 * are sealed as fingerprints, so a test reads the words the way a moderator
 * does, opening the report's written account from the queue.
 */
import { expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

/** A report's held note, opened as a moderator opens it from the written accounts queue. */
export async function heldTextOf(staff: APIRequestContext, ref: string): Promise<string> {
  for (let n = 1; ; n++) {
    const got = await staff.get(`/api/moderation/texts?page=${String(n)}`);
    expect(got.ok(), await got.text()).toBe(true);
    const list = (await got.json()) as {
      items: { ref: string; reference: string | null }[];
      pages: number;
    };
    const item = list.items.find((i) => i.reference === ref);
    if (item) {
      const opened = await staff.post(`/api/moderation/texts/${item.ref}/open`);
      expect(opened.ok(), await opened.text()).toBe(true);
      return ((await opened.json()) as { text: string }).text;
    }
    if (n >= list.pages) throw new Error(`No held note for ${ref}.`);
  }
}
