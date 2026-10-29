# Search engines and link previews

What the site tells search engines and the sites that draw a preview of a
shared link, what is built, and what is left. Written 29 October 2026.

## Built

- **`/robots.txt` and `/sitemap.xml`**, built by the API
  (`apps/api/src/site/robots.ts`) and handed to it by Caddy and by Vite.
  robots.txt keeps crawlers off `/api/` and every address that carries a
  token from an email. Behind the site password, or with `SEARCH_ENGINES=off`,
  it asks every crawler to stay out and the sitemap is empty.
- **One list of indexable pages**, `indexable` in
  `packages/contracts/src/robots.ts`, read by both the sitemap and the page.
  It is an allow-list: a page nobody added stays out of search.
- **A robots meta tag and a canonical address on every page**
  (`apps/web/src/features/site-pages/searchMeta.tsx`). `noindex` on staff
  screens, doors, the lock screen, the not-found page, a single report and
  everything not on the list. The canonical address drops the query, so
  `/board?q=...` is not a thousand copies of the board.
- **A default description** in `apps/web/index.html`, true of every
  deployment.

## To do on a server

- **test3: set `SEARCH_ENGINES=off`** in `/etc/reportlog/reportlog.env` and
  restart. Its password is often off, and without this it can show up in
  search results in place of the real site.
- **Tell the search engines the site exists**: Google Search Console and
  Bing Webmaster Tools, verified by a DNS record (nothing on the page), then
  submit `https://<site>/sitemap.xml`.

## Waiting on a decision

- **Should a single report (`/board/RL-...`) be indexed?** Not yet. Indexing
  makes a reporter's published words findable by searching for them, for
  good, which sits on DPIA risk 1. Adding them to `indexable` and the
  sitemap is the whole change.
- **The project site** (`apps/site`) asks not to be indexed (`INDEXED` in
  `apps/site/src/layout.ts`, decided 23 October). Flipping it is the change.

## Left, each more than 30 to 50 minutes

1. **The page's head written on the server (1.5 to 2 hours).** Today every
   address answers the same `index.html`; the title, the noindex and the
   canonical address are set by the page script, which Google runs and a
   link-preview bot (social media, chat apps) does not. Serve `index.html`
   through the API for page addresses, with the site's name, a per-page
   title and description, the canonical address and `og:`/`twitter:` tags
   filled in. The same change gives an unknown address a real 404 status
   instead of 200 with "That page isn't here" on it. Touches the Caddyfile's
   catch-all (and its test, `apps/api/test/unit/deploy-caddy.test.ts`).
2. **A share image (1 hour, with the above).** A 1200×630 card in the site's
   name and colours, served from the site itself, for `og:image`. Without
   item 1 nothing reads it.
3. **Report images sized for the page (1 to 1.5 hours).** The media worker
   (`apps/api/src/files/media.ts`) re-encodes every photo with ImageMagick
   but appears to keep its full size, so the board serves phone photos at
   full resolution. Cap the published copy (about 1600 px) with a smaller
   one for `srcset`, store its width and height (a migration, the database
   types, `PublishedFile` in the contracts) and set them on the `<img>` in
   `apps/web/src/features/files/PublishedFiles.tsx`, so the page does not
   jump as pictures load. Files already published stay as they are unless
   re-processed.
4. **A description per public page (30 to 45 minutes).** Each public page
   sets its title; none sets a description, so search results show whatever
   text the engine picks. Small once item 1 exists, since that is where it
   matters most.
5. **Load only the fonts in use (about an hour).** 28 font files ship; a page
   should preload only the one or two the site's look uses.

## Noticed on the way

`RESERVED_SLUGS` (`packages/contracts/src/slugs.ts`) does not name `account`,
`people` or `map`, which are pages. A logbook given one of those addresses
would be hidden behind the page. `indexable` works around it (`NOT_A_FORM`);
adding them to the reserved list is the real fix.
