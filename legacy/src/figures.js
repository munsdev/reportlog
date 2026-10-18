/**
 * Numbers an operator can put in their own wording, and the arithmetic
 * between them.
 *
 * The motivating case: "on the home page, in the last week there have been
 * X reports filed". The front page text is the operator's (src/siteCopy.js),
 * so this lets a placeholder in it become a figure when the page is served:
 *
 *   In the last week {{ [reports.filed.7d] }} reports were filed.
 *   {{ percent([list.check-ins.verdict.1a2b3c.approved.all], [list.check-ins.approved.all]) }}% went fine.
 *
 * WHAT A FIGURE MAY BE. Only what is already public somewhere else on the
 * site, defined the same way it is defined there:
 *   - reports filed (confirmed into the record) and published, as
 *     src/stats.js counts them — which publishes both, with their
 *     denominators, on the board's "By the numbers";
 *   - a list's received and approved, and its counts per answer, ONLY for a
 *     list whose counts an administrator published and that is listed — the
 *     same two conditions as /api/lists/:slug/counts.
 * A figure that is not in the catalogue renders as "?" rather than as a
 * guess, and the editor says which one.
 *
 * NO BARE TOTAL is a rule in src/stats.js, and it is the operator who now
 * writes the qualification around the number. The editor's help says so.
 *
 * THE ARITHMETIC IS PARSED, NEVER EVALUATED. Numbers, figures in brackets,
 * + - * / and brackets, and two functions: round(x, places) and
 * percent(part, whole). Anything else is a refusal with a reason — the text
 * box is somebody's front page, and nothing typed into it may run.
 */
import crypto from 'node:crypto';
import { pool } from './db.js';

export const WINDOWS = Object.freeze({
  all: null, '24h': 1, '7d': 7, '30d': 30, '365d': 365,
});
const WINDOW_WORDS = { all: 'ever', '24h': 'in the last 24 hours', '7d': 'in the last 7 days', '30d': 'in the last 30 days', '365d': 'in the last year' };

/** A short, stable name for one answer, so reordering options moves nothing. */
export const valueId = (v) => crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 6);

/* ---------------------------------------------------------------- *
 * The expression language. Pure; `npm test` reaches all of it.
 * ---------------------------------------------------------------- */

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j += 1;
      const n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) throw new Error(`"${src.slice(i, j)}" is not a number`);
      out.push({ t: 'num', v: n }); i = j; continue;
    }
    if (c === '[') {
      const j = src.indexOf(']', i);
      if (j < 0) throw new Error('a [ is never closed');
      const id = src.slice(i + 1, j).trim();
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) throw new Error(`[${id}] is not the name of a figure`);
      out.push({ t: 'fig', v: id }); i = j + 1; continue;
    }
    if (/[a-z]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-z]/.test(src[j])) j += 1;
      out.push({ t: 'name', v: src.slice(i, j) }); i = j; continue;
    }
    if ('+-*/(),'.includes(c)) { out.push({ t: c }); i += 1; continue; }
    throw new Error(`"${c}" cannot be used here`);
  }
  return out;
}

const FUNCTIONS = {
  round: { min: 1, max: 2, fn: (x, p = 0) => { const k = 10 ** Math.max(0, Math.min(6, Math.trunc(p))); return Math.round(x * k) / k; } },
  percent: { min: 2, max: 2, fn: (a, b) => (a / b) * 100 },
};

/** Parse into a tree. Throws with a sentence a person can act on. */
export function parseExpression(src) {
  const toks = tokenize(String(src));
  let p = 0;
  const peek = () => toks[p];
  const take = (t) => { if (peek()?.t !== t) throw new Error(`expected "${t}"`); p += 1; };
  function expr() {
    let left = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) { const op = toks[p++].t; left = { op, a: left, b: term() }; }
    return left;
  }
  function term() {
    let left = factor();
    while (peek() && (peek().t === '*' || peek().t === '/')) { const op = toks[p++].t; left = { op, a: left, b: factor() }; }
    return left;
  }
  function factor() {
    const t = peek();
    if (!t) throw new Error('it ends too soon');
    if (t.t === '-') { p += 1; return { op: 'neg', a: factor() }; }
    if (t.t === 'num') { p += 1; return { num: t.v }; }
    if (t.t === 'fig') { p += 1; return { fig: t.v }; }
    if (t.t === '(') { p += 1; const e = expr(); take(')'); return e; }
    if (t.t === 'name') {
      const f = FUNCTIONS[t.v];
      if (!f) throw new Error(`there is no "${t.v}" — use round or percent`);
      p += 1; take('(');
      const args = [expr()];
      while (peek()?.t === ',') { p += 1; args.push(expr()); }
      take(')');
      if (args.length < f.min || args.length > f.max) throw new Error(`${t.v} takes ${f.min === f.max ? f.min : `${f.min} or ${f.max}`} values`);
      return { call: t.v, args };
    }
    throw new Error(`"${t.t}" is in the wrong place`);
  }
  const tree = expr();
  if (p !== toks.length) throw new Error('there is something left over at the end');
  return tree;
}

/** Every figure an expression names. */
export function figuresIn(tree, out = new Set()) {
  if (!tree) return out;
  if (tree.fig) out.add(tree.fig);
  for (const k of ['a', 'b']) if (tree[k]) figuresIn(tree[k], out);
  for (const a of tree.args || []) figuresIn(a, out);
  return out;
}

/** Evaluate against known values. NaN for anything unknown or undefined. */
export function evaluate(tree, values) {
  if ('num' in tree) return tree.num;
  if (tree.fig) return Object.prototype.hasOwnProperty.call(values, tree.fig) ? values[tree.fig] : NaN;
  if (tree.call) return FUNCTIONS[tree.call].fn(...tree.args.map((a) => evaluate(a, values)));
  const a = evaluate(tree.a, values);
  if (tree.op === 'neg') return -a;
  const b = evaluate(tree.b, values);
  if (tree.op === '+') return a + b;
  if (tree.op === '-') return a - b;
  if (tree.op === '*') return a * b;
  return a / b;
}

/** How a result is written: whole numbers with separators, others to 1 place. */
export function formatNumber(n) {
  if (!Number.isFinite(n)) return '—';
  const whole = Math.abs(n - Math.round(n)) < 1e-9;
  return n.toLocaleString('en-US', whole
    ? { maximumFractionDigits: 0 }
    : { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export const PLACEHOLDER = /\{\{([^{}]{1,500})\}\}/g;

/**
 * Replace every {{ … }} in a piece of text. `values` is the catalogue's
 * id → number. A placeholder that will not parse, or names a figure that
 * does not exist, becomes "?" — never the raw placeholder, which would put
 * the operator's working on their front page.
 */
export function renderText(text, values) {
  return String(text).replace(PLACEHOLDER, (_, src) => {
    try {
      const tree = parseExpression(src);
      for (const f of figuresIn(tree)) if (!Object.prototype.hasOwnProperty.call(values, f)) return '?';
      return formatNumber(evaluate(tree, values));
    } catch { return '?'; }
  });
}

/** For the editor: every problem in a text, in words, before it is saved. */
export function checkText(text, values) {
  const problems = [];
  for (const m of String(text).matchAll(PLACEHOLDER)) {
    try {
      const tree = parseExpression(m[1]);
      for (const f of figuresIn(tree)) {
        if (!Object.prototype.hasOwnProperty.call(values, f)) problems.push(`{{${m[1]}}}: there is no figure called [${f}]`);
      }
    } catch (e) { problems.push(`{{${m[1]}}}: ${e.message}`); }
  }
  return problems;
}

/* ---------------------------------------------------------------- *
 * The catalogue. Reads the database.
 * ---------------------------------------------------------------- */

const TTL_MS = Number(process.env.FIGURES_TTL_MS ?? 60 * 1000);
let cache = { at: 0, data: null };
export function clearFiguresCache() { cache = { at: 0, data: null }; }

const since = (days) => (days === null ? null : new Date(Date.now() - days * 864e5));

/**
 * Every figure, with a label for the editor's menu and its current value.
 * Returns [{ id, label, group, value }].
 */
export async function catalogue({ client = pool } = {}) {
  if (cache.data && Date.now() - cache.at < TTL_MS) return cache.data;
  const out = [];

  // Reports: when each one was FIRST filed, and whether it is published now
  // — the same definitions as src/stats.js.
  const { rows: reps } = await client.query(
    `SELECT first.filed_at, r.logbook_id,
            (h.withdrawn = false AND h.moderation_status = 'valid' AND r.may_publish = true) AS published
       FROM report_heads h
       JOIN reports r ON r.id = h.current_report_id
       JOIN LATERAL (SELECT min(x.received_at) AS filed_at FROM reports x WHERE x.thread_id = h.thread_id) first ON true`,
  );
  const { rows: books } = await client.query(
    'SELECT id, slug, title FROM logbooks WHERE launched_at IS NOT NULL ORDER BY created_at, id');
  for (const [w, days] of Object.entries(WINDOWS)) {
    const from = since(days);
    const inWin = reps.filter((r) => !from || new Date(r.filed_at) >= from);
    out.push({ id: `reports.filed.${w}`, group: 'Reports', label: `Reports filed ${WINDOW_WORDS[w]}`, value: inWin.length });
    out.push({ id: `reports.published.${w}`, group: 'Reports', label: `Reports published, of those filed ${WINDOW_WORDS[w]}`, value: inWin.filter((r) => r.published).length });
    for (const b of books) {
      const mine = inWin.filter((r) => Number(r.logbook_id) === Number(b.id));
      out.push({ id: `logbook.${b.slug}.filed.${w}`, group: `Logbook: ${b.title}`, label: `${b.title}: filed ${WINDOW_WORDS[w]}`, value: mine.length });
      out.push({ id: `logbook.${b.slug}.published.${w}`, group: `Logbook: ${b.title}`, label: `${b.title}: published, of those filed ${WINDOW_WORDS[w]}`, value: mine.filter((r) => r.published).length });
    }
  }

  // Lists: only those whose counts are published and that are listed.
  const { rows: lists } = await client.query(
    "SELECT id, slug, title FROM lists WHERE aggregates_published AND visibility = 'listed' ORDER BY created_at, id");
  for (const l of lists) {
    const { rows: fields } = await client.query(
      'SELECT key, label FROM list_fields WHERE list_id = $1 AND aggregatable AND retention <> \'absent\' ORDER BY position, id', [l.id]);
    const { rows: entries } = await client.query(
      'SELECT created_at, review_state, answers FROM list_entries WHERE list_id = $1', [l.id]);
    for (const [w, days] of Object.entries(WINDOWS)) {
      const from = since(days);
      const inWin = entries.filter((e) => !from || new Date(e.created_at) >= from);
      const appr = inWin.filter((e) => e.review_state === 'approved');
      const g = `List: ${l.title}`;
      out.push({ id: `list.${l.slug}.received.${w}`, group: g, label: `${l.title}: received ${WINDOW_WORDS[w]}`, value: inWin.length });
      out.push({ id: `list.${l.slug}.approved.${w}`, group: g, label: `${l.title}: approved, of those received ${WINDOW_WORDS[w]}`, value: appr.length });
      for (const f of fields) {
        const seen = new Map();
        const add = (set, e) => {
          const v = e.answers?.[f.key];
          if (v === undefined) return;
          for (const one of Array.isArray(v) ? v : [v]) {
            const k = String(one);
            if (!seen.has(k)) seen.set(k, { received: 0, approved: 0 });
            seen.get(k)[set] += 1;
          }
        };
        inWin.forEach((e) => add('received', e));
        appr.forEach((e) => add('approved', e));
        for (const [v, n] of seen) {
          const base = `list.${l.slug}.${f.key}.${valueId(v)}`;
          out.push({ id: `${base}.received.${w}`, group: g, label: `${l.title}: "${f.label}" answered "${v}", received ${WINDOW_WORDS[w]}`, value: n.received });
          out.push({ id: `${base}.approved.${w}`, group: g, label: `${l.title}: "${f.label}" answered "${v}", approved ${WINDOW_WORDS[w]}`, value: n.approved });
        }
      }
    }
  }

  cache = { at: Date.now(), data: out };
  return out;
}

/** id → value, for renderText. */
export async function figureValues(opts) {
  return Object.fromEntries((await catalogue(opts)).map((f) => [f.id, f.value]));
}

/** Render every text in a key → text map. */
export async function renderCopy(copy, opts) {
  const any = Object.values(copy || {}).some((t) => typeof t === 'string' && t.includes('{{'));
  if (!any) return copy;
  const values = await figureValues(opts);
  return Object.fromEntries(Object.entries(copy).map(([k, t]) => [k, typeof t === 'string' ? renderText(t, values) : t]));
}
