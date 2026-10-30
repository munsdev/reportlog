/**
 * The picture a shared link shows (og:image): 1200 by 630, the site's name
 * large on the site's own colours, with the icon beside it.
 *
 * Not gated (identity/gate.ts, IN_FRONT). A preview bot never has the site
 * password, and the picture says nothing the lock screen does not: the plain
 * name, a palette and an icon.
 *
 * Drawn by ImageMagick, which every server already has for the media worker,
 * called the same way (execFile with an argument list, never a shell). If it
 * is missing or fails, the plain 512 icon is served instead: a shared link
 * with a small picture is better than a broken one.
 *
 * Font: DejaVu Sans Bold, by name. The site's own faces are WOFF2, which
 * ImageMagick cannot read, and this picture must not depend on a font that
 * only some servers have installed. DejaVu is on nearly every Linux; where it
 * is not, ImageMagick falls back to its default face, still readable.
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/database.ts';
import { lookCatalogue } from '../looks/packs.ts';
import { publicSite } from './site.ts';
import { DEFAULT_LOOK } from '@reportlog/contracts';

const run = promisify(execFile);

export const SHARE_WIDTH = 1200;
export const SHARE_HEIGHT = 630;
const TAGLINE = 'Reports, checked and kept';
const FONT = 'DejaVu-Sans-Bold';
const ICON = fileURLToPath(
  new URL('../../../../apps/web/public/icons/icon-512.png', import.meta.url),
);

/** Colours as the look catalogue holds them: #rgb or #rrggbb. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** White or near-black, whichever reads better on `ground`. */
export function inkFor(ground: string): string {
  const full = ground.length === 4 ? `#${ground.slice(1).replace(/./g, (c) => c + c)}` : ground;
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => Number.parseInt(full.slice(i, i + 2), 16));
  // Perceived brightness, 0 to 255. Past the middle, dark ink reads better.
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111111' : '#ffffff';
}

/**
 * The name as ImageMagick's text drawing will print it literally. Its text
 * argument reads `%` as a placeholder, `\` as an escape and a leading `@` as
 * "read this file", so each is neutralised. `&` is printed as it is (caption,
 * unlike pango, has no markup). A name is whatever the owner typed.
 */
export function literal(text: string): string {
  const escaped = text.replace(/\\/g, '\\\\').replace(/%/g, '%%');
  // The leading space is what keeps a name that starts with @ from being a file path.
  return ` ${escaped}`;
}

export async function draw(name: string, deep: string): Promise<Buffer> {
  const ink = inkFor(deep);
  const { stdout } = await run(
    'convert',
    [
      // The same ceilings the media worker sets: a small picture needs little.
      '-limit',
      'memory',
      '256MiB',
      '-limit',
      'map',
      '512MiB',
      '-limit',
      'disk',
      '1GiB',
      '-limit',
      'time',
      '60',
      '-size',
      `${String(SHARE_WIDTH)}x${String(SHARE_HEIGHT)}`,
      `xc:${deep}`,
      // The icon, as it is.
      '(',
      ICON,
      '-resize',
      '240x240',
      ')',
      '-gravity',
      'West',
      '-geometry',
      '+90+0',
      '-composite',
      // The name: fits the space beside the icon, shrinking to fit when long.
      '(',
      '-background',
      'none',
      '-fill',
      ink,
      '-font',
      FONT,
      '-size',
      '690x300',
      // Sitting on the bottom of its box, so a one-line name rests on the line
      // below it and a long one grows upward.
      '-gravity',
      'SouthWest',
      `caption:${literal(name)}`,
      ')',
      '-gravity',
      'NorthWest',
      '-geometry',
      '+390+95',
      '-composite',
      // The line under it, quieter but still plain.
      '(',
      '-background',
      'none',
      '-fill',
      ink,
      '-font',
      FONT,
      '-pointsize',
      '34',
      '-size',
      '690x',
      '-gravity',
      'West',
      `caption:${literal(TAGLINE)}`,
      ')',
      '-gravity',
      'NorthWest',
      '-geometry',
      '+390+430',
      '-composite',
      '-strip',
      '-define',
      'png:exclude-chunks=date,time',
      'png:-',
    ],
    { timeout: 60_000, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout;
}

export function shareImageRoutes(app: FastifyInstance, db: Database): void {
  // One picture per name and palette: the page head points every share at this
  // one address, so most requests are a lookup. The promise is cached, so two
  // bots arriving together draw it once.
  const drawn = new Map<string, Promise<Buffer>>();
  let said = false;

  app.get('/api/site/share.png', async (_request, reply) => {
    const [site, looks] = await Promise.all([publicSite(db), lookCatalogue(db)]);
    const palette =
      looks.palettes.find((p) => p.id === site.look.palette) ??
      looks.palettes.find((p) => p.id === DEFAULT_LOOK.palette);
    // Colours come from the catalogue (an installed pack's are checked at
    // install), but they go into a command line, so check once more.
    const deep = palette && HEX.test(palette.deep) ? palette.deep : '#1b2a41';
    const key = `${deep}\n${site.plain_name}`;

    let png: Promise<Buffer> | undefined = drawn.get(key);
    if (!png) {
      png = draw(site.plain_name, deep);
      // A changed name or palette makes a new picture; the old one is not wanted.
      drawn.clear();
      drawn.set(key, png);
    }
    let body: Buffer;
    try {
      body = await png;
    } catch (err) {
      drawn.delete(key);
      // Once, so a server without ImageMagick does not fill its log. No URL,
      // no address: the error's own text can carry a path, so only its kind.
      if (!said) {
        said = true;
        app.log.warn(
          { err: err instanceof Error ? err.name : 'Error' },
          'The share picture could not be drawn; serving the plain icon instead.',
        );
      }
      body = await readFile(ICON);
    }
    void reply.type('image/png').header('cache-control', 'public, max-age=3600');
    return body;
  });
}
