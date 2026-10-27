/**
 * The site's fixed pages built from blocks: the front page, About and Get
 * involved (decision 79). An administrator arranges a page from a small
 * library, edits it where it sits, and saves it live.
 *
 * NEVER SEALED. This is presentation; the boundary check keeps the seal and
 * the chain from reaching it.
 *
 * ONE RESOLVER. `resolvePageBlocks` is used by the server on read and on
 * write and by the page, so they cannot disagree about what a stored list
 * means. It forgives what a later release may have retired (an unknown type,
 * an unknown variant, a stray key) by dropping or ignoring it, which is also
 * how a block type can be added later without a migration.
 *
 * COMPLETE OR NOT SHOWN. A block missing something it needs is kept (so an
 * administrator can finish it) but is not drawn for the public:
 * `blockProblem` says what is missing, `publicBlocks` leaves it out.
 *
 * TEXT. Body text is a tiny Markdown subset (`parseMarkdown`): paragraphs,
 * `##` headings, **bold** and [links](address). Never HTML. A link goes to a
 * path on this site, an https:// or http:// address or a mailto: address;
 * anything else (javascript:, data:) is plain words, not a link.
 */
import { z } from 'zod';
import { defineRoute } from './route.ts';

export const PAGE_IDS = ['home', 'about', 'get-involved'] as const;
export type PageId = (typeof PAGE_IDS)[number];
export const PageIdSchema = z.enum(PAGE_IDS);

export const PAGE_NAMES: Record<PageId, string> = {
  home: 'Front page',
  about: 'About',
  'get-involved': 'Get involved',
};

export const MAX_BLOCKS = 40;
/** How many saves Undo can step back through. */
export const PAGE_UNDO_DEPTH = 20;

// ── limits ──────────────────────────────────────────────────────────────

const MAX_LINE = 200;
const MAX_BODY = 5000;
const MAX_URL = 500;
const MAX_LABEL = 60;
const MAX_ITEMS = 12;

// ── block types ─────────────────────────────────────────────────────────

export const BLOCK_TYPES = ['hero', 'text', 'steps', 'cards', 'cta', 'live'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** The modules a `live` block can place. They fetch for themselves. */
export const LIVE_MODULES = ['buttons', 'check', 'map', 'figures', 'links', 'social'] as const;
export type LiveModule = (typeof LIVE_MODULES)[number];

export const LIVE_MODULE_NAMES: Record<LiveModule, string> = {
  buttons: 'The big buttons',
  check: 'Check a report',
  map: 'The map',
  figures: 'The figures and latest reports',
  links: 'More you can do',
  social: 'Follow us elsewhere',
};

export const VARIANTS: Record<BlockType, readonly string[]> = {
  hero: ['poster', 'action', 'info'],
  text: ['plain', 'callout', 'statement'],
  steps: ['steps'],
  cards: ['cards', 'links'],
  cta: ['cta'],
  live: ['live'],
};

export const BLOCK_NAMES: Record<BlockType, { name: string; blurb: string }> = {
  hero: { name: 'Headline', blurb: 'A big headline with a line under it, and buttons.' },
  text: { name: 'Text', blurb: 'A heading and some words. Links allowed.' },
  steps: { name: 'Steps', blurb: 'Two to five short numbered steps.' },
  cards: { name: 'Cards', blurb: 'A row of cards, each with a link.' },
  cta: { name: 'Call to action', blurb: 'A highlighted box with an optional button.' },
  live: { name: 'Live part', blurb: 'The map, the figures, and the other parts that update.' },
};

export const VARIANT_NAMES: Record<string, string> = {
  poster: 'Poster: huge headline, slogan bar',
  action: 'Action: headline and big buttons',
  info: 'Info: headline, longer introduction',
  plain: 'Plain',
  callout: 'Callout box',
  statement: 'Statement: a big sentence beside the words',
  cards: 'Cards with a button',
  links: 'Cards that are links',
};

// ── the shapes ──────────────────────────────────────────────────────────

export const Block = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  type: z.string().max(40),
  variant: z.string().max(40).optional(),
  fields: z.record(z.string().max(40), z.unknown()),
  shown: z.boolean(),
});
export type Block = z.infer<typeof Block>;

/**
 * One entry of Steps or Cards, or one button of an info Headline. `tag` is the
 * small line above a card, or the stamp on a step; `label` is a card's
 * button wording. Both are empty when unused.
 */
export interface Item {
  title: string;
  line: string;
  link: string;
  tag: string;
  label: string;
}

// ── text helpers ────────────────────────────────────────────────────────

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '';
}

/** A path on this site, a web address or a mail address: nothing that runs. */
export function safeLink(raw: string): string | null {
  const url = raw.trim();
  if (!url || url.length > MAX_URL || /[\s<>"]/.test(url)) return null;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  if (/^https?:\/\/[^/\s]+/i.test(url)) return url;
  if (/^mailto:[^@\s]+@[^@\s]+$/i.test(url)) return url;
  return null;
}

/** Whether a link leaves this site (opens in a new tab). */
export const isExternalLink = (url: string): boolean => !url.startsWith('/');

function items(v: unknown): Item[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).slice(0, MAX_ITEMS).map((raw) => {
    const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    return {
      title: str(o.title, MAX_LINE),
      line: str(o.line, MAX_LINE),
      link: str(o.link, MAX_URL),
      tag: str(o.tag, MAX_LABEL),
      label: str(o.label, MAX_LABEL),
    };
  });
}

// ── the resolver ────────────────────────────────────────────────────────

function isType(t: string): t is BlockType {
  return (BLOCK_TYPES as readonly string[]).includes(t);
}

/** The fields a type keeps, trimmed and bounded. Anything else is dropped. */
function cleanFields(type: BlockType, variant: string, f: Record<string, unknown>) {
  switch (type) {
    case 'hero': {
      // Every layout keeps the same small words around the headline, so
      // switching layout back and forth loses nothing.
      const lead = {
        eyebrow: str(f.eyebrow, MAX_LINE),
        headline: str(f.headline, MAX_LINE),
        headline2: str(f.headline2, MAX_LINE),
        slogan: str(f.slogan, MAX_LINE),
        who: str(f.who, MAX_LINE),
      };
      return variant === 'info'
        ? { ...lead, body: str(f.body, MAX_BODY), buttons: items(f.buttons).slice(0, 4) }
        : { ...lead, line: str(f.line, 600) };
    }
    case 'text':
      return { heading: str(f.heading, MAX_LINE), body: str(f.body, MAX_BODY) };
    case 'steps':
      return { heading: str(f.heading, MAX_LINE), items: items(f.items).slice(0, 5) };
    case 'cards':
      return { heading: str(f.heading, MAX_LINE), items: items(f.items) };
    case 'cta':
      return {
        mark: str(f.mark, MAX_LINE),
        heading: str(f.heading, MAX_LINE),
        text: str(f.text, MAX_BODY),
        label: str(f.label, MAX_LABEL),
        url: str(f.url, MAX_URL),
      };
    case 'live':
      // `heading` and `line` rename the part's own heading and the sentence
      // under it where it has them; empty is the part's own words.
      return {
        module: str(f.module, 20),
        heading: str(f.heading, MAX_LINE),
        line: str(f.line, 600),
      };
  }
}

/**
 * The stored list made whole. A block that is not an object, has an unknown
 * type or repeats an id is dropped; an unknown variant becomes the type's
 * first; fields are cleaned. NOT here: whether the block is complete.
 */
export function resolvePageBlocks(stored: unknown): Block[] {
  if (!Array.isArray(stored)) return [];
  const out: Block[] = [];
  const seen = new Set<string>();
  for (const raw of stored as unknown[]) {
    const parsed = Block.safeParse(raw);
    if (!parsed.success) continue;
    const b = parsed.data;
    if (!isType(b.type) || seen.has(b.id)) continue;
    const allowed = VARIANTS[b.type];
    const variant = b.variant && allowed.includes(b.variant) ? b.variant : (allowed[0] ?? '');
    seen.add(b.id);
    out.push({
      id: b.id,
      type: b.type,
      variant,
      fields: cleanFields(b.type, variant, b.fields),
      shown: b.shown,
    });
    if (out.length >= MAX_BLOCKS) break;
  }
  return out;
}

const field = (b: Block, k: string): string => (typeof b.fields[k] === 'string' ? b.fields[k] : '');
const itemsOf = (b: Block, k = 'items'): Item[] => items(b.fields[k]);

/** Typed reads of a resolved block's fields, for the page. */
export const blockText = field;
export const blockItems = itemsOf;

/** What a block still needs before it can be shown, or null when it is complete. */
export function blockProblem(b: Block): string | null {
  switch (b.type) {
    case 'hero':
      return field(b, 'headline') ? null : 'Needs a headline.';
    case 'text':
      return field(b, 'body') ? null : 'Needs some text.';
    case 'steps': {
      const list = itemsOf(b);
      if (list.length < 2) return 'Needs at least two steps.';
      return list.every((i) => i.title) ? null : 'Every step needs a title.';
    }
    case 'cards': {
      const list = itemsOf(b);
      if (list.length < 1) return 'Needs at least one card.';
      return list.every((i) => i.title && safeLink(i.link))
        ? null
        : 'Every card needs a title and a working link.';
    }
    case 'cta': {
      if (!field(b, 'heading') || !field(b, 'text')) return 'Needs a heading and some text.';
      const label = field(b, 'label');
      const url = field(b, 'url');
      if (label && !safeLink(url)) return 'The button needs a working link.';
      if (url && !label) return 'The button needs wording.';
      return null;
    }
    case 'live':
      return (LIVE_MODULES as readonly string[]).includes(field(b, 'module'))
        ? null
        : 'Needs a part to place.';
  }
  return 'Unknown block.';
}

/** What a visitor gets: shown and complete, nothing else. */
export function publicBlocks(blocks: readonly Block[]): Block[] {
  return blocks.filter((b) => b.shown && blockProblem(b) === null);
}

/** A blank block of a type, for "Add block". */
export function newBlock(type: BlockType, id: string): Block {
  const base = { id, type, variant: VARIANTS[type][0] ?? '', shown: true };
  switch (type) {
    case 'hero':
      return {
        ...base,
        fields: { eyebrow: '', headline: '', headline2: '', slogan: '', line: '', who: '' },
      };
    case 'text':
      return { ...base, fields: { heading: '', body: '' } };
    case 'steps':
      return { ...base, fields: { heading: '', items: [blankItem(), blankItem()] } };
    case 'cards':
      return { ...base, fields: { heading: '', items: [blankItem()] } };
    case 'cta':
      return { ...base, fields: { mark: '', heading: '', text: '', label: '', url: '' } };
    case 'live':
      return { ...base, fields: { module: 'figures', heading: '', line: '' } };
  }
}

export const blankItem = (): Item => ({ title: '', line: '', link: '', tag: '', label: '' });

// ── the Markdown subset ─────────────────────────────────────────────────

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: Inline[] }
  | { kind: 'link'; href: string; text: string };
export interface MdNode {
  kind: 'p' | 'h';
  children: Inline[];
}

const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: 'bold', children: parseInline(m[1]) });
    else {
      const href = safeLink(m[3] ?? '');
      out.push(
        href ? { kind: 'link', href, text: m[2] ?? '' } : { kind: 'text', text: m[2] ?? '' },
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** Paragraphs are separated by a blank line; a line starting `## ` is a heading. */
export function parseMarkdown(body: string): MdNode[] {
  const nodes: MdNode[] = [];
  for (const chunk of body.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = chunk.split('\n');
    let para: string[] = [];
    const flush = () => {
      if (para.join('').trim())
        nodes.push({ kind: 'p', children: parseInline(para.join('\n').trim()) });
      para = [];
    };
    for (const line of lines) {
      const h = /^##\s+(.+)$/.exec(line);
      if (h) {
        flush();
        nodes.push({ kind: 'h', children: parseInline(h[1] ?? '') });
      } else para.push(line);
    }
    flush();
  }
  return nodes;
}

// ── the calls ───────────────────────────────────────────────────────────

export const PageBlocks = z.object({
  page: PageIdSchema,
  blocks: z.array(Block),
  /** False until somebody saves: the blocks are then what the site shipped with. */
  customised: z.boolean(),
});
export type PageBlocks = z.infer<typeof PageBlocks>;

export const PageEditorState = PageBlocks.extend({
  /** Every block, hidden and incomplete included, with what each still needs. */
  problems: z.record(z.string(), z.string()),
  can_undo: z.boolean(),
});
export type PageEditorState = z.infer<typeof PageEditorState>;

const PageParams = z.object({ page: PageIdSchema });

/** What a visitor reads: shown, complete blocks only. */
export const getPageBlocks = defineRoute({
  method: 'GET',
  path: '/api/site/pages/:page',
  summary: "A fixed page's blocks, as a visitor sees them.",
  params: PageParams,
  response: PageBlocks,
});

export const getPageEditor = defineRoute({
  method: 'GET',
  path: '/api/site/pages/:page/editor',
  summary: "A fixed page's blocks for the administrator who edits it.",
  params: PageParams,
  response: PageEditorState,
});

export const setPageBlocks = defineRoute({
  method: 'PUT',
  path: '/api/site/pages/:page',
  summary: "Saves a fixed page's blocks. Live at once.",
  params: PageParams,
  body: z.object({ blocks: z.array(Block).max(MAX_BLOCKS) }),
  response: PageEditorState,
});

export const undoPageBlocks = defineRoute({
  method: 'POST',
  path: '/api/site/pages/:page/undo',
  summary: 'Puts the page back as it was before its last save.',
  params: PageParams,
  response: PageEditorState,
});
