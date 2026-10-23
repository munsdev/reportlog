/**
 * Builds the project site (www.reportlog.org) into `apps/site/dist`.
 *
 * Cloudflare Pages runs this on every push to `main` (project
 * `reportlog-docs`, build command
 * `node --experimental-strip-types apps/site/src/build.ts`, output
 * `apps/site/dist`, `SKIP_DEPENDENCY_INSTALL=1`), so it uses nothing but
 * Node. NOBODY UPLOADS THIS SITE BY HAND: a hand-made deployment is right on
 * the day and silently wrong afterwards, and the point of building from the
 * repository is that the install guide cannot fall behind the installer.
 *
 * This is the project's site, not a deployment: it must never carry the
 * application's own pages, which would look like a ReportLog that cannot
 * accept a report. It builds from `deploy/README.md` and `CHANGELOG.md` and
 * its own pages, and copies nothing from `apps/web` but fonts and icons.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCS_INDEX, HOME, USING } from './content.ts';
import { SOURCE, page } from './layout.ts';
import { type Heading, escapeHtml, renderMarkdown } from './markdown.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../..');

const FONTS = [
  'Archivo-variable.woff2',
  'PublicSans-400.woff2',
  'PublicSans-700.woff2',
  'IBMPlexMono-400.woff2',
];
const FONT_LICENCES = ['archivo.txt', 'publicsans.txt', 'ibmplexmono.txt'];
const ICONS = ['favicon-32.png', 'apple-touch-icon.png'];

/** A link in a Markdown file, made to work from the site rather than from the file's folder. */
function linkFrom(file: string) {
  return (href: string): string => {
    if (/^(https?:|mailto:|#)/.test(href)) return href;
    const target = join(dirname(file), href).replaceAll('\\', '/');
    return `${SOURCE}/blob/main/${target}`;
  };
}

function contents(headings: Heading[]): string {
  const items = headings
    .filter((h) => h.level === 2)
    .map((h) => `<li><a href="#${h.id}">${escapeHtml(h.text.replace(/`/g, ''))}</a></li>`)
    .join('');
  return `<nav class="toc" aria-label="Contents"><ol>${items}</ol></nav>`;
}

function commit(): string {
  const fromPages = process.env.CF_PAGES_COMMIT_SHA;
  if (fromPages) return fromPages;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function version(): string {
  const pkg: unknown = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  if (pkg && typeof pkg === 'object' && 'version' in pkg && typeof pkg.version === 'string') {
    return pkg.version;
  }
  return 'unknown';
}

function installPage(): string {
  const file = 'deploy/README.md';
  const { html, headings } = renderMarkdown(readFileSync(join(ROOT, file), 'utf8'), {
    rewriteLink: linkFrom(file),
  });
  return page({
    path: '/docs/install/',
    title: 'Install and operate',
    description: 'Setting up a ReportLog server, deploying, updating, rolling back and restoring.',
    wide: true,
    body: `<div class="with-toc">${contents(headings)}<article class="doc">
<p class="eyebrow">Documentation · <a href="${SOURCE}/blob/main/${file}">${file}</a></p>
${html}
</article></div>`,
  });
}

function releasesPage(): string {
  const file = 'CHANGELOG.md';
  const source = readFileSync(join(ROOT, file), 'utf8');
  // The file opens with notes on its own format, for whoever edits it.
  // The page starts at the first release.
  const first = source.search(/^## /m);
  const { html } = renderMarkdown(first === -1 ? source : source.slice(first), {
    rewriteLink: linkFrom(file),
  });
  return page({
    path: '/docs/releases/',
    title: 'Releases',
    description: 'What changed in each ReportLog release.',
    body: `<p class="eyebrow">Documentation · <a href="${SOURCE}/blob/main/${file}">${file}</a></p>
<h1>Releases</h1>
<p class="lede">What changed in each release, newest first, written for the people who use and run a site. A server shows the same notes with <code>sudo reportlog updates</code>.</p>
<div class="doc">${html}</div>`,
  });
}

const HEADERS = `/*
  Content-Security-Policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
`;

/** The old guide's addresses, so a link to one still lands somewhere useful. */
const REDIRECTS = `/docs.html /docs/install/ 301
/docs/index.html /docs/ 301
`;

export function build(out = join(ROOT, 'apps/site/dist')): string[] {
  rmSync(out, { recursive: true, force: true });
  const written: string[] = [];
  const write = (path: string, text: string) => {
    const full = join(out, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
    written.push(path);
  };
  const copy = (from: string, to: string) => {
    const full = join(out, to);
    mkdirSync(dirname(full), { recursive: true });
    copyFileSync(join(ROOT, from), full);
    written.push(to);
  };

  write(
    'index.html',
    page({
      path: '/',
      title: 'ReportLog',
      description:
        'Free software for incident reports: every report sealed, chained and moderated, and checkable by anybody.',
      wide: true,
      body: HOME,
    }),
  );
  write(
    'docs/index.html',
    page({
      path: '/docs/',
      title: 'Documentation',
      description: 'How to install and run a ReportLog site.',
      body: DOCS_INDEX,
    }),
  );
  write(
    'docs/using/index.html',
    page({
      path: '/docs/using/',
      title: 'Using ReportLog',
      description: 'Logbooks, launching, roles, moderation and checking a report.',
      body: USING,
    }),
  );
  write('docs/install/index.html', installPage());
  write('docs/releases/index.html', releasesPage());
  write(
    '404.html',
    page({
      path: '/404',
      title: 'Not found',
      description: 'There is no page at this address.',
      body: `<h1>There is no page here</h1><p class="lede">The address may be from the old guide. Everything it covered is now under <a href="/docs/">Documentation</a>.</p>`,
    }),
  );

  write('site.css', readFileSync(join(HERE, 'site.css'), 'utf8'));
  for (const f of FONTS) copy(`apps/web/src/fonts/${f}`, `fonts/${f}`);
  for (const f of FONT_LICENCES) copy(`apps/web/src/fonts/licences/${f}`, `fonts/licences/${f}`);
  for (const f of ICONS) copy(`apps/web/public/icons/${f}`, f);

  write('_headers', HEADERS);
  write('_redirects', REDIRECTS);
  write('robots.txt', 'User-agent: *\nAllow: /\n');
  write(
    'BUILD.txt',
    `Built from munsdev/reportlog by apps/site/src/build.ts
ReportLog version: ${version()}
Commit: ${commit()}
Built: ${new Date().toISOString()}

Do not edit or upload these files. They are generated on every push to main.
`,
  );
  return written;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ? resolve(process.argv[2]) : undefined;
  const files = build(out);
  console.log(`Built ${files.length} files.`);
}
