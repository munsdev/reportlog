/* global document, window */
/**
 * The documentation's search, entirely in the reader's browser.
 *
 * It fetches `/search-index.json` from this site the first time the box is
 * used and asks nothing of anybody else. Without it every page still works:
 * the box stays hidden until this script shows it.
 *
 * Ranking is deliberately simple and predictable: every word typed must
 * appear somewhere in the page; a match in the title counts most, then a
 * heading, then the text. A heading that matches is linked directly.
 */
(function () {
  'use strict';
  var box = document.querySelector('[data-search]');
  if (!box) return;
  var input = box.querySelector('input');
  var list = box.querySelector('.search-results');
  var index = null;
  var loading = null;
  var active = -1;
  box.hidden = false;

  function load() {
    if (index) return Promise.resolve(index);
    if (!loading) {
      loading = fetch('/search-index.json')
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          index = data;
          return data;
        });
    }
    return loading;
  }

  function words(q) {
    return q
      .toLowerCase()
      .split(/\s+/)
      .filter(function (w) {
        return w.length > 1;
      });
  }

  function search(q) {
    var ws = words(q);
    if (!ws.length) return [];
    var results = [];
    index.forEach(function (doc) {
      var title = doc.t.toLowerCase();
      var text = doc.x.toLowerCase();
      var score = 0;
      var heading = null;
      for (const w of ws) {
        var inTitle = title.indexOf(w) !== -1;
        var h =
          doc.h.find(function (pair) {
            return pair[1].toLowerCase().indexOf(w) !== -1;
          }) || null;
        var inText = text.indexOf(w) !== -1;
        if (!inTitle && !h && !inText) return;
        score += inTitle ? 10 : h ? 5 : 1;
        if (h && !heading) heading = h;
      }
      var at = text.indexOf(ws[0]);
      var start = Math.max(0, at - 60);
      var excerpt = (start > 0 ? '…' : '') + doc.x.slice(start, start + 160) + '…';
      results.push({ doc: doc, score: score, heading: heading, excerpt: excerpt });
    });
    results.sort(function (a, b) {
      return b.score - a.score;
    });
    return results.slice(0, 8);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function render(results, q) {
    list.textContent = '';
    active = -1;
    if (!q.trim()) {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    if (!results.length) {
      list.appendChild(el('p', 'search-empty', 'Nothing in the documentation matches that.'));
    }
    results.forEach(function (r, i) {
      var a = el('a', 'search-result');
      a.href = r.doc.u + (r.heading ? '#' + r.heading[0] : '');
      a.id = 'search-result-' + i;
      a.setAttribute('role', 'option');
      a.appendChild(el('span', 'search-section', r.doc.s));
      a.appendChild(el('span', 'search-title', r.doc.t + (r.heading ? ' › ' + r.heading[1] : '')));
      a.appendChild(el('span', 'search-excerpt', r.excerpt));
      list.appendChild(a);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function move(by) {
    var items = list.querySelectorAll('.search-result');
    if (!items.length) return;
    active = (active + by + items.length) % items.length;
    items.forEach(function (it, i) {
      it.classList.toggle('active', i === active);
    });
    input.setAttribute('aria-activedescendant', items[active].id);
  }

  input.addEventListener('input', function () {
    var q = input.value;
    load().then(function () {
      if (input.value === q) render(search(q), q);
    });
  });
  input.addEventListener('focus', function () {
    load();
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      var items = list.querySelectorAll('.search-result');
      var pick = items[active] || items[0];
      if (pick)
        window.location.href = new URL(pick.getAttribute('href'), window.location.href).href;
    } else if (e.key === 'Escape') {
      input.value = '';
      render([], '');
      input.blur();
    }
  });
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (e.key === '/' && !typing) {
      e.preventDefault();
      input.focus();
    }
  });
  document.addEventListener('click', function (e) {
    if (!box.contains(e.target)) render([], '');
  });
})();
