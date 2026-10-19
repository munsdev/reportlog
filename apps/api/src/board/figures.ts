/**
 * Numbers an operator can put in their own wording, and the arithmetic
 * between them: "In the last week {{ [reports.filed.7d] }} reports were
 * filed." The front page's text is the operator's (workstream G); this is the
 * catalogue of figures and the language that combines them.
 *
 * WHAT A FIGURE MAY BE: only what is already public elsewhere on the site,
 * defined the same way:
 *   - reports filed (confirmed into the record) and published, as stats.ts
 *     counts them, overall and per logbook;
 *   - a list's received and approved, and its counts per answer of each
 *     question an operator ticked as countable, ONLY for a list that is
 *     listed and whose counts an administrator published: the same two
 *     conditions as the list's public counts (GET /api/lists/:slug/counts),
 *     counted by the lists' own code (lists/aggregates.ts), so the two can
 *     never disagree.
 *
 * NO BARE TOTAL is still the rule: the operator writes the qualification
 * around the number.
 *
 * THE ARITHMETIC IS PARSED, NEVER EVALUATED. Numbers, figures in brackets,
 * + - * / and brackets, and two functions: round(x, places) and
 * percent(part, whole). Anything else is a refusal with a reason: the text
 * box is somebody's front page, and nothing typed into it may run.
 */
import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { summaryFor } from '../lists/aggregates.ts';
import { listBySlug } from '../lists/rows.ts';
import { launchedLogbooks } from '../logbooks/logbooks.ts';
import { everyHead, isPublic } from './board.ts';

export const WINDOWS = { all: null, '24h': 1, '7d': 7, '30d': 30, '365d': 365 } as const;
type WindowName = keyof typeof WINDOWS;
const WINDOW_WORDS: Record<WindowName, string> = {
  all: 'ever',
  '24h': 'in the last 24 hours',
  '7d': 'in the last 7 days',
  '30d': 'in the last 30 days',
  '365d': 'in the last year',
};

// ── the expression language (pure) ──────────────────────────────────────

type Token =
  | { t: 'num'; v: number }
  | { t: 'fig'; v: string }
  | { t: 'name'; v: string }
  | { t: '+' | '-' | '*' | '/' | '(' | ')' | ',' };

export type Expr =
  | { num: number }
  | { fig: string }
  | { call: 'round' | 'percent'; args: Expr[] }
  | { op: 'neg'; a: Expr }
  | { op: '+' | '-' | '*' | '/'; a: Expr; b: Expr };

const FUNCTIONS = {
  round: {
    min: 1,
    max: 2,
    fn: (x: number, p = 0) => {
      const k = 10 ** Math.max(0, Math.min(6, Math.trunc(p)));
      return Math.round(x * k) / k;
    },
  },
  percent: { min: 2, max: 2, fn: (a: number, b: number) => (a / b) * 100 },
} as const;

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src.charAt(j))) j += 1;
      const n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) throw new Error(`"${src.slice(i, j)}" is not a number`);
      out.push({ t: 'num', v: n });
      i = j;
      continue;
    }
    if (c === '[') {
      const j = src.indexOf(']', i);
      if (j < 0) throw new Error('a [ is never closed');
      const id = src.slice(i + 1, j).trim();
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(id))
        throw new Error(`[${id}] is not the name of a figure`);
      out.push({ t: 'fig', v: id });
      i = j + 1;
      continue;
    }
    if (/[a-z]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-z]/.test(src.charAt(j))) j += 1;
      out.push({ t: 'name', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/(),'.includes(c)) {
      out.push({ t: c as '+' });
      i += 1;
      continue;
    }
    throw new Error(`"${c}" cannot be used here`);
  }
  return out;
}

/** Parse into a tree. Throws with a sentence a person can act on. */
export function parseExpression(src: string): Expr {
  const toks = tokenize(src);
  let p = 0;
  const peek = (): Token | undefined => toks[p];
  const take = (t: string) => {
    if (peek()?.t !== t) throw new Error(`expected "${t}"`);
    p += 1;
  };
  function expr(): Expr {
    let left = term();
    for (let t = peek(); t && (t.t === '+' || t.t === '-'); t = peek()) {
      p += 1;
      left = { op: t.t, a: left, b: term() };
    }
    return left;
  }
  function term(): Expr {
    let left = factor();
    for (let t = peek(); t && (t.t === '*' || t.t === '/'); t = peek()) {
      p += 1;
      left = { op: t.t, a: left, b: factor() };
    }
    return left;
  }
  function factor(): Expr {
    const t = peek();
    if (!t) throw new Error('it ends too soon');
    if (t.t === '-') {
      p += 1;
      return { op: 'neg', a: factor() };
    }
    if (t.t === 'num') {
      p += 1;
      return { num: t.v };
    }
    if (t.t === 'fig') {
      p += 1;
      return { fig: t.v };
    }
    if (t.t === '(') {
      p += 1;
      const e = expr();
      take(')');
      return e;
    }
    if (t.t === 'name') {
      if (t.v !== 'round' && t.v !== 'percent') {
        throw new Error(`there is no "${t.v}": use round or percent`);
      }
      const f = FUNCTIONS[t.v];
      p += 1;
      take('(');
      const args = [expr()];
      while (peek()?.t === ',') {
        p += 1;
        args.push(expr());
      }
      take(')');
      if (args.length < f.min || args.length > f.max) {
        throw new Error(
          `${t.v} takes ${f.min === f.max ? String(f.min) : `${String(f.min)} or ${String(f.max)}`} values`,
        );
      }
      return { call: t.v, args };
    }
    throw new Error(`"${t.t}" is in the wrong place`);
  }
  const tree = expr();
  if (p !== toks.length) throw new Error('there is something left over at the end');
  return tree;
}

/** Every figure an expression names. */
export function figuresIn(tree: Expr, out = new Set<string>()): Set<string> {
  if ('fig' in tree) out.add(tree.fig);
  if ('a' in tree) figuresIn(tree.a, out);
  if ('b' in tree) figuresIn(tree.b, out);
  if ('args' in tree) for (const a of tree.args) figuresIn(a, out);
  return out;
}

/** Evaluate against known values. NaN for anything unknown or undefined. */
export function evaluate(tree: Expr, values: Readonly<Record<string, number>>): number {
  if ('num' in tree) return tree.num;
  if ('fig' in tree) return Object.hasOwn(values, tree.fig) ? (values[tree.fig] ?? NaN) : NaN;
  if ('call' in tree) {
    const [a, b] = tree.args.map((x) => evaluate(x, values));
    if (tree.call === 'round') return FUNCTIONS.round.fn(a ?? NaN, b);
    return FUNCTIONS.percent.fn(a ?? NaN, b ?? NaN);
  }
  const a = evaluate(tree.a, values);
  if (tree.op === 'neg') return -a;
  const b = evaluate(tree.b, values);
  if (tree.op === '+') return a + b;
  if (tree.op === '-') return a - b;
  if (tree.op === '*') return a * b;
  return a / b;
}

/** Whole numbers with separators; anything else to one place. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const whole = Math.abs(n - Math.round(n)) < 1e-9;
  return n.toLocaleString(
    'en-US',
    whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 1, maximumFractionDigits: 1 },
  );
}

const PLACEHOLDER = /\{\{([^{}]{1,500})\}\}/g;

/**
 * Replace every {{ … }} in a text. A placeholder that will not parse, or that
 * names a figure that does not exist, becomes "?": never the raw
 * placeholder, which would put the operator's working on their front page.
 */
export function renderText(text: string, values: Readonly<Record<string, number>>): string {
  return text.replace(PLACEHOLDER, (_m, src: string) => {
    try {
      const tree = parseExpression(src);
      for (const f of figuresIn(tree)) if (!Object.hasOwn(values, f)) return '?';
      return formatNumber(evaluate(tree, values));
    } catch {
      return '?';
    }
  });
}

/** For an editor: every problem in a text, in words, before it is saved. */
export function checkText(text: string, values: Readonly<Record<string, number>>): string[] {
  const problems: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) {
    const src = m[1] ?? '';
    try {
      for (const f of figuresIn(parseExpression(src))) {
        if (!Object.hasOwn(values, f))
          problems.push(`{{${src}}}: there is no figure called [${f}]`);
      }
    } catch (e) {
      problems.push(`{{${src}}}: ${(e as Error).message}`);
    }
  }
  return problems;
}

// ── the catalogue (reads the database) ──────────────────────────────────

export interface Figure {
  id: string;
  group: string;
  label: string;
  value: number;
}

/**
 * Every figure, with a label for an editor's menu and its value now. Reports
 * are counted by when each thread was FIRST filed, and whether it is public
 * now: the same definitions as stats.ts.
 */
export async function catalogue(db: Kysely<DB>, now = Date.now()): Promise<Figure[]> {
  const heads = await everyHead(db);
  const books = await launchedLogbooks(db);
  const out: Figure[] = [];
  for (const [w, days] of Object.entries(WINDOWS) as [WindowName, number | null][]) {
    const from = days === null ? null : now - days * 864e5;
    const inWin = heads.filter(
      (r) => from === null || new Date(r.first_filed_at ?? 0).getTime() >= from,
    );
    const words = WINDOW_WORDS[w];
    out.push({
      id: `reports.filed.${w}`,
      group: 'Reports',
      label: `Reports filed ${words}`,
      value: inWin.length,
    });
    out.push({
      id: `reports.published.${w}`,
      group: 'Reports',
      label: `Reports published, of those filed ${words}`,
      value: inWin.filter(isPublic).length,
    });
    for (const b of books) {
      const mine = inWin.filter((r) => r.logbook_id === b.id);
      const group = `Logbook: ${b.title}`;
      out.push({
        id: `logbook.${b.slug}.filed.${w}`,
        group,
        label: `${b.title}: filed ${words}`,
        value: mine.length,
      });
      out.push({
        id: `logbook.${b.slug}.published.${w}`,
        group,
        label: `${b.title}: published, of those filed ${words}`,
        value: mine.filter(isPublic).length,
      });
    }
  }
  out.push(...(await listFigures(db, now)));
  return out;
}

/**
 * A short, stable name for one answer, so an operator's placeholder keeps
 * working when the list's options are reordered or another is added. Legacy's
 * exactly (the first six hex digits of the answer's SHA-256), so a placeholder
 * written against the old site still names the same figure.
 */
export const valueId = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 6);

/** A list's figures: only a list that is listed AND whose counts were published. */
async function listFigures(db: Kysely<DB>, now: number): Promise<Figure[]> {
  const lists = await db
    .selectFrom('lists')
    .select('slug')
    .where('aggregates_published', '=', true)
    .where('visibility', '=', 'listed')
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const out: Figure[] = [];
  for (const { slug } of lists) {
    const list = await listBySlug(db, slug);
    if (!list) continue;
    const group = `List: ${list.title}`;
    for (const [w, days] of Object.entries(WINDOWS) as [WindowName, number | null][]) {
      const since = days === null ? null : new Date(now - days * 864e5);
      const s = await summaryFor(db, list, { since });
      if (!s) continue;
      const words = WINDOW_WORDS[w];
      out.push({
        id: `list.${slug}.received.${w}`,
        group,
        label: `${list.title}: received ${words}`,
        value: s.totals.received,
      });
      out.push({
        id: `list.${slug}.approved.${w}`,
        group,
        label: `${list.title}: approved, of those received ${words}`,
        value: s.totals.approved,
      });
      for (const f of s.fields) {
        for (const v of f.values) {
          const base = `list.${slug}.${f.key}.${valueId(v.value)}`;
          const said = `${list.title}: "${f.label}" answered "${v.value}"`;
          out.push({
            id: `${base}.received.${w}`,
            group,
            label: `${said}, received ${words}`,
            value: v.received,
          });
          out.push({
            id: `${base}.approved.${w}`,
            group,
            label: `${said}, approved ${words}`,
            value: v.approved,
          });
        }
      }
    }
  }
  return out;
}

export async function figureValues(db: Kysely<DB>): Promise<Record<string, number>> {
  return Object.fromEntries((await catalogue(db)).map((f) => [f.id, f.value]));
}
