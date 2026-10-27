/**
 * Reading and saving a fixed page's blocks (decision 79).
 *
 * Every save pushes a row onto `site_page_edits`, whose `parent` is the edit
 * that was live before it; Undo moves the live pointer back to that parent
 * and restores its blocks. Only the newest twenty rows per page are kept, so
 * Undo reaches twenty saves back. Presentation only: nothing here is sealed,
 * and the seal and chain code may not reach this module.
 */
import { PAGE_UNDO_DEPTH, blockProblem, resolvePageBlocks } from '@reportlog/contracts';
import type { Block, PageEditorState, PageId } from '@reportlog/contracts';
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { HttpError } from '../http/errors.ts';
import { defaultBlocks } from './defaults.ts';

async function live(db: Database, page: PageId) {
  return db
    .selectFrom('site_pages')
    .select(['blocks', 'edit_id'])
    .where('page', '=', page)
    .executeTakeFirst();
}

/** The page's blocks: what was saved, or what ships. */
export async function pageBlocks(
  db: Database,
  page: PageId,
): Promise<{ blocks: Block[]; customised: boolean }> {
  const row = await live(db, page);
  if (row?.blocks) {
    const saved = resolvePageBlocks(row.blocks);
    // A front page saved when it was only a headline (before it was built of
    // blocks) keeps that headline and gets the rest of the page as it ships,
    // once: every later save writes the `eyebrow` key, which marks the new shape.
    if (page === 'home' && isHeadlineOnly(row.blocks)) {
      const rest = resolvePageBlocks(await defaultBlocks(db, page)).filter(
        (b) => b.type !== 'hero',
      );
      return { blocks: [...saved, ...rest], customised: true };
    }
    return { blocks: saved, customised: true };
  }
  return { blocks: resolvePageBlocks(await defaultBlocks(db, page)), customised: false };
}

/** Whether stored blocks are the old shape: only headline blocks, none with the newer `eyebrow` word. */
function isHeadlineOnly(stored: unknown): boolean {
  if (!Array.isArray(stored) || !stored.length) return false;
  return (stored as unknown[]).every((raw) => {
    if (typeof raw !== 'object' || raw === null) return false;
    const b = raw as { type?: unknown; fields?: unknown };
    if (b.type !== 'hero') return false;
    const f = typeof b.fields === 'object' && b.fields !== null ? b.fields : {};
    return !('eyebrow' in f);
  });
}

async function canUndo(db: Database, page: PageId): Promise<boolean> {
  const row = await live(db, page);
  if (!row?.edit_id) return false;
  const edit = await db
    .selectFrom('site_page_edits')
    .select('parent')
    .where('id', '=', row.edit_id)
    .where('page', '=', page)
    .executeTakeFirst();
  if (!edit?.parent) return false;
  const parent = await db
    .selectFrom('site_page_edits')
    .select('id')
    .where('id', '=', edit.parent)
    .where('page', '=', page)
    .executeTakeFirst();
  return Boolean(parent);
}

export async function editorState(db: Database, page: PageId): Promise<PageEditorState> {
  const { blocks, customised } = await pageBlocks(db, page);
  const problems: Record<string, string> = {};
  for (const b of blocks) {
    const p = blockProblem(b);
    if (p) problems[b.id] = p;
  }
  return { page, blocks, customised, problems, can_undo: await canUndo(db, page) };
}

const lock = (page: PageId) => sql`select pg_advisory_xact_lock(hashtext(${'site_pages:' + page}))`;

export async function savePage(
  db: Database,
  page: PageId,
  stored: readonly Block[],
  userId: number | null,
): Promise<void> {
  const blocks = resolvePageBlocks(stored);
  await db.transaction().execute(async (trx) => {
    await lock(page).execute(trx);
    const row = await live(trx, page);
    let parent = row?.edit_id ?? null;
    if (parent === null) {
      // The first save: remember "as shipped" so Undo can get back to it.
      const marker = await trx
        .insertInto('site_page_edits')
        .values({ page, blocks: null, parent: null, saved_by: userId })
        .returning('id')
        .executeTakeFirstOrThrow();
      parent = marker.id;
    }
    const edit = await trx
      .insertInto('site_page_edits')
      .values({ page, blocks: JSON.stringify(blocks), parent, saved_by: userId })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('site_pages')
      .values({ page, blocks: JSON.stringify(blocks), edit_id: edit.id })
      .onConflict((oc) =>
        oc.column('page').doUpdateSet({
          blocks: JSON.stringify(blocks),
          edit_id: edit.id,
          updated_at: sql`now()`,
        }),
      )
      .execute();
    // Keep the newest twenty (and the live one, which Undo may have left behind).
    await sql`
      delete from site_page_edits
      where page = ${page} and id <> ${edit.id}
        and id not in (select id from site_page_edits where page = ${page} order by id desc limit ${PAGE_UNDO_DEPTH})`.execute(
      trx,
    );
  });
}

export async function undoPage(db: Database, page: PageId): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await lock(page).execute(trx);
    const row = await live(trx, page);
    const current = row?.edit_id
      ? await trx
          .selectFrom('site_page_edits')
          .select('parent')
          .where('id', '=', row.edit_id)
          .where('page', '=', page)
          .executeTakeFirst()
      : undefined;
    const target = current?.parent
      ? await trx
          .selectFrom('site_page_edits')
          .select(['id', 'blocks'])
          .where('id', '=', current.parent)
          .where('page', '=', page)
          .executeTakeFirst()
      : undefined;
    if (!target) throw new HttpError(400, 'refused', 'There is nothing earlier to go back to.');
    await trx
      .updateTable('site_pages')
      .set({
        blocks: target.blocks === null ? null : JSON.stringify(target.blocks),
        edit_id: target.id,
        updated_at: sql`now()`,
      })
      .where('page', '=', page)
      .execute();
  });
}
