/* static-page-brand.js — Painting the deployment's name onto a page that is
 * served straight off disk.
 *
 * Shared by public/api.html and public/app.html, which carried a
 * byte-identical copy of this each. It is a file rather than inline script so
 * that no page in public/ has any, which is what lets a deployment set a
 * Content-Security-Policy without 'unsafe-inline' — nginx serves these off
 * disk and cannot supply a nonce. See docs/frontend-files.md.
 */
/* This page is a STATIC FILE — nginx serves it straight from disk, so the
   deployment's name cannot be rendered into it the way index.html gets it.
   It is fetched and painted instead, from the same status endpoint the main
   app uses; that path is proxied to the application even where this file is
   not, which is what makes this work at all.

   The literals in the markup are the default, and are exactly right for a
   deployment that has not renamed itself. If the fetch fails, the page is
   simply the page it was before any of this existed. */
(function(){
  function paint(n){
    document.querySelectorAll('[data-brand]').forEach(function(el){ el.textContent = n; });
    var t = document.querySelector('[data-brand-title]');
    if (t) document.title = t.getAttribute('data-brand-title').split('{}').join(n);
  }
  fetch('/api/site-access/status')
    .then(function(r){ return r.json(); })
    .then(function(d){
      /* plainName, never the marked form: a browser tab and a heading on an
         unstyled page both want words, not accent runs. */
      var n = d && d.brand && d.brand.plain;
      if (!n) n = d && d.siteName;
      if (n) paint(n);
    })
    .catch(function(){});
})();
