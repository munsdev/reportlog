/**
 * Builds the real site from the real runbook and changelog and reads it
 * back, so a Markdown construct the renderer does not know, a link to a
 * page that does not exist, or a request to another host fails here rather
 * than on www.reportlog.org.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from '../src/build.ts';
import { INDEXED } from '../src/layout.ts';

let out = '';
let files: string[] = [];
const pages = () => files.filter((f) => f.endsWith('.html'));
const read = (f: string) => readFileSync(join(out, f), 'utf8');

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'reportlog-site-'));
  files = build(out);
});

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

describe('the built site', () => {
  it('has the homepage and every docs page', () => {
    for (const f of [
      'index.html',
      'docs/index.html',
      'docs/install/index.html',
      'docs/using/index.html',
      'docs/releases/index.html',
      '404.html',
    ]) {
      expect(files).toContain(f);
    }
  });

  it('carries the whole runbook', () => {
    const html = read('docs/install/index.html');
    for (const heading of [
      'setting-up-a-server',
      'deploying',
      'updates',
      'rolling-back',
      'restoring-a-backup',
      'when-something-is-wrong',
    ]) {
      expect(html).toContain(`id="${heading}"`);
    }
  });

  it('leaves no Markdown syntax unrendered', () => {
    for (const f of ['docs/install/index.html', 'docs/releases/index.html']) {
      // Code is allowed to contain anything, so look only outside it.
      const text = read(f)
        .replace(/<pre>[\s\S]*?<\/pre>/g, '')
        .replace(/<code>[\s\S]*?<\/code>/g, '');
      expect(text, f).not.toMatch(/```|~~~|\*\*|^\s*\|.*\||^#{1,6} |\]\(|^\s*[-*] |^\s*\d+\. /m);
      // Raw HTML in the Markdown is escaped, so it would show as text.
      expect(text, f).not.toMatch(/&lt;\/?[a-z][a-z0-9]*(?:\s|&gt;)/);
    }
  });

  it('asks nothing of another host', () => {
    for (const f of pages()) {
      // Links out are fine; anything the browser fetches by itself is not.
      const fetched = [...read(f).matchAll(/<(?:link|script|img|iframe|source)\b[^>]*>/g)];
      for (const [tag] of fetched) expect(tag, f).not.toMatch(/(?:src|href)="(?:https?:)?\/\//);
    }
    expect(read('site.css')).not.toMatch(/url\(['"]?(?:https?:)?\/\//);
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

  it('says whether it may be indexed on every page', () => {
    for (const f of pages()) {
      expect(read(f).includes('<meta name="robots" content="noindex">'), f).toBe(!INDEXED);
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
