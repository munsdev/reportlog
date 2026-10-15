// Service worker — the piece Chrome requires before it will offer "Install
// app" rather than a plain home-screen shortcut. Deliberately thin: this is
// an incident-reporting app, so showing stale reports would be worse than
// showing nothing. Nothing under /api/ is ever cached or served offline.
//
// THE PAGE, ITS SCRIPTS AND ITS STYLES ARE ALL NETWORK-FIRST. The cache is
// what a device falls back to OFFLINE, never what it prefers online.
//
// That was not true until 10 October, and the reason is worth keeping. Page
// loads were network-first "so a deploy lands immediately", but every
// script and stylesheet was served CACHE-FIRST, forever, refreshed only
// when somebody remembered to bump CACHE below. Nobody did for 37 commits,
// from 29 September. So a browser that had visited once kept that day's
// JavaScript under every later page: new HTML running old modules. It
// surfaced on the first real install, where the admin pane went on drawing
// the old build line after the server had moved on. The browser suite never
// saw it because every run starts with an empty profile.
//
// A rule that only holds while a person remembers it is not a rule, so
// freshness no longer depends on the bump. Bump CACHE when this file's own
// logic changes, or to drop old entries from devices — public/index.html,
// public/tokens.css, public/client-first.css, public/css/ and public/js/
// all land without it now.
const CACHE = 'reportlog-shell-v18';

// The frontend is one page, eight stylesheets and twenty-nine modules, and
// every one of them is precached with it: a shell that came back from the
// cache without them would draw unstyled, or not run at all.
//
// `npm test` reads the <link> and <script src> list out of public/index.html
// and fails if anything the page asks for is missing here, so this list
// cannot quietly fall behind the page again — which it did twice.
const SHELL = [
  '/',
  '/tokens.css',
  '/css/page.css',
  '/css/form.css',
  '/css/reports.css',
  '/css/pages.css',
  '/css/gate.css',
  '/css/directory.css',
  '/css/issues.css',
  '/css/shell.css',
  '/css/changelog.css',
  '/css/numbers.css',
  '/css/map.css',
  '/css/standards.css',
  '/client-first.css',
  '/js/conditions.js',
  '/js/answers.js',
  '/js/nav.js',
  '/js/evidence.js',
  '/js/routes.js',
  '/js/session.js',
  '/js/attachments.js',
  '/js/form.js',
  '/js/form-logbook.js',
  '/js/board.js',
  '/js/map.js',
  '/js/mine.js',
  '/js/moderate.js',
  '/js/admin-editors.js',
  '/js/admin-look.js',
  '/js/admin-settings.js',
  '/js/admin-updates.js',
  '/js/logbook-builder.js',
  '/js/admin-lists.js',
  '/js/admin-maps.js',
  '/js/admin-translog.js',
  '/js/list-review.js',
  '/js/list-form.js',
  '/js/home-buttons.js',
  '/js/roles.js',
  '/js/directory.js',
  '/js/feedback.js',
  '/js/contents.js',
  '/js/gate.js',
  '/js/identity.js',
  '/js/setup.js',
  '/js/boot.js',
  '/js/sw-register.js',
  '/js/boot-guard.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Don't let one 404 abort the install and leave the app uninstallable.
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fonts, anything third-party
  if (url.pathname.startsWith('/api/')) return;    // never cache report data

  // Page loads: always try the network first so a deploy lands immediately,
  // and fall back to the cached shell only when the device is offline. Deep
  // links (/board, /r/:ref …) all resolve to the same shell, which is what
  // the server's own catch-all returns for them anyway.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only a good response may replace the offline shell. The Cache API
          // will happily store a 502 or a maintenance page, and that would
          // then be what people see the next time they are offline.
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('/', copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('/', { ignoreSearch: true })),
    );
    return;
  }

  // Icons and the manifest: cache-first. They change only with a CACHE bump,
  // and they are the one thing whose staleness costs nothing.
  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
    return;
  }

  // Everything else the page loads — its scripts and styles — NETWORK-FIRST,
  // exactly like the page, so the HTML and the code it runs always come from
  // the same deploy. The browser's own HTTP cache still applies to the
  // fetch, so an unchanged file costs a revalidation, not a download.
  //
  // ALWAYS ASKING THE SERVER, not the browser's own cache. nginx sends no
  // caching instruction for /js/ or /css/, so a plain fetch let the browser
  // decide a file was still fresh — and an owner's browser held one old
  // module beside new ones after an update, which stopped every script and
  // left a white page (10 October). `no-cache` revalidates: an unchanged
  // file costs a 304, never a download, and a changed one is never missed.
  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((hit) => hit || Response.error())),
  );
});
