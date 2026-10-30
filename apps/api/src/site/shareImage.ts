/**
 * The picture a shared link shows (og:image): 1200 by 630, in the site's
 * own poster style (the owner's approved cards, 30 October 2026). The
 * near-black ground with its band of stripes and stars, the wordmark in the
 * site's own runs, and:
 *
 *   the front page   the hero's own words: its headline, the second line
 *                    outlined, and the slogan in a white bar;
 *   any other page   the page's name large, its one sentence under it, an
 *                    amber rule along the foot;
 *   behind the site password, or a page with nothing to say
 *                    the wordmark alone.
 *
 * Not gated (identity/gate.ts, IN_FRONT): a preview bot never has the site
 * password. Behind it only the wordmark is drawn, which the lock screen shows
 * anyway. The words on every other card are the ones the page's head already
 * carries (pageHead.ts `judge`), so the picture says nothing the page does not.
 *
 * Drawn by ImageMagick, which every server already has for the media worker,
 * called the same way (execFile with an argument list, never a shell). The
 * site's faces are shipped beside this as TTF, which ImageMagick reads (the
 * website's own are WOFF2 and Archivo is variable): Archivo fixed at the
 * width (125) and weight (800) the site draws its display type at. If
 * ImageMagick is missing or fails, the plain ground is served: a shared link
 * with a plain picture is better than a broken one.
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { blockText, parseBrand } from '@reportlog/contracts';
import type { BrandPart } from '@reportlog/contracts';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/database.ts';
import { gateApplies, siteAccessSettings } from '../identity/siteAccess.ts';
import { pageBlocks } from '../pages/store.ts';
import { resolveSiteName } from './identity.ts';
import { SHARE_IMAGE_PATH, judge } from './pageHead.ts';
import { readSettings } from './settings.ts';

const run = promisify(execFile);

export const SHARE_WIDTH = 1200;
export const SHARE_HEIGHT = 630;

const asset = (name: string) =>
  fileURLToPath(new URL(`../../assets/share/${name}`, import.meta.url));
const GROUND = asset('ground.png');
const DISPLAY = asset('fonts/Archivo-ExpandedExtraBold.ttf');
const SANS = asset('fonts/PublicSans-Regular.ttf');
const MONO = asset('fonts/IBMPlexMono-Medium.ttf');

const INK = '#0A0F15';
const AMBER = '#E9A81C';
/** The wordmark's second run (.org), as the header draws it. */
const DIMMED = 'rgba(255,255,255,0.55)';
const MUTED = '#DCE3E9';
/** The left and right margin, and the width between them. */
const EDGE = 72;
const WIDE = SHARE_WIDTH - 2 * EDGE;

export type Card =
  | { kind: 'plain'; brand: BrandPart[] }
  | { kind: 'front'; brand: BrandPart[]; first: string; second: string; slogan: string }
  | {
      kind: 'page';
      brand: BrandPart[];
      corner: string;
      eyebrow: string;
      title: string;
      description: string;
    };

/**
 * Text as ImageMagick's label and caption print it literally: `%` is a
 * placeholder, `\` an escape and a leading `@` means "read this file", so
 * each is neutralised. `&` prints as it is (caption has no markup). The
 * words are whatever an operator typed.
 */
export function literal(text: string): string {
  const escaped = text.replace(/\\/g, '\\\\').replace(/%/g, '%%');
  // A leading space keeps a text that starts with @ from being a file path;
  // label and caption both trim it.
  return ` ${escaped}`;
}

/** At most `n` characters, cut at a word. */
function clip(text: string, n: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= n) return flat;
  const cut = flat.slice(0, n - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), n / 2))}…`;
}

/** One block of text, placed with its top left at (x, y). */
function place(x: number, y: number, image: string[], gravity = 'NorthWest'): string[] {
  return [
    '(',
    ...image,
    ')',
    '-gravity',
    gravity,
    '-geometry',
    `+${String(x)}+${String(y)}`,
    '-composite',
  ];
}

/**
 * The display face, upper case as the site sets it, fitted into a box: one
 * line (label), or for a page's name wrapped onto as many lines as fit
 * (caption), so a long name stays large instead of shrinking to one line.
 */
function display(text: string, w: number, h: number, outline = false, wrap = false): string[] {
  return [
    '-background',
    'none',
    '-font',
    DISPLAY,
    '-size',
    `${String(w)}x${String(h)}`,
    ...(outline ? ['-fill', 'none', '-stroke', '#fff', '-strokewidth', '4'] : ['-fill', '#fff']),
    `${wrap ? 'caption' : 'label'}:${literal(text.toUpperCase())}`,
  ];
}

/** The wordmark: each run of the site's name in its colour, on one line. */
function wordmark(brand: readonly BrandPart[], size: number): string[] {
  const runs = brand.filter((p) => p.text);
  return [
    ...runs.flatMap((p) => [
      '(',
      '-background',
      'none',
      '-font',
      DISPLAY,
      '-pointsize',
      String(size),
      '-fill',
      p.mark === 'a' ? AMBER : p.mark === 'b' ? DIMMED : '#fff',
      `label:${literal(p.text.toUpperCase())}`,
      ')',
    ]),
    '-background',
    'none',
    '+append',
  ];
}

/** The command line that draws a card, after the program's name. */
export function cardArgs(card: Card): string[] {
  // -respect-parentheses keeps each block's settings (size, stroke, font) in
  // its block; without it one block's box size leaks into the next.
  const out: string[] = ['-respect-parentheses', GROUND];
  if (card.kind === 'plain') {
    out.push(...place(EDGE, 0, wordmark(card.brand, 64), 'West'));
  } else if (card.kind === 'front') {
    out.push(...place(EDGE, 56, wordmark(card.brand, 30)));
    if (card.second) {
      out.push(...place(EDGE, 168, display(card.first, WIDE, 150)));
      out.push(...place(EDGE, 322, display(card.second, WIDE, 150, true)));
    } else {
      out.push(...place(EDGE, 190, display(card.first, WIDE, 280)));
    }
    if (card.slogan) {
      out.push(
        ...place(EDGE, 512, [
          '-background',
          '#fff',
          '-fill',
          INK,
          '-font',
          DISPLAY,
          '-pointsize',
          '36',
          `label:${literal(clip(card.slogan, 48).toUpperCase())}`,
          '-bordercolor',
          '#fff',
          '-border',
          '20x12',
        ]),
      );
    }
  } else {
    out.push(...place(EDGE, 56, wordmark(card.brand, 30)));
    if (card.corner) {
      out.push(
        ...place(
          EDGE,
          62,
          [
            '-background',
            'none',
            '-fill',
            'rgba(255,255,255,0.7)',
            '-font',
            MONO,
            '-pointsize',
            '20',
            `label:${literal(clip(card.corner, 40).toUpperCase())}`,
          ],
          'NorthEast',
        ),
      );
    }
    if (card.eyebrow) {
      out.push(
        ...place(EDGE, 214, [
          '-background',
          'none',
          '-fill',
          AMBER,
          '-font',
          MONO,
          '-pointsize',
          '22',
          `label:${literal(card.eyebrow.toUpperCase())}`,
        ]),
      );
    }
    out.push(...place(EDGE, 254, display(card.title, WIDE, 130, false, true)));
    if (card.description) {
      out.push(
        ...place(EDGE, 400, [
          '-background',
          'none',
          '-fill',
          MUTED,
          '-font',
          SANS,
          '-pointsize',
          '34',
          '-interline-spacing',
          '6',
          '-size',
          '820x150',
          `caption:${literal(clip(card.description, 150))}`,
        ]),
      );
    }
    out.push(
      '-fill',
      AMBER,
      '-draw',
      `rectangle 0,${String(SHARE_HEIGHT - 14)} ${String(SHARE_WIDTH)},${String(SHARE_HEIGHT)}`,
    );
  }
  out.push('-strip', '-define', 'png:exclude-chunks=date,time', 'png:-');
  return out;
}

export async function draw(card: Card): Promise<Buffer> {
  const { stdout } = await run(
    'convert',
    [
      // The same ceilings the media worker sets: a card needs little.
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
      ...cardArgs(card),
    ],
    { timeout: 60_000, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout;
}

/** What one page's card says, from the words its head already carries. */
async function cardFor(db: Database, asked: string | undefined): Promise<Card> {
  const brand = parseBrand(resolveSiteName((await readSettings(db)).site_name));
  if (gateApplies(await siteAccessSettings(db))) return { kind: 'plain', brand };

  const hero = (await pageBlocks(db, 'home')).blocks.find((b) => b.type === 'hero');
  const heroText = (k: string) => (hero ? blockText(hero, k) : '');
  const path = asked ?? '/';
  if (path === '/') {
    const first = heroText('headline');
    if (!first) return { kind: 'plain', brand };
    return {
      kind: 'front',
      brand,
      first,
      second: heroText('headline2'),
      slogan: heroText('slogan'),
    };
  }
  const verdict = await judge(db, path);
  if (!verdict.page?.title) return { kind: 'plain', brand };
  const at = verdict.page.path;
  const eyebrow = at.startsWith('/board')
    ? 'Public record'
    : at.startsWith('/docs')
      ? 'Guide'
      : at.startsWith('/maps/')
        ? 'Map'
        : '';
  return {
    kind: 'page',
    brand,
    // The front page's eyebrow ("2026 US midterms"), when the operator wrote one.
    corner: heroText('eyebrow'),
    eyebrow,
    title: verdict.page.title,
    description: verdict.page.description,
  };
}

/** How many drawn cards are kept. Every address that is nothing shares one. */
const KEEP = 300;

export function shareImageRoutes(app: FastifyInstance, db: Database): void {
  // Keyed by what is drawn, not by the address asked: every unknown address
  // draws the same plain card, so asking for a million of them draws one.
  const drawn = new Map<string, Promise<Buffer>>();
  let said = false;

  app.get<{ Querystring: { path?: unknown } }>(SHARE_IMAGE_PATH, async (request, reply) => {
    const raw = request.query.path;
    const asked =
      typeof raw === 'string' && raw.startsWith('/') && raw.length <= 300 && !/\p{Cc}/u.test(raw)
        ? raw
        : undefined;
    const card = await cardFor(db, asked);
    const key = JSON.stringify(card);

    let png = drawn.get(key);
    if (!png) {
      png = draw(card);
      if (drawn.size >= KEEP) {
        const oldest = drawn.keys().next();
        if (!oldest.done) drawn.delete(oldest.value);
      }
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
          'The share picture could not be drawn; serving the plain ground instead.',
        );
      }
      body = await readFile(GROUND);
    }
    void reply.type('image/png').header('cache-control', 'public, max-age=3600');
    return body;
  });
}
