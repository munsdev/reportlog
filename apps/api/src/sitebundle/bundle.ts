/**
 * Exporting the site's presentation as one file, and importing it again.
 *
 * NOTHING HERE IS SEALED AND NOTHING HERE TOUCHES THE ARCHIVE. This reads and
 * writes the site's name, wording, fixed pages, front-page sections, social
 * accounts, look and look packs, and nothing else: no logbook, question,
 * list, report, entry, person, role or file. The seal and the chain code may
 * not reach this folder.
 *
 * THE ORDER IS THE SAFETY. An import keeps the current values first
 * (`site_bundle_backups`), then installs packs, then checks every part with
 * the validator the screen for that part uses, then writes, all in one
 * transaction: a part that is refused rolls back the rest, the kept copy
 * included. The header image is the one thing outside the database; it is
 * stored first under a new name and deleted again if the transaction fails.
 */
import {
  PAGE_IDS,
  resolveHomeSections,
  resolveLookOptions,
  resolveSocialFloat,
  resolveSocialLinks,
  resolveSocialPlacements,
} from '@reportlog/contracts';
import type {
  BundleBackupInfo,
  BundleResult,
  LookOptions,
  PageId,
  SiteBundle,
} from '@reportlog/contracts';
import { BUNDLE_FORMAT } from '@reportlog/contracts';
import type { Database } from '../db/database.ts';
import { checkText, figureValues } from '../board/figures.ts';
import { afterCommit } from '../files/publication.ts';
import { queueDeletion } from '../files/slots.ts';
import type { Files } from '../files/context.ts';
import { HttpError, notFound } from '../http/errors.ts';
import { installPackIn, lookCatalogue, readPacks } from '../looks/packs.ts';
import { pageBlocks, savePageIn } from '../pages/store.ts';
import { validateCopy } from '../site/copy.ts';
import { storeHeaderImage, headerKey } from '../site/headerImage.ts';
import { validateHomeSections } from '../site/homeSections.ts';
import { validateSiteName } from '../site/identity.ts';
import { validateLegalText } from '../site/legal.ts';
import { validateLook } from '../site/look.ts';
import type { Checked } from '../site/result.ts';
import { readCopy, readSettings, writeCopy, writeSettings } from '../site/settings.ts';
import {
  validateSocialFloat,
  validateSocialLinks,
  validateSocialPlacements,
} from '../site/social.ts';
import { storedZip } from './zip.ts';

type Site = SiteBundle['site'];
/** What a kept copy holds beyond a bundle: the pages that were still as shipped. */
type Snapshot = SiteBundle & { site: Site & { shipped_pages?: string[] } };

const refused = (message: string) => new HttpError(400, 'refused', message);
function accept<T>(what: string, c: Checked<T>): T {
  if (!c.ok) throw refused(`${what}: ${c.error}`);
  return c.value;
}

// ── export ──────────────────────────────────────────────────────────────

async function headerImageData(files: Files | null, file: string): Promise<string | null> {
  const key = headerKey(file);
  if (!files || !key) return null;
  const got = await files.storage.get('renditions', key);
  if (!got) return null;
  const chunks: Buffer[] = [];
  for await (const c of got.body) chunks.push(Buffer.from(c as Uint8Array));
  const type = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return `data:${type};base64,${Buffer.concat(chunks).toString('base64')}`;
}

export async function exportBundle(
  db: Database,
  files: Files | null,
  { packs, shipped }: { packs: boolean; shipped: boolean },
): Promise<Snapshot> {
  const [settings, copyRows] = await Promise.all([readSettings(db), readCopy(db)]);
  const options = resolveLookOptions(settings.look_options);
  const image = options.header.image;
  const data = image ? await headerImageData(files, image.file) : null;
  const { image: _drop, ...header } = options.header; // eslint-disable-line @typescript-eslint/no-unused-vars
  const pages: NonNullable<Site['pages']> = {};
  const shippedPages: string[] = [];
  for (const page of PAGE_IDS) {
    const { blocks, customised } = await pageBlocks(db, page);
    if (customised) pages[page] = blocks;
    else shippedPages.push(page);
  }
  const float = resolveSocialFloat(settings.social_float);
  const site: Snapshot['site'] = {
    name: settings.site_name,
    copy: Object.fromEntries(copyRows.map((r) => [r.key, r.body])),
    legal: { impressum: settings.impressum_text, privacy: settings.privacy_text },
    pages,
    home_sections: resolveHomeSections(settings.home_sections).map((s) => ({
      id: s.id,
      shown: s.shown,
    })),
    social: {
      links: resolveSocialLinks(settings.social_links).map((l) => ({
        id: l.id,
        address: l.url ?? '',
        shown: l.shown,
      })),
      float: { on: float.on, pages: [...float.pages] },
      placements: [...resolveSocialPlacements(settings.social_placements)],
    },
    look: {
      palette: settings.palette,
      theme: settings.theme,
      options: {
        ...options,
        header: {
          ...header,
          image: image && data ? { ...omitFile(image), data_url: data } : null,
        },
      },
    },
    ...(shipped ? { shipped_pages: shippedPages } : {}),
  };
  if (packs) {
    site.packs = [];
    for (const row of await readPacks(db)) {
      const fonts = await db
        .selectFrom('look_pack_files')
        .select(['path', 'bytes'])
        .where('pack_id', '=', row.id)
        .orderBy('path')
        .execute();
      site.packs.push({
        look: row.manifest as unknown as Record<string, unknown>,
        ...(fonts.length
          ? { fonts: Object.fromEntries(fonts.map((f) => [f.path, f.bytes.toString('base64')])) }
          : {}),
      });
    }
  }
  return { format: BUNDLE_FORMAT, exported_at: new Date().toISOString(), site };
}

function omitFile<T extends { file: string }>(image: T): Omit<T, 'file'> {
  const { file: _file, ...rest } = image; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
}

// ── import ──────────────────────────────────────────────────────────────

function decodeImage(url: string): Buffer {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(url);
  if (!m?.[1]) throw refused('The header image in the file is not a JPEG, PNG or WebP picture.');
  return Buffer.from(m[1], 'base64');
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

interface Applied {
  written: string[];
  skipped: string[];
}

async function apply(
  trx: Database,
  site: Site & { shipped_pages?: string[] },
  ctx: { actor: string; exact: boolean; newImage: string | null },
): Promise<Applied> {
  const written: string[] = [];
  const skipped: string[] = [];
  const values: Parameters<typeof writeSettings>[1] = {};

  for (const pack of site.packs ?? []) {
    const id = text(pack.look.id);
    const entries = new Map<string, Uint8Array>([
      ['look.json', Buffer.from(JSON.stringify(pack.look), 'utf8')],
    ]);
    for (const [path, b64] of Object.entries(pack.fonts ?? {}))
      entries.set(path, Buffer.from(b64, 'base64'));
    const done = await installPackIn(trx, storedZip(entries), ctx.actor);
    if (done.ok) written.push(`Look pack "${id}" ${text(pack.look.version)}`.trim());
    else if (done.problems.every((p) => p.includes('is already installed')))
      skipped.push(`Look pack "${id}" is already installed at that version or newer.`);
    else throw refused(`Look pack "${id}": ${done.problems.join(' ')}`);
  }
  const looks = await lookCatalogue(trx);

  if (site.name !== undefined) {
    values.site_name = accept('The site name', validateSiteName(site.name));
    written.push('The site name');
  }
  if (site.legal?.impressum !== undefined) {
    values.impressum_text = accept(
      'The legal notice',
      validateLegalText(site.legal.impressum ?? ''),
    );
    written.push('The legal notice');
  }
  if (site.legal?.privacy !== undefined) {
    values.privacy_text = accept('The privacy policy', validateLegalText(site.legal.privacy ?? ''));
    written.push('The privacy policy');
  }
  if (site.home_sections) {
    values.home_sections = JSON.stringify(
      accept('The front page sections', validateHomeSections(site.home_sections)),
    );
    written.push('The front page sections');
  }
  if (site.social) {
    const current = resolveSocialLinks((await readSettings(trx)).social_links);
    values.social_links = JSON.stringify(
      accept('The social accounts', validateSocialLinks(current, site.social.links)),
    );
    if (site.social.float)
      values.social_float = JSON.stringify(
        accept('The Follow us button', validateSocialFloat(site.social.float)),
      );
    if (site.social.placements)
      values.social_placements = JSON.stringify({
        on: accept('Where the accounts show', validateSocialPlacements(site.social.placements)),
      });
    written.push('The social accounts and where they show');
  }
  if (site.look) {
    if (site.look.palette !== undefined || site.look.theme !== undefined) {
      const look = accept(
        'The look',
        validateLook(
          {
            ...(site.look.palette !== undefined ? { palette: site.look.palette } : {}),
            ...(site.look.theme !== undefined ? { theme: site.look.theme } : {}),
          },
          looks,
        ),
      );
      Object.assign(values, look);
      written.push('The palette and theme');
    }
    if (site.look.options) {
      const old = resolveLookOptions((await readSettings(trx)).look_options).header.image;
      const { image, ...header } = site.look.options.header;
      let next: LookOptions['header']['image'] = null;
      if (image) {
        if (!ctx.newImage) throw refused('The header image in the file could not be stored.');
        next = { ...omitData(image), file: ctx.newImage };
      }
      const options: LookOptions = { ...site.look.options, header: { ...header, image: next } };
      values.look_options = JSON.stringify(resolveLookOptions(options));
      if (old && old.file !== next?.file)
        await queueDeletion(trx, 'renditions', `headers/${old.file}`);
      written.push('The header background, motion and sections');
    }
  }

  await writeSettings(trx, values);

  if (site.copy) {
    const numbers = await figureValues(trx);
    for (const [key, body] of Object.entries(site.copy)) {
      const slot = accept(`The wording "${key}"`, validateCopy(key, body));
      if (slot.body?.includes('{{')) {
        const problems = checkText(slot.body, numbers);
        if (problems.length) throw refused(`The wording "${key}": ${problems.join(' · ')}`);
      }
      await writeCopy(trx, slot.key, slot.body);
    }
    if (ctx.exact) {
      const keep = Object.keys(site.copy);
      let del = trx.deleteFrom('site_copy');
      if (keep.length) del = del.where('key', 'not in', keep);
      await del.execute();
    }
    written.push(`${String(Object.keys(site.copy).length)} pieces of wording`);
  }
  for (const [page, blocks] of Object.entries(site.pages ?? {})) {
    await savePageIn(trx, page as PageId, blocks, null);
    written.push(`The ${page} page`);
  }
  for (const page of site.shipped_pages ?? []) {
    await trx
      .insertInto('site_pages')
      .values({ page: page as PageId, blocks: null, edit_id: null })
      .onConflict((oc) => oc.column('page').doUpdateSet({ blocks: null, edit_id: null }))
      .execute();
    written.push(`The ${page} page, as it ships`);
  }
  return { written, skipped };
}

function omitData<T extends { data_url: string }>(image: T): Omit<T, 'data_url'> {
  const { data_url: _d, ...rest } = image; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
}

/** Store the picture first, so a bad one is refused before anything is written. */
async function storeImage(files: Files | null, site: Site): Promise<string | null> {
  const image = site.look?.options?.header.image;
  if (!image) return null;
  const bytes = decodeImage(image.data_url);
  if (!files)
    throw new HttpError(
      503,
      'no_storage',
      'This site has nowhere to keep files yet, so it cannot take a header image. Take the image out of the file, or ask whoever runs the site to set up file storage.',
    );
  return storeHeaderImage(files, bytes);
}

async function run(
  db: Database,
  files: Files | null,
  site: Site,
  mode: { actor: string; restoreId: number | null },
): Promise<BundleResult> {
  const newImage = await storeImage(files, site);
  try {
    const out = await db.transaction().execute(async (trx) => {
      let backup: BundleBackupInfo | null = null;
      if (mode.restoreId === null) {
        // What is there now, kept in the same transaction that replaces it.
        const snapshot = await exportBundle(trx, files, { packs: false, shipped: true });
        const row = await trx
          .insertInto('site_bundle_backups')
          .values({ created_by: mode.actor, snapshot: JSON.stringify(snapshot) })
          .returning(['id', 'created_at', 'created_by'])
          .executeTakeFirstOrThrow();
        backup = {
          id: row.id,
          created_at: new Date(row.created_at).toISOString(),
          created_by: row.created_by,
        };
      } else {
        await trx
          .updateTable('site_bundle_backups')
          .set({ restored_at: new Date() })
          .where('id', '=', mode.restoreId)
          .execute();
      }
      const applied = await apply(trx, site, {
        actor: mode.actor,
        exact: mode.restoreId !== null,
        newImage,
      });
      return { ...applied, backup };
    });
    await afterCommit(files);
    return out;
  } catch (e) {
    if (newImage && files)
      await files.storage.delete('renditions', `headers/${newImage}`).catch(() => undefined);
    throw e;
  }
}

export function importBundle(
  db: Database,
  files: Files | null,
  bundle: SiteBundle,
  actor: string,
): Promise<BundleResult> {
  return run(db, files, bundle.site, { actor, restoreId: null });
}

// ── putting it back ─────────────────────────────────────────────────────

export async function newestBackup(db: Database): Promise<BundleBackupInfo | null> {
  const row = await db
    .selectFrom('site_bundle_backups')
    .select(['id', 'created_at', 'created_by'])
    .where('restored_at', 'is', null)
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row
    ? { id: row.id, created_at: new Date(row.created_at).toISOString(), created_by: row.created_by }
    : null;
}

export async function restoreBackup(
  db: Database,
  files: Files | null,
  actor: string,
): Promise<BundleResult> {
  const row = await db
    .selectFrom('site_bundle_backups')
    .select(['id', 'snapshot'])
    .where('restored_at', 'is', null)
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!row) throw notFound('There is no earlier copy of the settings to go back to.');
  const snapshot = row.snapshot as unknown as Snapshot;
  const done = await run(db, files, snapshot.site, { actor, restoreId: row.id });
  return { ...done, backup: null };
}
