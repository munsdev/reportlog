/**
 * What a fixed page is made of until somebody saves it: the blocks that
 * reproduce the page as it shipped, derived from the page wording, the front
 * page sections and the contact copy rows. So the first save starts from
 * what is on screen, and a site that never edits a page sees no change.
 *
 * Generic ReportLog wording only: anything particular to a deployment comes
 * from that deployment's own copy rows.
 */
import type { Block, PageId } from '@reportlog/contracts';
import type { Database } from '../db/database.ts';
import { publicSite } from '../site/site.ts';

const block = (
  id: string,
  type: Block['type'],
  variant: string,
  fields: Block['fields'],
  shown = true,
): Block => ({ id, type, variant, fields, shown });

export async function defaultBlocks(db: Database, page: PageId): Promise<Block[]> {
  switch (page) {
    case 'home':
      return homeBlocks(db);
    // About and Get involved are built later; until then they have no blocks.
    case 'about':
    case 'get-involved':
      return [];
  }
}

/**
 * The front page's blocks are, for now, its headline block only; the quieter
 * sections, buttons and call to action keep their own settings.
 */
async function homeBlocks(db: Database): Promise<Block[]> {
  const { copy } = await publicSite(db);
  return [block('hero', 'hero', 'action', { headline: copy.home_headline, line: copy.home_lede })];
}
