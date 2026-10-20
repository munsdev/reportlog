// The white-page fallback (decision 23). If the app cannot start, say so in
// plain words instead of leaving an empty page.
//
// A separate file, not an inline script: the content security policy allows
// scripts from this site only. It asks nothing of anyone else and writes
// text with textContent, never markup.
(function () {
  var root = document.getElementById('root');
  if (!root) return;
  var shown = false;

  function show() {
    // Anything the app has drawn means it did start; leave it alone.
    if (shown || root.childElementCount > 0) return;
    shown = true;
    var box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.style.cssText =
      'max-width:36rem;margin:3rem auto;padding:0 1rem;font:1rem/1.5 system-ui,sans-serif';
    var h = document.createElement('h1');
    h.textContent = 'This page did not load';
    h.style.cssText = 'font-size:1.5rem;margin:0 0 .75rem';
    var p = document.createElement('p');
    p.textContent =
      'Something went wrong while the page was starting. Reload it to try again. ' +
      'If that does not help, try again in a few minutes; the site may be being updated.';
    var a = document.createElement('a');
    a.href = window.location.pathname;
    a.textContent = 'Reload this page';
    a.style.cssText = 'display:inline-block;min-height:44px;line-height:44px';
    box.appendChild(h);
    box.appendChild(p);
    box.appendChild(a);
    root.appendChild(box);
  }

  // A script or stylesheet that would not load (a file a new release no
  // longer has, say): error events from elements do not bubble, so listen
  // while they travel down.
  window.addEventListener(
    'error',
    function (e) {
      var t = e.target;
      if (t && t.tagName && (t.tagName === 'SCRIPT' || t.tagName === 'LINK')) show();
    },
    true,
  );
  // A start that never finishes, or a script that threw before drawing.
  window.setTimeout(show, 10000);
  window.addEventListener('unhandledrejection', function () {
    window.setTimeout(show, 3000);
  });
})();
