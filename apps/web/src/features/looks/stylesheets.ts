/**
 * Linking the installed look packs' stylesheets (stage 6). The server sends
 * their addresses with the look, on /api/site and on the lock screen's own
 * call alike; applyLook (components/ui/site.tsx) hands them here, and the
 * remembered look carries them too, so a returning reader of a site wearing
 * a pack's look gets the pack's stylesheet before the first paint.
 *
 * Only an address on this site, in the exact shape the server writes
 * (`/api/looks/<pack>/<sha256>.css`), is ever linked: a value read back from
 * localStorage is somebody's to edit, and must not be able to make the page
 * fetch from another host.
 */
import { LOOK_STYLESHEET } from '@reportlog/contracts';

const MARK = 'data-look-pack';

/** Make the page link exactly these pack stylesheets, after the built-in looks. */
export function linkStylesheets(hrefs: readonly string[], doc: Document = document): void {
  const wanted = hrefs.filter((h) => LOOK_STYLESHEET.test(h));
  const present = [...doc.head.querySelectorAll<HTMLLinkElement>(`link[${MARK}]`)];
  for (const link of present) {
    if (!wanted.includes(link.getAttribute('href') ?? '')) link.remove();
  }
  for (const href of wanted) {
    if (present.some((l) => l.isConnected && l.getAttribute('href') === href)) continue;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute(MARK, '');
    // Last in <head>, so after the built-in looks' stylesheet. Their
    // selectors never overlap (ids are unique across packs), so the order
    // is for whoever reads the page, not for the cascade.
    doc.head.append(link);
  }
}

/** The pack stylesheets the page links now. */
export function linkedStylesheets(doc: Document = document): string[] {
  return [...doc.head.querySelectorAll<HTMLLinkElement>(`link[${MARK}]`)].map(
    (l) => l.getAttribute('href') ?? '',
  );
}
