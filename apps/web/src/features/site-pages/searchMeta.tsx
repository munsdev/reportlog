/**
 * What search engines are told about the page in front of them: whether to
 * index it (`<meta name="robots">`), and its one address
 * (`<link rel="canonical">`, without the query, so /board?q=... is not a
 * thousand copies of the board).
 *
 * Which pages may be indexed is `indexable` (packages/contracts/src/robots.ts),
 * the list the sitemap is built from. Everything else, a door and every
 * staff screen included, says noindex. robots.txt keeps crawlers off the
 * addresses that carry a token; this covers the rest.
 *
 * Set from the page script because the page is drawn here: a crawler that
 * does not run it reads index.html, which names no page. Writing the head
 * on the server is a separate piece of work (docs/seo.md).
 */
import { indexable, plainPath } from '@reportlog/contracts';
import { useLocation } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useGateMode } from '../identity/gateMode.ts';

function headTag<K extends 'meta' | 'link'>(
  tag: K,
  attr: 'name' | 'rel',
  value: string,
): HTMLElementTagNameMap[K] {
  const found = document.head.querySelector<HTMLElementTagNameMap[K]>(`${tag}[${attr}="${value}"]`);
  if (found) return found;
  const made = document.createElement(tag);
  made.setAttribute(attr, value);
  document.head.append(made);
  return made;
}

/** Say whether this page may be indexed, and name its address when it may. */
export function setSearchMeta(pathname: string, index: boolean): void {
  headTag('meta', 'name', 'robots').content = index ? 'index, follow' : 'noindex';
  if (index) {
    headTag('link', 'rel', 'canonical').href = window.location.origin + plainPath(pathname);
  } else {
    document.head.querySelector('link[rel="canonical"]')?.remove();
  }
}

/**
 * In the root layout, BEFORE the page: React runs a sibling's effects in
 * order, so a page that knows better (the not-found page) runs after this and
 * has the last word.
 */
export function SearchMeta() {
  const { pathname } = useLocation();
  const door = useGateMode() === 'door';
  useEffect(() => {
    setSearchMeta(pathname, !door && indexable(pathname));
  }, [pathname, door]);
  return null;
}

/** For a page that must never be indexed whatever its address (not found, the lock screen). */
export function useNoIndex(): void {
  // Read from window, not the router: the lock screen is drawn outside it.
  const pathname = typeof window === 'undefined' ? '/' : window.location.pathname;
  useEffect(() => {
    setSearchMeta(pathname, false);
  }, [pathname]);
}
