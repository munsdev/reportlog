/* boot-guard.js — a module that imports NOTHING, so it is a module graph of
 * its own and still runs when the app's graph cannot link.
 *
 * WHY IT EXISTS. On 10 October an owner's browser showed a white page after
 * an update, and a private window loaded fine. The browser was holding an
 * older copy of one module next to newer copies of the others: nginx sends
 * no caching instruction for /js/, so a browser decides for itself how long
 * a file is fresh. One module importing a name another no longer exports
 * stops the whole module graph — and the page hides itself until the app
 * says it has booted (`html.booting`, see gate.js), so a graph that never
 * runs is a page that never appears.
 *
 * SO, IF THE PAGE HAS FINISHED LOADING AND THE MODULES NEVER RAN: fetch every script and
 * stylesheet again straight from the server, which replaces whatever the
 * browser was holding, and reload — ONCE. If that did not fix it, stop
 * hiding the page and say so, with a button, rather than leave it white.
 *
 * No imports — the whole point — no globals of its own, nothing that touches
 * a report. It reads only its own markup.
 */
(function () {
  var KEY = 'reportlog-boot-repair';
  var html = document.documentElement;

  // gate.js sets this the moment the module graph has linked and begun to
  // run. Absent once the page has FINISHED loading — the load event waits
  // for module scripts — means the graph failed, not that it is slow.
  function modulesRan() { return html.hasAttribute('data-modules'); }

  function urls() {
    var out = [];
    var s = document.querySelectorAll('script[src], link[rel="stylesheet"][href]');
    for (var i = 0; i < s.length; i += 1) {
      var u = s[i].getAttribute('src') || s[i].getAttribute('href');
      if (u && u.charAt(0) === '/' && u.charAt(1) !== '/') out.push(u);
    }
    return out;
  }

  function giveUp() {
    html.classList.remove('booting');
    if (document.getElementById('bootfail')) return;
    var box = document.createElement('div');
    box.id = 'bootfail';
    box.className = 'bootfail';
    var p = document.createElement('p');
    p.textContent = 'This page did not load properly. Reloading usually fixes it; if it does not, '
      + 'clear this site’s data in your browser settings.';
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'button';
    b.textContent = 'Reload';
    b.addEventListener('click', function () { location.reload(); });
    box.appendChild(p);
    box.appendChild(b);
    document.body.insertBefore(box, document.body.firstChild);
  }

  function repair() {
    var tried = false;
    try { tried = sessionStorage.getItem(KEY) === '1'; } catch (e) { tried = false; }
    if (tried || typeof fetch !== 'function') { giveUp(); return; }
    try { sessionStorage.setItem(KEY, '1'); } catch (e) { giveUp(); return; }
    // cache: 'reload' goes to the server and REPLACES what the browser held,
    // which is the whole repair. A service worker passes these through too.
    var jobs = urls().map(function (u) {
      return fetch(u, { cache: 'reload', credentials: 'same-origin' }).catch(function () {});
    });
    Promise.all(jobs).then(function () { location.reload(); }, function () { location.reload(); });
  }

  // A slow connection is not a failure: wait until the page says it has
  // finished loading, then look. Checked again every two seconds, for up to
  // a minute, so a phone on a bad signal is never reloaded mid-download.
  var waited = 0;
  function check() {
    if (modulesRan()) {
      // It ran: clear the flag, so a later failure gets its own repair.
      try { sessionStorage.removeItem(KEY); } catch (e) { /* private mode */ }
      return;
    }
    if (document.readyState === 'complete') { repair(); return; }
    waited += 2000;
    if (waited < 60000) setTimeout(check, 2000); else giveUp();
  }
  setTimeout(check, 4000);
})();
