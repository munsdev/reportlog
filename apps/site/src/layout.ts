/**
 * The frames every page of the project site shares: the homepage's, and the
 * documentation's (sidebar, contents, previous and next).
 *
 * Every address is relative to the site root and every file is served from
 * it: no fonts, scripts or images from anywhere else, the same rule the
 * application keeps. `_headers` enforces it with a Content-Security-Policy,
 * and `test/build.test.ts` checks the built pages for any other host. The
 * one script, the search, is the site's own file, and every page works
 * without it.
 */
import { type Heading, escapeHtml } from './markdown.ts';

/**
 * Search engines are asked not to index the site while it is new (the
 * owner's decision, 23 October 2026). Flipping this is the whole change when
 * that is decided. Widened to `boolean` so the checks on it type-check
 * either way.
 */
export const INDEXED = false as boolean;

export const SOURCE = 'https://github.com/munsdev/reportlog';

export interface SidebarSection {
  title: string;
  pages: { url: string; title: string }[];
}

export interface DocPage {
  url: string;
  title: string;
  /** A shorter name for the sidebar, when the title is long. */
  navTitle?: string;
  description: string;
  section: string;
  html: string;
  headings: Heading[];
  /** The file the page is made from, for "Edit this page". */
  source: string;
}

const TOP_NAV = [
  { href: '/docs/', label: 'Docs' },
  { href: '/docs/operate/', label: 'Install' },
  { href: '/docs/releases/', label: 'Releases' },
] as const;

function head(title: string, description: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${INDEXED ? '' : '<meta name="robots" content="noindex">\n'}<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="icon" href="/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/site.css">
<script src="/search.js" defer></script>
</head>`;
}

function masthead(path: string): string {
  const nav = TOP_NAV.map((n) => {
    const here = path === n.href || (n.href !== '/docs/' && path.startsWith(n.href));
    const docs =
      n.href === '/docs/' &&
      path.startsWith('/docs/') &&
      !TOP_NAV.slice(1).some((o) => path.startsWith(o.href));
    return `<a href="${n.href}"${here || docs ? ' aria-current="page"' : ''}>${n.label}</a>`;
  }).join('');
  return `<a class="skip" href="#main">Skip to the content</a>
<header class="masthead">
<div class="bar">
<a class="wordmark" href="/">ReportLog</a>
<div class="search" data-search hidden>
<label class="visually-hidden" for="search-input">Search the documentation</label>
<input id="search-input" type="search" placeholder="Search the docs" autocomplete="off" spellcheck="false" aria-controls="search-results" aria-expanded="false">
<kbd class="search-key" aria-hidden="true">/</kbd>
<div id="search-results" class="search-results" role="listbox" hidden></div>
</div>
<nav aria-label="Site">${nav}<a href="${SOURCE}">Source</a></nav>
</div>
</header>`;
}

function footer(): string {
  return `<footer class="foot">
<div class="bar">
<nav aria-label="Legal"><a href="/imprint/">Imprint</a><a href="/privacy/">Privacy</a><a href="${SOURCE}">Source code</a></nav>
<p>ReportLog is free software under the GNU Affero General Public License, version 3 or later. This site sets no cookies and loads nothing from any other site.</p>
</div>
</footer>
</body>
</html>
`;
}

/** A page outside the documentation: the homepage, the legal pages, 404. */
export function page({
  path,
  title,
  description,
  body,
  wide = false,
}: {
  path: string;
  title: string;
  description: string;
  body: string;
  wide?: boolean;
}): string {
  const fullTitle = path === '/' ? 'ReportLog' : `${title} · ReportLog`;
  return `${head(fullTitle, description)}
<body>
${masthead(path)}
<main id="main" class="${wide ? 'wide' : 'prose'}">
${body}
</main>
${footer()}`;
}

function sidebarHtml(sections: SidebarSection[], url: string): string {
  return sections
    .map((s) => {
      const open = s.pages.some((p) => p.url === url);
      const items = s.pages
        .map(
          (p) =>
            `<li><a href="${p.url}"${p.url === url ? ' aria-current="page"' : ''}>${escapeHtml(p.title)}</a></li>`,
        )
        .join('');
      return `<div class="nav-section${open ? ' open' : ''}"><p class="nav-title">${escapeHtml(s.title)}</p><ul>${items}</ul></div>`;
    })
    .join('');
}

function onThisPage(headings: Heading[]): string {
  const items = headings
    .filter((h) => h.level === 2 || h.level === 3)
    .map(
      (h) =>
        `<li class="level-${h.level}"><a href="#${h.id}">${escapeHtml(h.text.replace(/`/g, ''))}</a></li>`,
    )
    .join('');
  return items
    ? `<nav class="on-this-page" aria-label="On this page"><p class="nav-title">On this page</p><ul>${items}</ul></nav>`
    : '';
}

/** A documentation page: sidebar, the article, its contents, previous and next. */
export function docPage(
  doc: DocPage,
  sections: SidebarSection[],
  prev: { url: string; title: string } | undefined,
  next: { url: string; title: string } | undefined,
): string {
  const side = sidebarHtml(sections, doc.url);
  const pager = [
    prev
      ? `<a class="pager-prev" href="${prev.url}"><span>Previous</span>${escapeHtml(prev.title)}</a>`
      : '<span></span>',
    next
      ? `<a class="pager-next" href="${next.url}"><span>Next</span>${escapeHtml(next.title)}</a>`
      : '<span></span>',
  ].join('');
  return `${head(`${doc.title} · ReportLog docs`, doc.description)}
<body>
${masthead(doc.url)}
<div class="docs">
<details class="mobile-nav"><summary>Documentation menu</summary><nav aria-label="Documentation">${side}</nav></details>
<aside class="sidebar"><nav aria-label="Documentation">${side}</nav></aside>
<main id="main" class="doc">
<p class="breadcrumbs"><a href="/docs/">Docs</a> <span aria-hidden="true">›</span> ${escapeHtml(doc.section)}</p>
<h1>${escapeHtml(doc.title)}</h1>
${doc.description ? `<p class="lede">${escapeHtml(doc.description)}</p>` : ''}
${doc.html}
<p class="edit"><a href="${SOURCE}/blob/main/${doc.source}">See this page's source</a></p>
<nav class="pager" aria-label="Previous and next">${pager}</nav>
</main>
${onThisPage(doc.headings)}
</div>
${footer()}`;
}
