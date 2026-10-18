/*
 * The front page's buttons, and the arrange control that orders them.
 *
 * ONE LIST. A logbook is a button the way a list is — the front page used
 * to carry a generic "Submit a Report" leading to a page that asked which
 * logbook, while every list had its own button right there. src/homeButtons.js
 * argues the whole thing; this draws it.
 *
 * THE FIRST BUTTON IS THE ACCENT AND THERE IS NO COLOUR TO PICK. The order
 * is the emphasis, so an operator who wants a different button emphasised
 * moves it to the top. The accent comes down the wire already decided, by
 * the one function that decides it, so this file cannot produce a page with
 * two accents or none.
 *
 * NO INLINE STYLE OR SCRIPT, like everything else in public/: the CSP is
 * `script-src 'self'` and `style-src 'self'`.
 */
import { showPane } from './nav.js';
import { openFileForm } from './form-logbook.js';
import { showListForm } from './list-form.js';
import { currentUser } from './session.js';
// The one frontend answer to "is this person an admin", shared rather than
// re-written here: two copies of a role check is how the arrange control
// comes to be offered to somebody the server will refuse.
import { hasAdminAuthority } from './feedback.js';

function el(id) { return document.getElementById(id); }

function esc(s) {
  var d = document.createElement('div');
  d.textContent = String(s == null ? '' : s);
  return d.innerHTML;
}

/* The arrangement as the panel last saw it. Kept so the arrange control can
   reorder without refetching, and so a failed save can put the page back to
   what the server actually has. */
var BUTTONS = [];
var AVAILABLE = null;
var ARRANGED = false;
var ARRANGING = false;

/** One button. A logbook and a list are links; a built-in may not be. */
function buttonHtml(b, i) {
  var cls = 'button is-full' + (b.accent ? '' : ' is-secondary');
  var label = esc(b.label);
  if (b.kind === 'logbook') {
    return '<a class="' + cls + '" href="' + esc(b.href) + '" data-file-open="'
      + esc(b.ref) + '">' + label + '</a>';
  }
  if (b.kind === 'list') {
    return '<a class="' + cls + '" href="' + esc(b.href) + '" data-list-open="'
      + esc(b.ref) + '">' + label + '</a>';
  }
  // The alert sign-up opens a pane in place and has no address of its own.
  if (b.action === 'alerts') {
    return '<button type="button" class="' + cls + '" data-alerts-open="1">' + label + '</button>';
  }
  return '<a class="' + cls + '" href="' + esc(b.href) + '" data-home-nav="'
    + esc(b.nav || '') + '">' + label + '</a>';
}

function paint() {
  var box = el('home-buttons');
  if (!box) return;
  var fallback = el('home-buttons-fallback');
  // The fallback goes the moment there is something real to show, and stays
  // if the fetch never answers. A front page that has not loaded must not be
  // a front page with no way in.
  if (fallback) fallback.hidden = BUTTONS.length > 0;
  box.innerHTML = BUTTONS.map(buttonHtml).join('')
    + (ARRANGING ? arrangeHtml() : arrangeToggleHtml());
}

/* ---- the arrange control ------------------------------------------------
 *
 * IN EDIT MODE AND NOWHERE ELSE, beside the pencils that edit the page's
 * words (editPens in feedback.js). The same argument the copy editor
 * settled applies: the judgement being made is "does this front page read
 * right", and that judgement does not survive being made in a form on
 * another screen. So the order is set on the page it orders.
 *
 * IT MOVES BUTTONS, AND IT MAY OVERRIDE THE WORDING OF THE ONES THAT ARE
 * AN OPERATOR'S OWN. A logbook or list button still WEARS the record's own
 * title by default, and leaving the box empty is what keeps that true — so
 * renaming a logbook renames its button, as it always did. Typing in the
 * box is a deliberate override for the case the default cannot cover: a
 * call to action and an archive's title are different sentences.
 *
 * THE SITE'S OWN BUTTONS ARE STILL NOT RENAMEABLE, and that is the rule
 * feedback.js states rather than an omission: an operator who could rewrite
 * "Submit a report" could make the page lie about what the button does. The
 * server refuses a label on one; this offers no box for it.
 */
function canArrange() {
  return Boolean(currentUser && hasAdminAuthority(currentUser.role)
    && document.body.classList.contains('editing'));
}

function arrangeToggleHtml() {
  if (!canArrange()) return '';
  return '<button type="button" class="button is-secondary is-small margin-top margin-tiny"'
    + ' id="home-arrange-open">Arrange these buttons</button>';
}

function arrangeHtml() {
  if (!canArrange() || !AVAILABLE) return '';
  var rows = BUTTONS.map(function (b, i) {
    /* The box carries the override and NOT the resolved label, so an empty
       box means "use the title" and reads as what it is. The placeholder is
       the title it falls back to, which is how an operator can see what
       emptying it will do without saving to find out. */
    var own = (b.kind === 'logbook' || b.kind === 'list');
    var override = (b.title && b.label !== b.title) ? b.label : '';
    return '<li class="rc-card" data-arrange-row="' + i + '">'
      + '<span class="who"><b>' + esc(b.label) + '</b>'
      + (b.accent ? ' <span class="opt-req">the accent button</span>' : '')
      + '<br><span class="opt-req">' + esc(kindName(b)) + '</span>'
      + (own
        ? '<br><label class="opt-req" for="home-arrange-label-' + i + '">'
          + 'Button wording &mdash; leave empty to use the title</label>'
          + '<input class="form_input is-small" type="text" maxlength="80"'
          + ' id="home-arrange-label-' + i + '" data-arrange-label="' + i + '"'
          + ' value="' + esc(override) + '" placeholder="' + esc(b.title || b.label) + '">'
        : '')
      + '</span>'
      + '<span class="row grouped">'
      + '<button type="button" class="button is-secondary is-small" data-arrange-up="'
      + i + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="Move '
      + esc(b.label) + ' up">&uarr;</button>'
      + '<button type="button" class="button is-secondary is-small" data-arrange-down="'
      + i + '"' + (i === BUTTONS.length - 1 ? ' disabled' : '') + ' aria-label="Move '
      + esc(b.label) + ' down">&darr;</button>'
      + '<button type="button" class="button is-secondary is-small" data-arrange-off="'
      + i + '" aria-label="Take ' + esc(b.label) + ' off the front page">Remove</button>'
      + '</span></li>';
  }).join('');

  // Anything available and not on the page, so a removed button can come
  // back. A logbook that is open and absent is listed here rather than
  // silently gone.
  var off = offButtons().map(function (b) {
    return '<li class="rc-card"><span class="who"><b>' + esc(b.label) + '</b><br>'
      + '<span class="opt-req">' + esc(kindName(b)) + '</span></span>'
      + '<button type="button" class="button is-secondary is-small" data-arrange-add="'
      + esc(b.kind + ':' + b.ref) + '">Put it back</button></li>';
  }).join('');

  return '<div class="panel_component is-raised margin-top margin-xsmall" id="home-arrange">'
    + '<h3 class="heading-style-h5 margin-bottom margin-tiny">The order of these buttons</h3>'
    + '<p class="text-size-small text-color-muted margin-bottom margin-xsmall">'
    + 'The first one is the accent button. There is no colour to choose — one screen '
    + 'has one main action, so the order is what decides which. A button says what its '
    + 'logbook or list is called unless you give it other wording, and emptying the box '
    + 'puts the title back &mdash; so renaming a logbook renames its button. The '
    + 'site&rsquo;s own buttons keep their own wording.</p>'
    + '<ol class="margin-bottom margin-xsmall">' + rows + '</ol>'
    + (off ? '<p class="lab form_label-sep">Not on the front page</p><ul>' + off + '</ul>' : '')
    + '<p class="form_error" id="home-arrange-err"></p>'
    + '<div class="row grouped">'
    + '<button type="button" class="button" id="home-arrange-save">Save this order</button>'
    + '<button type="button" class="button is-secondary is-small" id="home-arrange-cancel">Cancel</button>'
    + (ARRANGED ? '<button type="button" class="button is-secondary is-small"'
      + ' id="home-arrange-reset">Back to the order it shipped with</button>' : '')
    + '</div></div>';
}

function kindName(b) {
  if (b.kind === 'logbook') return 'A logbook — reports are sealed and chained';
  if (b.kind === 'list') return 'A list — entries are not sealed';
  return 'Part of the site';
}

function offButtons() {
  if (!AVAILABLE) return [];
  var on = {};
  BUTTONS.forEach(function (b) { on[b.kind + ':' + b.ref] = true; });
  return []
    .concat(AVAILABLE.logbooks || [], AVAILABLE.lists || [], AVAILABLE.builtins || [])
    .filter(function (b) { return !on[b.kind + ':' + b.ref]; });
}

function orderNow() {
  return BUTTONS.map(function (b, i) {
    var out = { kind: b.kind, ref: b.ref };
    /* Read off the field at save time rather than kept in BUTTONS as it is
       typed: repainting the list on every keystroke would move the cursor,
       and a row's buttons repaint it on every move. */
    var box = document.querySelector('[data-arrange-label="' + i + '"]');
    var typed = box ? box.value.trim() : (b.title && b.label !== b.title ? b.label : '');
    if (typed) out.label = typed;
    return out;
  });
}

/* Everything in a label box, back into BUTTONS. The resolved label is what
   the row draws, so an override is folded in as the label with `title` left
   alone — the same shape the server answers with. */
function readLabels() {
  BUTTONS = BUTTONS.map(function (b, i) {
    var box = document.querySelector('[data-arrange-label="' + i + '"]');
    if (!box) return b;
    var typed = box.value.trim();
    return Object.assign({}, b, {
      label: typed || b.title || b.label,
      title: b.title || b.label,
    });
  });
}

/* The accent follows position, here as well as on the server, so moving a
   button shows its new emphasis immediately rather than after a save. */
function reaccent() {
  BUTTONS = BUTTONS.map(function (b, i) {
    return Object.assign({}, b, { accent: i === 0 });
  });
}

function move(from, to) {
  if (to < 0 || to >= BUTTONS.length) return;
  /* WHAT IS TYPED SURVIVES A MOVE. The rows are repainted from BUTTONS, so
     anything in a label box that is not back in BUTTONS first is lost the
     moment somebody presses an arrow — and losing it silently, in the one
     control whose whole job is arranging, is the kind of fault that reads
     as the page fighting you. */
  readLabels();
  var item = BUTTONS[from];
  BUTTONS.splice(from, 1);
  BUTTONS.splice(to, 0, item);
  reaccent();
  paint();
}

function save() {
  var err = el('home-arrange-err');
  if (err) err.textContent = '';
  fetch('/api/admin/home-buttons', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ order: orderNow() }),
  }).then(function (r) {
    return r.json().then(function (d) { return { ok: r.ok, d: d }; });
  }).then(function (res) {
    if (!res.ok) {
      if (err) err.textContent = res.d.error || 'That could not be saved.';
      return;
    }
    // Repainted from the SERVER's answer, not from what was sent. The
    // append rule means the saved arrangement and the drawn one are not
    // always the same list, and the operator should see the real one.
    BUTTONS = res.d.buttons || [];
    ARRANGED = true;
    ARRANGING = false;
    paint();
  }).catch(function () {
    if (err) err.textContent = 'That could not be saved.';
  });
}

function reset() {
  fetch('/api/admin/home-buttons', { method: 'DELETE', credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return;
      BUTTONS = d.buttons || [];
      ARRANGED = false;
      ARRANGING = false;
      paint();
    });
}

/* ---- loading ----------------------------------------------------------- */

function renderHomeButtons() {
  // An admin gets the richer answer, because the arrange control needs to
  // know what is NOT on the page. Everybody else gets the buttons.
  var admin = Boolean(currentUser && hasAdminAuthority(currentUser.role));
  var url = admin ? '/api/admin/home-buttons' : '/api/home/buttons';
  fetch(url, { credentials: 'same-origin' }).then(function (r) {
    /* LOCKED is not an error worth showing: the gate is in front of this
       page and the lock screen is already the thing being displayed. */
    if (!r.ok) return null;
    return r.json();
  }).then(function (d) {
    if (!d) return;
    BUTTONS = d.buttons || [];
    if (d.available) AVAILABLE = d.available;
    if (typeof d.arranged === 'boolean') ARRANGED = d.arranged;
    paint();
  }).catch(function () { /* the fallback buttons are still on the page */ });
}

/* Edit mode is a body class, and a control that only exists while editing
   has nothing on screen for that class to reveal — so it has to be drawn
   again when the mode changes. feedback.js fires this; without it the
   arrange control never appeared at all, and nothing said so. */
document.addEventListener('editmode', function (e) {
  // Leaving edit mode mid-arrangement throws the unsaved order away rather
  // than keeping it on a page that no longer shows what it is. The server
  // still has what it had.
  if (!e.detail || !e.detail.on) ARRANGING = false;
  if (ARRANGING || BUTTONS.length) paint();
});

document.addEventListener('click', function (e) {
  if (!e.target.closest) return;

  var file = e.target.closest('[data-file-open]');
  if (file) {
    e.preventDefault();
    openFileForm(file.getAttribute('data-file-open'));
    return;
  }

  var nav = e.target.closest('[data-home-nav]');
  if (nav) {
    e.preventDefault();
    showPane(nav.getAttribute('data-home-nav'));
    return;
  }

  if (e.target.closest('#home-arrange-open')) {
    ARRANGING = true;
    // The available list is only fetched for an admin, and an admin who
    // loaded the page before signing in has not got it yet.
    if (!AVAILABLE) renderHomeButtons();
    paint();
    return;
  }
  if (e.target.closest('#home-arrange-cancel')) {
    ARRANGING = false;
    // Back to what the server has, not to what the list was left at.
    renderHomeButtons();
    return;
  }
  if (e.target.closest('#home-arrange-save')) { save(); return; }
  if (e.target.closest('#home-arrange-reset')) { reset(); return; }

  var up = e.target.closest('[data-arrange-up]');
  if (up) { var i = Number(up.getAttribute('data-arrange-up')); move(i, i - 1); return; }
  var down = e.target.closest('[data-arrange-down]');
  if (down) { var j = Number(down.getAttribute('data-arrange-down')); move(j, j + 1); return; }
  var off = e.target.closest('[data-arrange-off]');
  if (off) {
    // Same reason as in move(): the list is about to be repainted.
    readLabels();
    BUTTONS.splice(Number(off.getAttribute('data-arrange-off')), 1);
    reaccent();
    paint();
    return;
  }
  var add = e.target.closest('[data-arrange-add]');
  if (add) {
    var key = add.getAttribute('data-arrange-add').split(':');
    var found = offButtons().find(function (b) {
      return b.kind === key[0] && b.ref === key.slice(1).join(':');
    });
    if (found) {
      readLabels();
      BUTTONS.push(Object.assign({}, found, { accent: false, title: found.label }));
      reaccent();
      paint();
    }
  }
});

export {
  renderHomeButtons,
};
