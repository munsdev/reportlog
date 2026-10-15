/* sw-register.js — Registering the service worker, which is what makes the
 * page installable rather than a home-screen shortcut.
 *
 * In a file of its own rather than inline in the page, so that
 * public/index.html carries no inline script at all and a
 * Content-Security-Policy without ‘unsafe-inline’ is possible. nginx
 * serves the page off disk, so a per-request nonce is not available to it.
 */

// Registering the service worker is what turns this page from an
// add-to-home-screen shortcut into an installable app (Chrome won't offer
// "Install app" without one). Failure here is non-fatal by design — the
// site works exactly the same, it just isn't installable on that visit.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function (e) {
      console.warn('[pwa] service worker registration failed', e);
    });
  });
}
