/**
 * The press pack: a deployment's own documents, served as files.
 *
 * BUILT AHEAD OF TIME AND SERVED FROM DISK. Nothing here renders a document
 * on request, and it must stay that way: rendering on demand is a button any
 * stranger can hold down until the server falls over. As files on disk it is
 * a static download and costs nothing.
 *
 * WHICH DOCUMENTS IS THE DEPLOYMENT'S CHOICE, not the software's. ReportLog
 * ships no documents and no list of them. Legacy kept the list as an empty
 * object in its code, so publishing anything meant editing the software;
 * here the list is the `files` array of `manifest.json` in PRESS_DIR, written
 * by whatever builds the pack, beside the files it names:
 *
 *   {
 *     "version": "1.4.0", "commit": "3f2a9c1", "built_at": "2026-10-19T09:00:00Z",
 *     "files": [
 *       { "file": "press-kit.pdf", "name": "Press kit.pdf", "label": "Press kit",
 *         "blurb": "What the archive is and how to check a report.",
 *         "type": "application/pdf" }
 *     ]
 *   }
 *
 * `version` and `note` on one file are for a document built outside the rest
 * of the pack, so the page can say so rather than quietly claiming it
 * describes the current site.
 *
 * THE REQUEST NEVER CONTRIBUTES TO A PATH. It names a key, the key is looked
 * up in the manifest, and only a name the manifest lists, made of plain
 * characters with no separator, is joined to the directory.
 *
 * No sign-in required: reviewers and press are given the site password, not
 * an account. It sits behind the password with everything else under /api,
 * so while the site is locked the pack is locked with it, and lifting the
 * lock publishes this too. It is not the archive, so the archive switch does
 * not hide it.
 */
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import * as C from '@reportlog/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound } from '../http/errors.ts';
import { route } from '../http/route.ts';

/** A file name inside the directory: no separators, nothing hidden. */
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

/**
 * What a pack may hold. Nothing a browser would run: no HTML and no SVG,
 * which can carry script. A type outside this list is not offered.
 */
export const PRESS_TYPES = [
  'application/pdf',
  'application/zip',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
] as const;

const Entry = z.object({
  file: z.string().regex(FILE_NAME),
  name: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  blurb: z.string().max(1000).optional(),
  type: z.enum(PRESS_TYPES),
  version: z.string().max(60).optional(),
  note: z.string().max(500).optional(),
});

const Manifest = z.object({
  version: z.string().max(60).optional(),
  commit: z.string().max(60).optional(),
  built_at: z.string().max(60).optional(),
  files: z.array(Entry).max(100).default([]),
});
type Manifest = z.infer<typeof Manifest>;

export type PressState =
  { state: 'none' } | { state: 'unreadable' } | { state: 'ready'; dir: string; manifest: Manifest };

/** Read the pack's manifest. Read on every request: it is small, and a rebuilt pack is live at once. */
export async function readPack(dir: string | undefined): Promise<PressState> {
  if (!dir) return { state: 'none' };
  let text: string;
  try {
    text = await readFile(join(dir, 'manifest.json'), 'utf8');
  } catch {
    // No pack built yet: a state the page says, not an error.
    return { state: 'none' };
  }
  try {
    const parsed = Manifest.safeParse(JSON.parse(text));
    return parsed.success
      ? { state: 'ready', dir, manifest: parsed.data }
      : { state: 'unreadable' };
  } catch {
    return { state: 'unreadable' };
  }
}

/** The name a downloaded copy is saved under, stamped with its version so it says what it is. */
export function downloadName(name: string, version: string | undefined): string {
  const suffix = version ? `-${version.replace(/[^A-Za-z0-9.]+/g, '-')}` : '';
  const stamped = /\.\w+$/.test(name) ? name.replace(/\.(\w+)$/, `${suffix}.$1`) : name + suffix;
  // A header value: plain characters only, never a quote or a line break.
  return stamped.replace(/[^A-Za-z0-9 ._-]+/g, '-');
}

export interface PressRouteDeps {
  /** PRESS_DIR: an absolute path, or unset for no pack. */
  dir?: string | undefined;
}

export function pressRoutes(app: FastifyInstance, deps: PressRouteDeps): void {
  route(app, C.getPressPack, async () => {
    const pack = await readPack(deps.dir);
    if (pack.state !== 'ready') {
      return { state: pack.state, version: null, commit: null, built_at: null, files: [] };
    }
    const m = pack.manifest;
    const files = [];
    for (const f of m.files) {
      // Listed even when missing: a missing file means the pack was not
      // rebuilt, and that is worth seeing.
      const bytes = await stat(join(pack.dir, f.file)).then(
        (s) => (s.isFile() ? s.size : null),
        () => null,
      );
      files.push({
        key: f.file,
        name: f.name,
        label: f.label,
        blurb: f.blurb ?? null,
        type: f.type,
        bytes,
        version: f.version ?? null,
        note: f.note ?? null,
      });
    }
    return {
      state: 'ready' as const,
      version: m.version ?? null,
      commit: m.commit ?? null,
      built_at: m.built_at ?? null,
      files,
    };
  });

  app.get(C.PRESS_FILE_PATH, async (request, reply) => {
    const { key } = request.params as { key: string };
    const pack = await readPack(deps.dir);
    const entry = pack.state === 'ready' ? pack.manifest.files.find((f) => f.file === key) : null;
    if (pack.state !== 'ready' || !entry)
      throw notFound('There is no such file in the press pack.');
    const full = join(pack.dir, entry.file);
    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) throw notFound('That file has not been built yet.');
    const name = downloadName(entry.name, entry.version ?? pack.manifest.version);
    return reply
      .header('Content-Type', entry.type)
      .header('Content-Length', String(info.size))
      .header('Content-Disposition', `attachment; filename="${name}"`)
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cache-Control', 'no-cache')
      .send(createReadStream(full));
  });
}
