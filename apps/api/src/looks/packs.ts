/**
 * Look packs: what is installed, what a .zip would add, and the one
 * installer that both the upload route and the command line use, so the two
 * cannot accept different things or answer in different words.
 *
 * NOTHING HERE IS SEALED. A pack is presentation, and the boundary check
 * keeps the seal and the chain from ever reaching this folder.
 *
 * THE ORDER IS THE SECURITY. readZip() refuses a bad path, a link or an
 * oversized file before anything is unpacked; check() refuses a bad value,
 * and shapeProblems() a field the format does not name or a label that is
 * not text, before anything is written; toCss() writes the stylesheet from checked
 * values only, so no byte an uploader wrote reaches a stylesheet except
 * through a field held to a shape that cannot leave its declaration. The
 * database is written only when every one of those has nothing to say.
 */
import {
  CORE_PACK,
  LIMITS,
  LOOK_PACK_MAX_ZIP_BYTES,
  PALETTES,
  RETIRED_IDS,
  THEMES,
  check,
  toCss,
} from '@reportlog/contracts';
import type {
  InstalledLookPack,
  Installed,
  LookPack,
  LookPackSummary,
  PanelHead,
  Texture,
} from '@reportlog/contracts';
import { sql } from 'kysely';
import { createHash } from 'node:crypto';
import type { Database } from '../db/database.ts';
import { recordRoleChange } from '../identity/roles.ts';
import { shapeProblems } from './shape.ts';
import { readZip } from './zip.ts';

// ── what is installed ───────────────────────────────────────────────────

export interface PackRow {
  id: string;
  version: string;
  /** The look.json as installed. Only a pack check() passed is ever stored. */
  manifest: LookPack;
  css_sha256: string;
  installed_at: Date;
  installed_by: string;
}

export async function readPacks(db: Database): Promise<PackRow[]> {
  const rows = await db
    .selectFrom('look_packs')
    .select(['id', 'version', 'manifest', 'css_sha256', 'installed_at', 'installed_by'])
    .orderBy('id')
    .execute();
  // The manifest is what the installer wrote after check() passed; nothing
  // else writes this table.
  return rows.map((r) => ({ ...r, manifest: r.manifest as unknown as LookPack }));
}

export function stylesheetPath(packId: string, sha256: string): string {
  return `/api/looks/${packId}/${sha256}.css`;
}

/**
 * Every palette and theme the site can paint, built in or installed, with
 * what the server needs of each: the manifest's two colours, whether a
 * palette is dark, a theme's two layout choices, and the stylesheets the
 * page has to link for the installed ones.
 */
export interface LookCatalogue {
  palettes: readonly { id: string; dark: boolean; background: string; deep: string }[];
  themes: readonly { id: string; panelHead: PanelHead; texture: Texture }[];
  stylesheets: readonly string[];
}

export const BUILT_IN_CATALOGUE: LookCatalogue = {
  palettes: PALETTES,
  themes: THEMES,
  stylesheets: [],
};

export function catalogueOf(rows: readonly PackRow[]): LookCatalogue {
  return {
    palettes: [
      ...PALETTES,
      ...rows.flatMap((r) =>
        (r.manifest.palettes ?? []).map((p) => ({
          id: p.id,
          dark: p.dark,
          background: p.colors.background,
          deep: p.colors['background-deep'],
        })),
      ),
    ],
    themes: [
      ...THEMES,
      ...rows.flatMap((r) =>
        (r.manifest.themes ?? []).map((t) => ({
          id: t.id,
          panelHead: t.panelHead,
          texture: t.texture,
        })),
      ),
    ],
    stylesheets: rows.map((r) => stylesheetPath(r.id, r.css_sha256)),
  };
}

export async function lookCatalogue(db: Database): Promise<LookCatalogue> {
  return catalogueOf(await readPacks(db));
}

// ── what a pack is, as the screens show it ──────────────────────────────

export function summarize(pack: LookPack): LookPackSummary {
  return {
    id: pack.id,
    label: pack.label,
    version: pack.version ?? '',
    ...(pack.author ? { author: pack.author } : {}),
    palettes: (pack.palettes ?? []).map((p) => ({
      id: p.id,
      label: p.label,
      description: p.description,
      dark: p.dark,
      background: p.colors.background,
      deep: p.colors['background-deep'],
      surface: p.colors.surface,
      action: p.colors.action,
    })),
    themes: (pack.themes ?? []).map((t) => ({
      id: t.id,
      label: t.label,
      description: t.description,
      panelHead: t.panelHead,
      texture: t.texture,
    })),
    looks: (pack.looks ?? []).map((l) => ({
      id: l.id,
      label: l.label,
      palette: l.palette,
      theme: l.theme,
    })),
    fonts: (pack.fonts ?? []).map((f) => f.family),
  };
}

function families(pack: LookPack): string[] {
  return (pack.fonts ?? []).map((f) => f.family);
}

/** Every font family a pack's themes name. */
function familiesUsed(pack: LookPack): Set<string> {
  const out = new Set<string>();
  for (const t of pack.themes ?? [])
    for (const slot of [t.type.heading, t.type.body, t.type.label, t.type.mono])
      out.add(slot.family);
  return out;
}

/** What the built-in pack and these other packs already provide; ids are unique across all. */
function installedBesides(others: readonly PackRow[]): Installed {
  const all = [CORE_PACK, ...others.map((r) => r.manifest)];
  return {
    palettes: new Set(all.flatMap((p) => (p.palettes ?? []).map((x) => x.id))),
    themes: new Set(all.flatMap((p) => (p.themes ?? []).map((x) => x.id))),
    looks: new Set(all.flatMap((p) => (p.looks ?? []).map((x) => x.id))),
    families: new Set(all.flatMap(families)),
  };
}

/**
 * Why taking `gone` away (removing the pack, or replacing it with
 * `replacement`) would leave something with nothing to paint, in words. The
 * site wearing one of its palettes or themes, or another pack's theme or
 * look naming something only this pack provides.
 */
function stillNeeded(
  gone: PackRow,
  others: readonly PackRow[],
  worn: { palette: string; theme: string } | null,
  replacement: LookPack | null,
): string[] {
  const out: string[] = [];
  const keeps = {
    palettes: new Set((replacement?.palettes ?? []).map((p) => p.id)),
    themes: new Set((replacement?.themes ?? []).map((t) => t.id)),
    families: new Set(replacement ? families(replacement) : []),
  };
  const lost = {
    palettes: (gone.manifest.palettes ?? []).filter((p) => !keeps.palettes.has(p.id)),
    themes: (gone.manifest.themes ?? []).filter((t) => !keeps.themes.has(t.id)),
    families: families(gone.manifest).filter((f) => !keeps.families.has(f)),
  };
  const what = replacement ? 'this version does not have it' : 'it comes from this pack';
  if (worn) {
    const p = lost.palettes.find((x) => x.id === worn.palette);
    if (p)
      out.push(
        `The site is wearing the palette "${p.label}", and ${what}. Choose another look on the Look screen first.`,
      );
    const t = lost.themes.find((x) => x.id === worn.theme);
    if (t)
      out.push(
        `The site is wearing the theme "${t.label}", and ${what}. Choose another look on the Look screen first.`,
      );
  }
  for (const other of others) {
    const used = familiesUsed(other.manifest);
    for (const f of lost.families)
      if (used.has(f)) out.push(`The look pack "${other.manifest.label}" uses the font "${f}".`);
    for (const l of other.manifest.looks ?? []) {
      if (lost.palettes.some((p) => p.id === l.palette))
        out.push(`The look "${l.label}" in the pack "${other.manifest.label}" uses its palette.`);
      if (lost.themes.some((t) => t.id === l.theme))
        out.push(`The look "${l.label}" in the pack "${other.manifest.label}" uses its theme.`);
    }
  }
  return out;
}

async function wornLook(db: Database): Promise<{ palette: string; theme: string } | null> {
  const row = await db
    .selectFrom('site_settings')
    .select(['palette', 'theme'])
    .where('id', '=', true)
    .executeTakeFirst();
  return row ?? null;
}

const newer = (a: string, b: string): boolean => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
};

// ── checking a .zip ─────────────────────────────────────────────────────

export interface Inspection {
  /** Empty means it may be installed. */
  problems: string[];
  /** Set only when problems is empty. */
  pack: LookPack | null;
  files: ReadonlyMap<string, Uint8Array>;
  /** The installed version it would replace. */
  replaces: PackRow | null;
}

const refused = (...problems: string[]): Inspection => ({
  problems,
  pack: null,
  files: new Map(),
  replaces: null,
});

/**
 * Everything wrong with a .zip as a look pack, against what is installed
 * now. Reads; never writes.
 */
export async function inspectPack(db: Database, zip: Uint8Array): Promise<Inspection> {
  if (zip.byteLength > LOOK_PACK_MAX_ZIP_BYTES) return refused('The pack is larger than 10 MB.');
  const read = readZip(zip, {
    // Folders are entries too; check() counts the files.
    entries: LIMITS.files + 20,
    fileBytes: LIMITS.fileBytes,
    totalBytes: LIMITS.packBytes,
  });
  if (!read.ok) return refused(...read.problems);
  const { files } = read;

  const raw = files.get('look.json');
  if (!raw) {
    const nested = [...files.keys()].some((n) => n.endsWith('/look.json'));
    return refused(
      nested
        ? 'look.json must be at the top of the .zip, not inside a folder. Zip what is in the folder, not the folder itself.'
        : 'The pack has no look.json.',
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    return refused('look.json is not valid JSON.');
  }

  const rows = await readPacks(db);
  const id = (json as { id?: unknown } | null)?.id;
  const existing = rows.find((r) => r.id === id) ?? null;
  const others = rows.filter((r) => r.id !== id);
  const problems = [...check(json, installedBesides(others), files), ...shapeProblems(json)];

  // What check() cannot know, because it is about this site rather than the pack.
  const pack = json as LookPack;
  if (id === CORE_PACK.id) problems.push('That is the built-in pack’s id. A pack needs its own.');
  // Read as what it may really be: check() has only said what is wrong with it.
  const version: unknown = pack.version;
  if (version === undefined) problems.push('The pack needs a version, like 1.0.0.');
  else if (
    existing &&
    typeof version === 'string' &&
    /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version) &&
    !newer(version, existing.version)
  )
    problems.push(
      `"${existing.manifest.label}" ${existing.version} is already installed. A replacement needs a higher version.`,
    );

  for (const p of pack.palettes ?? [])
    if (Object.hasOwn(RETIRED_IDS.palettes, p.id))
      problems.push(
        `"${p.id}" was the name of a built-in palette before, and a site may still have it saved. Choose another id.`,
      );
  for (const t of pack.themes ?? [])
    if (Object.hasOwn(RETIRED_IDS.themes, t.id))
      problems.push(
        `"${t.id}" was the name of a built-in theme before, and a site may still have it saved. Choose another id.`,
      );
  // Two @font-face sets for one family would let a pack change how the
  // built-in looks, or another pack's, are drawn.
  for (const family of new Set(families(pack))) {
    const owner = [CORE_PACK, ...others.map((r) => r.manifest)].find((p) =>
      families(p).includes(family),
    );
    if (owner)
      problems.push(
        owner === CORE_PACK
          ? `The font "${family}" is already built in. Name it in a theme instead of shipping it again.`
          : `The font "${family}" already comes with the pack "${owner.label}". Name it in a theme instead of shipping it again.`,
      );
  }
  if (problems.length) return { ...refused(...problems), replaces: existing };
  if (existing) problems.push(...stillNeeded(existing, others, await wornLook(db), pack));
  if (problems.length) return { ...refused(...problems), replaces: existing };
  return { problems, pack, files, replaces: existing };
}

// ── installing, replacing, removing ─────────────────────────────────────

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

/** One installer at a time, so two cannot both pass the check against the same state. */
const lock = (trx: Database) =>
  sql`SELECT pg_advisory_xact_lock(hashtext('reportlog_look_packs'))`.execute(trx);

export type Installation =
  | { ok: true; pack: InstalledLookPack; replaced: string | null }
  | { ok: false; problems: string[] };

/**
 * Check, then install or replace, in one transaction, and record who did
 * it. `actor` is the signed-in person's address, or a name for the command
 * line.
 */
export async function installPack(
  db: Database,
  zip: Uint8Array,
  actor: string,
): Promise<Installation> {
  return db.transaction().execute(async (trx) => {
    await lock(trx);
    const seen = await inspectPack(trx, zip);
    if (!seen.pack) return { ok: false, problems: seen.problems };
    const pack = seen.pack;

    // Only the files the manifest names: check() has made sure each is there.
    const fonts = (pack.fonts ?? []).flatMap((f) => f.files.map((x) => x.file));
    const hashes = new Map<string, string>();
    for (const file of fonts) {
      const bytes = seen.files.get(file);
      if (bytes) hashes.set(file, sha256(bytes));
    }
    const css = toCss(pack, (id, file) => `/api/looks/${id}/${hashes.get(file) ?? ''}.woff2`);
    const row = {
      version: String(pack.version),
      manifest: JSON.stringify(pack),
      css,
      css_sha256: sha256(css),
      installed_at: new Date(),
      installed_by: actor,
    };

    if (seen.replaces) {
      await trx.updateTable('look_packs').set(row).where('id', '=', pack.id).execute();
      await trx.deleteFrom('look_pack_files').where('pack_id', '=', pack.id).execute();
    } else {
      await trx
        .insertInto('look_packs')
        .values({ id: pack.id, ...row })
        .execute();
    }
    for (const [path, hash] of hashes) {
      const bytes = seen.files.get(path);
      if (!bytes) continue;
      await trx
        .insertInto('look_pack_files')
        .values({ pack_id: pack.id, path, sha256: hash, bytes: Buffer.from(bytes) })
        .execute();
    }
    const replaced = seen.replaces?.version ?? null;
    await recordRoleChange(trx, {
      actorEmail: actor,
      subjectEmail: actor,
      axis: 'site',
      action: 'change',
      detail:
        replaced === null
          ? `installed the look pack ${pack.id} ${row.version}`
          : `replaced the look pack ${pack.id} ${replaced} with ${row.version}`,
    });
    const installed = (await listPacks(trx)).find((p) => p.id === pack.id);
    if (!installed) throw new Error(`look pack ${pack.id} vanished inside its own transaction`);
    return { ok: true, pack: installed, replaced };
  });
}

export type Removal = { ok: true } | { ok: false; status: 404 | 409; message: string };

export async function removePack(db: Database, id: string, actor: string): Promise<Removal> {
  return db.transaction().execute(async (trx) => {
    await lock(trx);
    const rows = await readPacks(trx);
    const gone = rows.find((r) => r.id === id);
    if (!gone) return { ok: false, status: 404, message: 'There is no look pack with that id.' };
    const why = stillNeeded(
      gone,
      rows.filter((r) => r !== gone),
      await wornLook(trx),
      null,
    );
    if (why.length) return { ok: false, status: 409, message: why.join(' ') };
    await trx.deleteFrom('look_packs').where('id', '=', id).execute();
    await recordRoleChange(trx, {
      actorEmail: actor,
      subjectEmail: actor,
      axis: 'site',
      action: 'change',
      detail: `removed the look pack ${id} ${gone.version}`,
    });
    return { ok: true };
  });
}

/** Every installed pack, with what it adds and whether it may be removed today. */
export async function listPacks(db: Database): Promise<InstalledLookPack[]> {
  const rows = await readPacks(db);
  const worn = await wornLook(db);
  return rows.map((r) => {
    const why = stillNeeded(
      r,
      rows.filter((o) => o !== r),
      worn,
      null,
    );
    return {
      ...summarize(r.manifest),
      version: r.version,
      installed_at: r.installed_at.toISOString(),
      installed_by: r.installed_by,
      stylesheet: stylesheetPath(r.id, r.css_sha256),
      in_use: why.length ? why.join(' ') : null,
    };
  });
}

// ── serving ─────────────────────────────────────────────────────────────

const FILE = /^([0-9a-f]{64})\.(css|woff2)$/;

/** A pack's stylesheet or one of its fonts, by the hash in its name; null for anything else. */
export async function packFile(
  db: Database,
  packId: string,
  file: string,
): Promise<{ type: 'text/css; charset=utf-8' | 'font/woff2'; body: string | Buffer } | null> {
  const m = FILE.exec(file);
  if (!m) return null;
  const [, hash = '', ext] = m;
  if (ext === 'css') {
    const row = await db
      .selectFrom('look_packs')
      .select('css')
      .where('id', '=', packId)
      .where('css_sha256', '=', hash)
      .executeTakeFirst();
    return row ? { type: 'text/css; charset=utf-8', body: row.css } : null;
  }
  const row = await db
    .selectFrom('look_pack_files')
    .select('bytes')
    .where('pack_id', '=', packId)
    .where('sha256', '=', hash)
    .limit(1)
    .executeTakeFirst();
  return row ? { type: 'font/woff2', body: row.bytes } : null;
}
