/**
 * Builds the project site (www.reportlog.org) into `apps/site/dist`.
 *
 * Cloudflare Pages runs this on every push to `main` (project
 * `reportlog-docs`, build command
 * `node --experimental-strip-types apps/site/src/build.ts`, output
 * `apps/site/dist`, `SKIP_DEPENDENCY_INSTALL=1`), so it uses nothing but
 * Node. NOBODY UPLOADS THIS SITE BY HAND: a hand-made deployment is right on
 * the day and silently wrong afterwards, and the point of building from the
 * repository is that the docs cannot fall behind the code.
 *
 * Where the pages come from:
 *   content/*.md        the hand-written docs, in the order nav.ts gives
 *   deploy/README.md    "Running a server", one page per section
 *   CHANGELOG.md        the release notes
 *   generated.ts        settings, commands, jobs, roles, question kinds,
 *                       read out of the code
 *   content/legal/      the imprint and privacy policy, with the provider's
 *                       details from operator.json
 *
 * This is the project's site, not a deployment: it must never carry the
 * application's own pages, which would look like a ReportLog that cannot
 * accept a report. It copies nothing from `apps/web` but fonts and icons.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as generated from './generated.ts';
import { HOME } from './home.ts';
import { type DocPage, type SidebarSection, SOURCE, docPage, page } from './layout.ts';
import { type Heading, escapeHtml, frontMatter, renderMarkdown } from './markdown.ts';
import { NAV, OPERATE } from './nav.ts';
import { RUNBOOK, anchorPages, splitRunbook } from './operate.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../..');
const CONTENT = join(ROOT, 'apps/site/content');

const FONTS = [
  'Archivo-variable.woff2',
  'PublicSans-400.woff2',
  'PublicSans-700.woff2',
  'IBMPlexMono-400.woff2',
];
const FONT_LICENCES = ['archivo.txt', 'publicsans.txt', 'ibmplexmono.txt'];
const ICONS = ['favicon-32.png', 'apple-touch-icon.png'];

/** The docs' own URL for a page slug. The introduction is the docs' front page. */
export function urlOf(slug: string): string {
  return slug === 'introduction' ? '/docs/' : `/docs/${slug}/`;
}

/** A link in a repository Markdown file, made to work from the site. */
function repoLink(file: string, anchors?: Map<string, string>) {
  return (href: string): string => {
    if (/^(https?:|mailto:|\/)/.test(href)) return href;
    if (href.startsWith('#')) {
      const page = anchors?.get(href.slice(1));
      return page ? `${urlOf(page)}${href}` : href;
    }
    const target = join(dirname(file), href).replaceAll('\\', '/');
    return `${SOURCE}/blob/main/${target}`;
  };
}

/** Headings the generated HTML carries, for the page's contents column. */
function headingsIn(html: string): Heading[] {
  return [...html.matchAll(/<h([23]) id="([^"]+)">([\s\S]*?)<\/h\1>/g)].map((m) => ({
    level: Number(m[1]),
    id: m[2] ?? '',
    text: (m[3] ?? '').replace(/<a class="anchor"[\s\S]*?<\/a>/, '').replace(/<[^>]+>/g, ''),
  }));
}

/** `{{name}}` alone on a line in a content file: replaced by generated HTML. */
function expand(html: string): string {
  const pieces: Record<string, () => string> = {
    settings: () => generated.settings(ROOT),
    commands: () => generated.commands(ROOT),
    'question-kinds': () => generated.questionKinds(),
    roles: () => generated.roles(),
    jobs: () => generated.jobs(ROOT),
    'starting-points': () => generated.startingPoints(ROOT),
  };
  return html.replace(/<p>\{\{([a-z-]+)\}\}<\/p>/g, (_m, name: string) => {
    const make = pieces[name];
    if (!make) throw new Error(`content asks for {{${name}}}, which nothing generates`);
    return make();
  });
}

/** Words in a content file that come from the code: `{{palettes}}` and `{{themes}}`. */
function fill(source: string): string {
  const looks = generated.lookCounts(ROOT);
  return source
    .replaceAll('{{palettes}}', String(looks.palettes))
    .replaceAll('{{themes}}', String(looks.themes));
}

function contentPage(slug: string, section: string): DocPage {
  const file = `apps/site/content/${slug}.md`;
  const { data, body } = frontMatter(readFileSync(join(ROOT, file), 'utf8'));
  const rendered = renderMarkdown(fill(body), { rewriteLink: repoLink(file) });
  const html = expand(rendered.html);
  return {
    url: urlOf(slug),
    title: data.title ?? slug,
    ...(data.nav ? { navTitle: data.nav } : {}),
    description: data.description ?? '',
    section,
    html,
    headings: html === rendered.html ? rendered.headings : headingsIn(html),
    source: file,
  };
}

/** Every documentation page, in reading order, with the sidebar they share. */
export function docs(): { pages: DocPage[]; sidebar: SidebarSection[] } {
  const runbook = splitRunbook(readFileSync(join(ROOT, RUNBOOK), 'utf8'));
  const anchors = anchorPages(runbook.pages);
  const pages: DocPage[] = [];
  const sidebar: SidebarSection[] = [];

  for (const section of NAV) {
    const mine: DocPage[] = [];
    if (section.pages === OPERATE) {
      const intro = renderMarkdown(runbook.intro, { rewriteLink: repoLink(RUNBOOK, anchors) });
      const list = runbook.pages
        .map((p) => `<li><a href="${urlOf(p.slug)}">${escapeHtml(p.title)}</a></li>`)
        .join('');
      mine.push({
        url: '/docs/operate/',
        title: runbook.title,
        navTitle: 'Overview',
        description: 'Installing ReportLog on a server, and keeping it running.',
        section: section.title,
        html: `${intro.html}\n<h2 id="in-this-section">In this section<a class="anchor" href="#in-this-section" aria-label="Link to this section">#</a></h2><ul>${list}</ul>`,
        headings: [...intro.headings, { level: 2, id: 'in-this-section', text: 'In this section' }],
        source: RUNBOOK,
      });
      for (const p of runbook.pages) {
        const r = renderMarkdown(p.body, { rewriteLink: repoLink(RUNBOOK, anchors) });
        mine.push({
          url: urlOf(p.slug),
          title: p.title.replace(/`/g, ''),
          description: '',
          section: section.title,
          html: r.html,
          headings: r.headings,
          source: RUNBOOK,
        });
      }
    } else {
      for (const slug of section.pages) mine.push(contentPage(slug, section.title));
    }
    pages.push(...mine);
    sidebar.push({
      title: section.title,
      pages: mine.map((p) => ({ url: p.url, title: p.navTitle ?? p.title })),
    });
  }

  pages.push(releasesPage());
  sidebar.push({ title: 'Project', pages: [{ url: '/docs/releases/', title: 'Releases' }] });
  return { pages, sidebar };
}

function releasesPage(): DocPage {
  const file = 'CHANGELOG.md';
  const source = readFileSync(join(ROOT, file), 'utf8');
  // The file opens with notes on its own format, for whoever edits it.
  // The page starts at the first release.
  const first = source.search(/^## /m);
  const r = renderMarkdown(first === -1 ? source : source.slice(first), {
    rewriteLink: repoLink(file),
  });
  return {
    url: '/docs/releases/',
    title: 'Releases',
    description:
      'What changed in each release, newest first, written for the people who use and run a site. A server shows the same notes with sudo reportlog updates.',
    section: 'Project',
    html: r.html,
    headings: r.headings,
    source: file,
  };
}

// ── the legal pages ─────────────────────────────────────────────────────

export interface Operator {
  name: string;
  address: string[];
  email: string;
  phone?: string;
}

/**
 * The provider's details, or null while they are missing. A legal notice
 * that names nobody is worse than one that says it is not published, so
 * the pages say exactly that until the details exist, and a production
 * build (on Cloudflare Pages) refuses to go out without them.
 */
export function operator(): Operator | null {
  const raw: unknown = JSON.parse(readFileSync(join(CONTENT, 'legal/operator.json'), 'utf8'));
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const address = Array.isArray(o.address) ? o.address.map(str).filter(Boolean) : [];
  const name = str(o.name);
  const email = str(o.email);
  if (!name || !email || address.length < 2) return null;
  const phone = str(o.phone);
  return { name, address, email, ...(phone ? { phone } : {}) };
}

function legalPage(kind: 'imprint' | 'privacy', who: Operator | null): string {
  const file = `apps/site/content/legal/${kind}.md`;
  const { data, body } = frontMatter(readFileSync(join(ROOT, file), 'utf8'));
  const title = data.title ?? kind;
  let html: string;
  if (who) {
    // Filled in after rendering, escaped, so nothing in a name or an
    // address can be read as Markdown or markup.
    html = renderMarkdown(body)
      .html.replaceAll('<p>{{address}}</p>', `<p>${who.address.map(escapeHtml).join('<br>')}</p>`)
      .replaceAll('{{name}}', escapeHtml(who.name))
      .replaceAll('{{email}}', escapeHtml(who.email))
      .replaceAll(
        '<p>{{phone}}</p>',
        who.phone ? `<p>Telephone: ${escapeHtml(who.phone)}</p>` : '',
      );
  } else {
    html = `<p class="notice">This ${kind === 'imprint' ? 'imprint' : 'privacy policy'} has not been published yet: the provider's details are not filled in. It is not replaced by a placeholder, because a legal notice that names nobody is worse than none.</p>`;
  }
  return page({
    path: `/${kind}/`,
    title,
    description: data.description ?? '',
    body: `<h1>${escapeHtml(title)}</h1>\n${html}`,
  });
}

// ── assembling it ───────────────────────────────────────────────────────

const HEADERS = `/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
`;

/** Old addresses, so a link to one still lands on what replaced it. */
const REDIRECTS = `/docs.html /docs/operate/ 301
/docs/index.html /docs/ 301
/docs/install/ /docs/operate/ 301
/docs/using/ /docs/how-it-works/ 301
`;

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

const plain = (html: string) =>
  html
    .replace(/<a class="anchor"[\s\S]*?<\/a>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

export function build(
  out = join(ROOT, 'apps/site/dist'),
  options: { production?: boolean } = {},
): string[] {
  const production = options.production ?? process.env.CF_PAGES === '1';
  const who = operator();
  if (production && !who) {
    throw new Error(
      'apps/site/content/legal/operator.json is incomplete (name, email and an address of at least two lines). ' +
        'The site does not go out without an imprint and a privacy policy.',
    );
  }

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
  const fileFor = (url: string) => `${url.slice(1)}index.html`;

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

  const { pages, sidebar } = docs();
  pages.forEach((doc, i) => {
    write(fileFor(doc.url), docPage(doc, sidebar, pages[i - 1], pages[i + 1]));
  });
  write(
    'search-index.json',
    JSON.stringify(
      pages.map((d) => ({
        u: d.url,
        t: d.title,
        s: d.section,
        h: d.headings.filter((h) => h.level <= 3).map((h) => [h.id, h.text.replace(/`/g, '')]),
        x: plain(d.html).slice(0, 8000),
      })),
    ),
  );

  write('imprint/index.html', legalPage('imprint', who));
  write('privacy/index.html', legalPage('privacy', who));
  write(
    '404.html',
    page({
      path: '/404',
      title: 'Not found',
      description: 'There is no page at this address.',
      body: `<h1>There is no page here</h1><p class="lede">The address may be from the old guide. Everything it covered is now in the <a href="/docs/">documentation</a>.</p>`,
    }),
  );

  write('site.css', readFileSync(join(HERE, 'site.css'), 'utf8'));
  write('search.js', readFileSync(join(HERE, 'search.js'), 'utf8'));
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
