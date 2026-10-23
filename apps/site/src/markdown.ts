/**
 * Markdown to HTML, for exactly the Markdown this repository writes.
 *
 * Why not a library: the site is built by Cloudflare Pages on every push to
 * `main`, and a build that needs no `pnpm install` cannot be broken by one.
 * The cost is that this handles a subset: ATX headings, paragraphs, fenced
 * code (also inside list items), pipe tables, block quotes, ordered and
 * unordered lists with indented continuation, and inline code, links, bold
 * and italics. `test/build.test.ts` renders the real runbook and changelog
 * and fails if any Markdown syntax survives into the output, so a construct
 * this does not know shows up as a red test, not as a page with pipes on it.
 */

export interface Heading {
  level: number;
  id: string;
  text: string;
}

export interface Rendered {
  html: string;
  headings: Heading[];
}

export interface Options {
  /** Turns a link target into the address the page should use. */
  rewriteLink?: (href: string) => string;
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** A heading's anchor, the way GitHub makes one, so links into the file still work here. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

/** Inline code first, so nothing inside backticks is read as emphasis or a link. */
export function inline(text: string, options: Options = {}): string {
  const rewrite = options.rewriteLink ?? ((href: string) => href);
  return text
    .split(/(`[^`]+`)/)
    .map((part) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      }
      return escapeHtml(part)
        .replace(
          /\[([^\]]+)\]\(([^)\s]+)\)/g,
          (_m, label: string, href: string) => `<a href="${rewrite(href)}">${label}</a>`,
        )
        .replace(/\*\*(\S(?:[^*]*?\S)?)\*\*/g, '<strong>$1</strong>')
        .replace(
          /(^|[^\p{L}\p{N}_*])[_*](\S(?:[^_*]*?\S)?)[_*](?=[^\p{L}\p{N}_*]|$)/gu,
          '$1<em>$2</em>',
        );
    })
    .join('');
}

const FENCE = /^(\s*)(`{3,})(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function indentOf(line: string): number {
  return /^\s*/.exec(line)?.[0].length ?? 0;
}

function startsBlock(line: string): boolean {
  return (
    HEADING.test(line) ||
    FENCE.test(line) ||
    ITEM.test(line) ||
    line.trimStart().startsWith('>') ||
    line.trimStart().startsWith('|')
  );
}

/** Splits a table row on pipes outside backticks. */
function cells(row: string): string[] {
  const out: string[] = [];
  let current = '';
  let inCode = false;
  const body = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (const ch of body) {
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

export function renderMarkdown(source: string, options: Options = {}): Rendered {
  const headings: Heading[] = [];
  const html = blocks(source.replace(/\r\n/g, '\n').split('\n'), options, headings);
  return { html, headings };
}

function blocks(lines: string[], options: Options, headings: Heading[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const indent = fence[1]?.length ?? 0;
      const marker = fence[2] ?? '```';
      const lang = (fence[3] ?? '').trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith(marker)) {
        body.push((lines[i] ?? '').slice(Math.min(indent, indentOf(lines[i] ?? ''))));
        i++;
      }
      i++;
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      const text = heading[2] ?? '';
      const id = uniqueId(slug(text.replace(/`/g, '')), headings);
      headings.push({ level, id, text });
      out.push(`<h${level} id="${id}">${inline(text, options)}</h${level}>`);
      i++;
      continue;
    }

    if (line.trimStart().startsWith('|') && TABLE_RULE.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? '').trimStart().startsWith('|')) {
        rows.push(cells(lines[i] ?? ''));
        i++;
      }
      const th = head.map((c) => `<th>${inline(c, options)}</th>`).join('');
      const tr = rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c, options)}</td>`).join('')}</tr>`)
        .join('');
      out.push(
        `<div class="table"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`,
      );
      continue;
    }

    if (line.trimStart().startsWith('>')) {
      const body: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trimStart().startsWith('>')) {
        body.push((lines[i] ?? '').trimStart().replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${blocks(body, options, headings)}</blockquote>`);
      continue;
    }

    const item = ITEM.exec(line);
    if (item) {
      const base = item[1]?.length ?? 0;
      const ordered = /\d/.test(item[2] ?? '');
      const start = ordered ? Number.parseInt(item[2] ?? '1', 10) : 1;
      const items: string[] = [];
      while (i < lines.length) {
        const m = ITEM.exec(lines[i] ?? '');
        if (!m || (m[1]?.length ?? 0) !== base || /\d/.test(m[2] ?? '') !== ordered) break;
        // Everything after the marker lines up here; continuation lines are
        // dedented by the same amount, so a code block inside an item is a
        // code block and not a paragraph with backticks in it.
        const width = base + (m[2]?.length ?? 1) + 1;
        const body = [m[3] ?? ''];
        i++;
        while (i < lines.length) {
          const next = lines[i] ?? '';
          if (next.trim() === '') {
            // A blank line ends the item unless the item carries on, indented.
            const after = lines.slice(i + 1).find((l) => l.trim() !== '') ?? '';
            if (indentOf(after) > base && !(ITEM.test(after) && indentOf(after) === base)) {
              body.push('');
              i++;
              continue;
            }
            break;
          }
          if (indentOf(next) > base) {
            body.push(next.slice(Math.min(width, indentOf(next))));
          } else if (!startsBlock(next) && body[body.length - 1] !== '') {
            body.push(next.trim()); // a lazy continuation line
          } else {
            break;
          }
          i++;
        }
        const tight = !body.includes('');
        let inner = blocks(body, options, headings);
        if (tight) inner = inner.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
        items.push(`<li>${inner}</li>`);
        while (i < lines.length && (lines[i] ?? '').trim() === '') {
          const after = ITEM.exec(lines[i + 1] ?? '');
          if (after && (after[1]?.length ?? 0) === base) i++;
          else break;
        }
      }
      const tag = ordered ? 'ol' : 'ul';
      const startAttr = ordered && start !== 1 ? ` start="${start}"` : '';
      out.push(`<${tag}${startAttr}>${items.join('')}</${tag}>`);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !startsBlock(lines[i] ?? '')) {
      para.push((lines[i] ?? '').trim());
      i++;
    }
    if (para.length === 0) {
      // A line that looked like a block start and was not one (a lone pipe):
      // keep it as text rather than loop on it.
      para.push(line.trim());
      i++;
    }
    out.push(`<p>${inline(para.join('\n'), options)}</p>`);
  }
  return out.join('\n');
}

function uniqueId(base: string, taken: Heading[]): string {
  let id = base || 'section';
  let n = 1;
  while (taken.some((h) => h.id === id)) id = `${base}-${n++}`;
  return id;
}
