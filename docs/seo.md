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
- **The page's head written on the server** (`apps/api/src/site/pageHead.ts`).
  Caddy serves a real file as it is and hands every other address to
  `GET /api/site/page/<path>`, which answers `index.html` with a title, a
  description, the canonical address, the robots tag and `og:`/`twitter:`
  tags for that address, and a real 404 where the address is clearly nothing
  (no such logbook, list or map at `/<slug>`, `/maps/<slug>`, or published
  report at `/board/<ref>`; everything else is 200). The fixed pages'
  wording is the `PAGES` table in that file; logbooks, lists and maps use
  their own title and blurb, the front page the operator's headline and
  lede. Behind the site password it says only the site's name and noindex,
  and always 200. The share image is `og:image` (`/api/site/share.png`).
  The page script still sets the head while somebody moves about.
- **The share cards** (`apps/api/src/site/shareImage.ts`, the owner's
  approved design of 30 October): 1200×630, near-black with the band of
  stripes and stars (`apps/api/assets/share/ground.png`) and the wordmark in
  the site's own runs. The front page's card is the hero's own headline, its
  second line outlined, and its slogan in a white bar. Every other page's is
  its name and sentence from the head, with the hero's eyebrow in the corner
  and an amber rule along the foot. Behind the password, or for an address
  that is nothing, the wordmark alone. Each page's head names its own card
  (`/api/site/share.png?path=/board`). Drawn by ImageMagick with the site's
  faces as TTF (`apps/api/assets/share/fonts/`, Archivo fixed at width 125
  and weight 800, the widest and heaviest the site's variable Archivo has),
  kept in memory by what is drawn; without ImageMagick, the plain ground.
- **The icons** (`apps/web/public/icons/`, `apps/web/public/favicon.ico`): the
  owner's EL mark on the amber button tile. The browser tab's is the tile
  alone, edge to edge; the home-screen and manifest icons have the white
  border and hard shadow. The project site copies the same files.

## To do on a server

- **test3: set `SEARCH_ENGINES=off`** in `/etc/reportlog/reportlog.env` and
  restart. Its password is often off, and without this it can show up in
  search results in place of the real site.
- **Tell the search engines the site exists**: Google Search Console and
  Bing Webmaster Tools, verified by a DNS record (nothing on the page), then
  submit `https://<site>/sitemap.xml`.

## Decisions

- **A single report (`/board/RL-...`) is not indexed** (the owner, 30
  October). Indexing would make a reporter's published words findable by
  searching for them, for good (DPIA risk 1). Its page says noindex and the
  server writes no words of it into the head.
- **The project site** (`apps/site`) asks not to be indexed (`INDEXED` in
  `apps/site/src/layout.ts`, decided 23 October). Flipping it is the change.

## Left, each more than 30 to 50 minutes

1. **Report images sized for the page (1 to 1.5 hours).** The media worker
   (`apps/api/src/files/media.ts`) re-encodes every photo with ImageMagick
   but appears to keep its full size, so the board serves phone photos at
   full resolution. Cap the published copy (about 1600 px) with a smaller
   one for `srcset`, store its width and height (a migration, the database
   types, `PublishedFile` in the contracts) and set them on the `<img>` in
   `apps/web/src/features/files/PublishedFiles.tsx`, so the page does not
   jump as pictures load. Files already published stay as they are unless
   re-processed.
2. **Load only the fonts in use (about an hour).** 28 font files ship; a page
   should preload only the one or two the site's look uses.

## Noticed on the way

`RESERVED_SLUGS` (`packages/contracts/src/slugs.ts`) does not name `account`,
`people` or `map`, which are pages. A logbook given one of those addresses
would be hidden behind the page. `indexable` works around it (`NOT_A_FORM`);
adding them to the reserved list is the real fix.
