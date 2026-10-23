/**
 * The frame every page of the project site shares.
 *
 * Every address is relative to the site root and every file is served from
 * it: no fonts, scripts or images from anywhere else, the same rule the
 * application keeps. `_headers` enforces it with a Content-Security-Policy,
 * and `test/build.test.ts` checks the built pages for any other host.
 */
import { escapeHtml } from './markdown.ts';

/**
 * Search engines are asked not to index the site while it is new (the
 * owner's decision, 23 October 2026). Flipping this is the whole change when
 * that is decided. Widened to `boolean` so the checks on it type-check
 * either way.
 */
export const INDEXED = false as boolean;

export const SOURCE = 'https://github.com/munsdev/reportlog';

export interface PageInput {
  /** Where the page is served, e.g. `/docs/install/`. */
  path: string;
  title: string;
  description: string;
  body: string;
  /** Full width (the homepage, the install guide with its contents column) rather than prose width. */
  wide?: boolean;
}

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/docs/', label: 'Docs' },
  { href: '/docs/install/', label: 'Install' },
  { href: '/docs/releases/', label: 'Releases' },
] as const;

function current(path: string, href: string): boolean {
  if (href === '/') return path === '/';
  if (href === '/docs/') return path === '/docs/' || path === '/docs/using/';
  return path.startsWith(href);
}

export function page({ path, title, description, body, wide = false }: PageInput): string {
  const fullTitle = path === '/' ? 'ReportLog' : `${title} · ReportLog`;
  const nav = NAV.map(
    (n) =>
      `<a href="${n.href}"${current(path, n.href) ? ' aria-current="page"' : ''}>${n.label}</a>`,
  ).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${INDEXED ? '' : '<meta name="robots" content="noindex">\n'}<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="icon" href="/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/site.css">
</head>
<body>
<a class="skip" href="#main">Skip to the content</a>
<header class="masthead">
<div class="bar">
<a class="wordmark" href="/">ReportLog</a>
<nav aria-label="Site">${nav}<a href="${SOURCE}">Source</a></nav>
</div>
</header>
<main id="main" class="${wide ? 'wide' : 'prose'}">
${body}
</main>
<footer class="foot">
<div class="bar">
<p>ReportLog is free software under the AGPL-3.0-or-later. <a href="${SOURCE}">Read the source</a>.</p>
<p>This site loads nothing from any other site.</p>
</div>
</footer>
</body>
</html>
`;
}
