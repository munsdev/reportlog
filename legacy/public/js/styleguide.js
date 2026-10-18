/* styleguide.js — The style guide's own code: it reads the stylesheets the
 * site ships and draws what it finds, so the guide cannot drift from the
 * real thing.
 *
 * A file rather than inline script so that no page in public/ carries any,
 * which is what lets a deployment set a Content-Security-Policy without
 * 'unsafe-inline' — nginx serves this page off disk and cannot supply a
 * nonce. Moved unchanged. See docs/frontend-files.md.
 */
/* The page has no data of its own. The palettes, the themes, the colours and
   the spacing steps below are all READ OUT OF THE STYLESHEETS at load, so
   this guide cannot drift from what the site actually ships: a palette added
   to tokens.css appears here with nobody editing this file. */
(function () {
  'use strict';
  var root = document.documentElement;

  /* ---- what the stylesheets offer ----------------------------------- */
  // Same-origin stylesheets, so their rules can be read. A palette or theme
  // is any selector of the form [data-palette="x"] / [data-theme="x"].
  function idsFor(attr) {
    var found = [];
    var sheets = Array.prototype.slice.call(document.styleSheets);
    for (var i = 0; i < sheets.length; i += 1) {
      var rules;
      try { rules = sheets[i].cssRules; } catch (e) { rules = null; }
      if (!rules) continue;
      for (var j = 0; j < rules.length; j += 1) {
        var sel = rules[j].selectorText || '';
        var re = new RegExp('\\[data-' + attr + '="([a-z0-9-]+)"\\]', 'g');
        var m;
        while ((m = re.exec(sel)) !== null) {
          if (found.indexOf(m[1]) === -1) found.push(m[1]);
        }
      }
    }
    return found;
  }

  function titled(id) { return id.charAt(0).toUpperCase() + id.slice(1); }

  function fill(select, ids, current) {
    select.textContent = '';
    ids.forEach(function (id) {
      var o = document.createElement('option');
      o.value = id;
      o.textContent = titled(id);
      if (id === current) o.selected = true;
      select.appendChild(o);
    });
  }

  var palettes = idsFor('palette').sort();
  var themes = idsFor('theme').sort();
  var pSel = document.getElementById('sg-palette');
  var tSel = document.getElementById('sg-theme');
  fill(pSel, palettes, root.getAttribute('data-palette'));
  fill(tSel, themes, root.getAttribute('data-theme'));

  function apply(attr, value) {
    root.setAttribute('data-' + attr, value);
    paintSwatches();
    try { localStorage.setItem('sg-' + attr, value); } catch (e) { /* private window */ }
  }
  pSel.addEventListener('change', function () { apply('palette', pSel.value); });
  tSel.addEventListener('change', function () { apply('theme', tSel.value); });

  // Come back to the combination you were looking at.
  try {
    var savedP = localStorage.getItem('sg-palette');
    var savedT = localStorage.getItem('sg-theme');
    if (savedP && palettes.indexOf(savedP) !== -1) { root.setAttribute('data-palette', savedP); pSel.value = savedP; }
    if (savedT && themes.indexOf(savedT) !== -1) { root.setAttribute('data-theme', savedT); tSel.value = savedT; }
  } catch (e) { /* private window; the shipped look is fine */ }

  /* ---- the colours -------------------------------------------------- */
  // Named for the job each one does, which is the only way a name survives
  // a palette change.
  var PAGE_COLOURS = [
    ['--paper', 'The page behind everything'],
    ['--card', 'A card or a panel'],
    ['--ink', 'The words'],
    ['--ink-2', 'A line explaining the words'],
    ['--muted', 'A timestamp, a count'],
    ['--rule', 'A border'],
    ['--rule-soft', 'A hairline'],
    ['--field', 'A form control’s border'],
    ['--act', 'The action you came to take'],
    ['--act-fg', 'The text on it'],
    ['--nav', 'Furniture: the bar, the lock screen'],
    ['--solid', 'A solid block, inverted from the page']
  ];
  var STATUS_COLOURS = [
    ['--seal', 'Serious, and errors'],
    ['--on-seal', 'The text on it'],
    ['--verify', 'A moderator confirmed this'],
    ['--on-verify', 'The text on it']
  ];

  function swatchList(target, entries) {
    entries.forEach(function (pair) {
      var wrap = document.createElement('div');
      wrap.className='sg-swatch';
      var chip = document.createElement('div');
      chip.className='sg-swatch__chip';
      chip.setAttribute('data-token', pair[0]);
      var name = document.createElement('span');
      name.className='sg-swatch__name';
      name.textContent = pair[0];
      var what = document.createElement('span');
      what.className='sg-swatch__value';
      what.textContent = pair[1];
      var value = document.createElement('span');
      value.className='sg-swatch__value';
      value.setAttribute('data-value-of', pair[0]);
      wrap.appendChild(chip);
      wrap.appendChild(name);
      wrap.appendChild(what);
      wrap.appendChild(value);
      target.appendChild(wrap);
    });
  }
  swatchList(document.getElementById('sg-colour-page'), PAGE_COLOURS);
  swatchList(document.getElementById('sg-colour-status'), STATUS_COLOURS);

  function paintSwatches() {
    var cs = getComputedStyle(root);
    var chips = document.querySelectorAll('[data-token]');
    for (var i = 0; i < chips.length; i += 1) {
      var token = chips[i].getAttribute('data-token');
      var v = (cs.getPropertyValue(token) || '').trim();
      chips[i].style.background = v;
      var out = document.querySelector('[data-value-of="' + token + '"]');
      if (out) out.textContent = v;
    }
  }
  paintSwatches();

  /* ---- the spacing scale -------------------------------------------- */
  var STEPS = ['tiny', 'xxsmall', 'xsmall', 'small', 'medium', 'large',
    'xlarge', 'xxlarge', 'huge', 'xhuge', 'xxhuge'];
  var space = document.getElementById('sg-space');
  var cs = getComputedStyle(root);
  STEPS.forEach(function (step) {
    var value = (cs.getPropertyValue('--space--' + step) || '').trim();
    var row = document.createElement('div');
    row.className='layout_row is-nowrap';
    var label = document.createElement('span');
    label.className='text-size-tiny text-style-mono';
    label.style.width = '7rem';
    label.style.flex = 'none';
    label.textContent = step;
    var bar = document.createElement('div');
    bar.className='sg-ruler';
    bar.style.width = value;
    bar.style.maxWidth = '100%';
    var out = document.createElement('span');
    out.className='text-size-tiny text-color-muted';
    out.textContent = value;
    row.appendChild(label);
    row.appendChild(bar);
    row.appendChild(out);
    space.appendChild(row);
  });

  /* ---- the choice tiles, so the selected state is real -------------- */
  var list = document.getElementById('sg-choices');
  list.addEventListener('change', function () {
    var items = list.querySelectorAll('.choice_item');
    for (var i = 0; i < items.length; i += 1) {
      var input = items[i].querySelector('input');
      items[i].classList.toggle('is-selected', Boolean(input && input.checked));
    }
  });
}());
