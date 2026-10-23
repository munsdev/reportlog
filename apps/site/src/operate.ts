/**
 * "Running a server": `deploy/README.md`, cut into one page per `##`
 * section. The runbook stays one file in the repository, next to the
 * scripts it describes; the site only splits it for reading.
 *
 * A link inside the runbook to one of its own headings (`#keys-and-secrets`)
 * points at whichever page that heading lands on, so cutting the file does
 * not break the links in it.
 */
import { slug } from './markdown.ts';

export interface OperatePage {
  slug: string;
  title: string;
  /** The Markdown of the page, its own `##` heading promoted to the title. */
  body: string;
}

export const RUNBOOK = 'deploy/README.md';

export function splitRunbook(source: string): {
  intro: string;
  title: string;
  pages: OperatePage[];
} {
  const text = source.replace(/\r\n/g, '\n');
  const title = /^# (.*)$/m.exec(text)?.[1]?.trim() ?? 'Running a server';
  const parts = text.split(/^(?=## )/m);
  const intro = (parts.shift() ?? '').replace(/^# .*$/m, '').trim();
  const pages = parts.map((part) => {
    const heading = /^## (.*)$/m.exec(part)?.[1]?.trim() ?? '';
    return {
      slug: `operate/${slug(heading.replace(/`/g, ''))}`,
      title: heading,
      // The page's title is its heading, so the sections under it move up a
      // level and the page has one h1.
      body: part
        .replace(/^## .*\n/, '')
        .replace(/^(#{3,6}) /gm, (_m, hashes: string) => `${hashes.slice(1)} `),
    };
  });
  return { intro, title, pages };
}

/** Every heading id in the runbook, mapped to the page it ends up on. */
export function anchorPages(pages: OperatePage[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const page of pages) {
    map.set(page.slug.slice('operate/'.length), page.slug);
    for (const m of page.body.matchAll(/^#{2,6} (.*)$/gm)) {
      map.set(slug((m[1] ?? '').replace(/`/g, '')), page.slug);
    }
  }
  return map;
}
