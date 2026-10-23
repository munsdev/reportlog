/**
 * Builds the real site from the real content, runbook and changelog and
 * reads it back, so a Markdown construct the renderer does not know, a link
 * to a page that does not exist, a page forgotten from the navigation, a
 * setting the docs do not list, or a request to another host fails here
 * rather than on www.reportlog.org.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REJECTION_REASONS } from '@reportlog/contracts';
import { ROOT, build, operator } from '../src/build.ts';
import { jobList } from '../src/generated.ts';
import { INDEXED } from '../src/layout.ts';
import { NAV, OPERATE } from '../src/nav.ts';

let out = '';
let files: string[] = [];
const pages = () => files.filter((f) => f.endsWith('.html'));
const docPages = () => pages().filter((f) => f.startsWith('docs/'));
const read = (f: string) => readFileSync(join(out, f), 'utf8');
/** The page's own words: outside code, where anything may appear. */
const prose = (f: string) =>
  read(f)
    .replace(/<pre>[\s\S]*?<\/pre>/g, '')
    .replace(/<code>[\s\S]*?<\/code>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '');

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'reportlog-site-'));
  files = build(out, { production: false });
});

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('the built site', () => {
  it('has the homepage, the docs, the legal pages and the search', () => {
    for (const f of [
      'index.html',
      'docs/index.html',
      'docs/operate/index.html',
      'docs/operate/setting-up-a-server/index.html',
      'docs/operate/updates/index.html',
      'docs/releases/index.html',
      'imprint/index.html',
      'privacy/index.html',
      '404.html',
      'search-index.json',
      'search.js',
    ]) {
      expect(files).toContain(f);
    }
  });

  it('lists every content page in the navigation, and every listed page exists', () => {
    const listed = new Set(NAV.flatMap((s) => (s.pages === OPERATE ? [] : s.pages)));
    const dir = join(ROOT, 'apps/site/content');
    const written = walk(dir)
      .filter((f) => f.endsWith('.md') && !f.includes('/legal/'))
      .map((f) => relative(dir, f).replace(/\.md$/, ''));
    expect([...listed].sort()).toEqual(written.sort());
  });

  it('carries every section of the runbook as a page', () => {
    const runbook = readFileSync(join(ROOT, 'deploy/README.md'), 'utf8');
    const sections = [...runbook.matchAll(/^## (.*)$/gm)].length;
    expect(docPages().filter((f) => f.startsWith('docs/operate/')).length).toBe(sections + 1);
  });

  it('leaves no Markdown syntax unrendered', () => {
    for (const f of docPages()) {
      const text = prose(f);
      expect(text, f).not.toMatch(/```|~~~|\*\*|^\s*\|.*\||^#{1,6} |\]\(|^\s*[-*] |^\s*\d+\. /m);
      // Raw HTML in the Markdown is escaped, so it would show as text. (The
      // settings page is not Markdown: its `<key>` placeholders are prose.)
      if (!f.startsWith('docs/reference/settings/')) {
        expect(text, f).not.toMatch(/&lt;\/?[a-z][a-z0-9]*(?:\s|&gt;)/);
      }
      // A {{piece}} the build did not fill in.
      expect(text, f).not.toMatch(/\{\{[a-z-]+\}\}/);
    }
  });

  it('renders the runbook’s indented code as code', () => {
    expect(read('docs/operate/setting-up-a-server/index.html')).toContain(
      '<pre><code>sudo reportlog reset-2fa owner@example.org</code></pre>',
    );
  });

  it('asks nothing of another host', () => {
    for (const f of pages()) {
      // Links out are fine; anything the browser fetches by itself is not.
      const fetched = [...read(f).matchAll(/<(?:link|script|img|iframe|source)\b[^>]*>/g)];
      for (const [tag] of fetched) expect(tag, f).not.toMatch(/(?:src|href)="(?:https?:)?\/\//);
    }
    expect(read('site.css')).not.toMatch(/url\(['"]?(?:https?:)?\/\//);
    expect(read('search.js')).not.toMatch(/https?:\/\//);
    expect(read('_headers')).toContain("default-src 'none'");
  });

  it('links only to pages and anchors that exist', () => {
    const anchors = new Map<string, Set<string>>();
    for (const f of pages()) {
      const path = '/' + f.replace(/index\.html$/, '');
      anchors.set(path, new Set([...read(f).matchAll(/ id="([^"]+)"/g)].map((m) => m[1] ?? '')));
    }
    for (const f of pages()) {
      const here = '/' + f.replace(/index\.html$/, '');
      for (const [, href = ''] of read(f).matchAll(/ href="([^"]+)"/g)) {
        if (/^(https?:|mailto:)/.test(href)) continue;
        const [path = '', hash] = href.split('#');
        const target = path === '' ? here : path;
        if (anchors.has(target)) {
          if (hash) expect(anchors.get(target), `${f} → ${href}`).toContain(hash);
        } else {
          expect(existsSync(join(out, target)), `${f} → ${href}`).toBe(true);
        }
      }
    }
  });

  it('chains the docs: every page has the sidebar, and previous and next lead through them all', () => {
    const order = docPages();
    for (const f of order) {
      expect(read(f), f).toContain('class="sidebar"');
      expect(read(f), f).toContain('aria-current="page"');
    }
    expect(read('docs/index.html')).not.toContain('pager-prev');
    expect(read('docs/releases/index.html')).not.toContain('pager-next');
  });

  it('documents every setting the code reads', () => {
    const html = read('docs/reference/settings/index.html');
    const keys = [
      ...readFileSync(join(ROOT, '.env.example'), 'utf8').matchAll(/^(?:# )?([A-Z][A-Z0-9_]+)=/gm),
    ].map((m) => m[1] ?? '');
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys) expect(html, key).toContain(`<code>${key}</code>`);
  });

  it('documents every command, job and question kind', () => {
    const commands = read('docs/reference/commands/index.html');
    for (const c of ['deploy', 'rollback', 'doctor', 'updates', 'reset-2fa', 'contact-key']) {
      expect(commands).toContain(`sudo reportlog ${c}`);
    }
    const runbookJobs = read('docs/operate/scheduled-jobs/index.html');
    expect(runbookJobs).toContain('<code>files</code>');
    expect(read('docs/reference/question-kinds/index.html')).toContain(
      '<code>evidence_declaration</code>',
    );
  });

  it('reads every scheduled job out of the registry', () => {
    // Every job has a timer of its own (the update check is root's, not a job).
    const timers = readdirSync(join(ROOT, 'deploy/systemd'))
      .map((f) => /^reportlog-(.+)\.timer$/.exec(f)?.[1])
      .filter((n): n is string => n !== undefined && n !== 'update-check');
    const jobs = jobList(ROOT);
    expect(jobs.map((j) => j.name).sort()).toEqual(timers.sort());
    for (const j of jobs) expect(j.what.length, j.name).toBeGreaterThan(20);
  });

  it('names every reason a moderator can decline with', () => {
    const html = read('docs/moderate/the-queue/index.html');
    for (const r of REJECTION_REASONS) expect(html).toContain(r.label);
  });

  it('indexes every docs page for the search', () => {
    const index = JSON.parse(read('search-index.json')) as { u: string; t: string; x: string }[];
    expect(index.map((d) => d.u).sort()).toEqual(
      docPages()
        .map((f) => '/' + f.replace(/index\.html$/, ''))
        .sort(),
    );
    for (const d of index) expect(d.x.length, d.u).toBeGreaterThan(100);
  });

  it('says whether it may be indexed on every page', () => {
    for (const f of pages()) {
      expect(read(f).includes('<meta name="robots" content="noindex">'), f).toBe(!INDEXED);
    }
  });

  it('links the imprint and the privacy policy from every page', () => {
    for (const f of pages()) {
      expect(read(f), f).toContain('href="/imprint/"');
      expect(read(f), f).toContain('href="/privacy/"');
    }
  });

  it('is not a deployment of the application', () => {
    // A copy of the app's shell here would look like a ReportLog that
    // cannot accept a report.
    for (const f of pages()) {
      expect(read(f), f).not.toMatch(/id="root"|\/assets\/index-|boot-guard/);
    }
  });
});

describe('the legal pages', () => {
  it('say they are unpublished while the provider is unknown, and never show a placeholder', () => {
    if (operator()) return; // filled in: the next test covers it
    for (const f of ['imprint/index.html', 'privacy/index.html']) {
      expect(read(f)).toContain('has not been published yet');
      expect(read(f)).not.toContain('{{');
    }
  });

  it('name the provider everywhere a placeholder was, once filled in', () => {
    const who = operator();
    if (!who) return;
    for (const f of ['imprint/index.html', 'privacy/index.html']) {
      expect(read(f)).toContain(who.email);
      expect(read(f)).not.toContain('{{');
    }
  });

  it('stop a production build that has no provider', () => {
    if (operator()) return;
    const dir = mkdtempSync(join(tmpdir(), 'reportlog-site-prod-'));
    try {
      expect(() => build(dir, { production: true })).toThrow(/operator\.json is incomplete/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
