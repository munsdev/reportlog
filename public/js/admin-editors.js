/* admin-editors.js — ONE EDITOR OPEN AT A TIME, with one bar belonging to
 * it, and a notification for the things that save themselves.
 *
 * WHAT THIS REPLACES. A settings tab was several independently editable
 * cards, so there were several Save buttons, none of them said what it
 * saved, and the one you wanted had scrolled away. The first instinct was a
 * sticky Save bar, which is wrong: pin several of those to the bottom and
 * they stack, which moves the confusion rather than removing it. The
 * question is not where Save goes, it is HOW MANY THINGS CAN BE IN FLIGHT
 * AT ONCE, and the answer is one.
 *
 * THE SOFTWARE ALREADY CONTAINED THE ANSWER, applied unevenly. The logbook
 * builder, the map editor and the list editor all work this way already:
 * open one, edit it, save or cancel, come back to the list. The settings
 * tabs were the inconsistent screens, not the model. So this is a pattern
 * being finished rather than a mechanism being invented.
 *
 * WHAT IT BUYS, beyond tidiness:
 *   - Save stops being ambiguous: one editor open means the bar can NAME
 *     what it is about to save.
 *   - Dirty tracking is one question instead of N, which is the only thing
 *     that makes a warning on navigation possible at all.
 *   - Cancel is a restore of one snapshot. With one editor there is nothing
 *     to reconcile.
 *
 * A SWITCH IS NOT A FORM, AND MUST NOT BECOME AN EDITOR. A panel that is
 * one control — turn the development notice on, publish this map — keeps
 * applying immediately. If every switch needed open/edit/save/close, an
 * operator making three quick changes would go from three clicks to twelve
 * and blame the pattern for being slow when the mistake was applying it
 * where it does not belong. The rule, and the whole of the test:
 *
 *     A PANEL WITH ITS OWN SAVE BUTTON IS A FORM, AND BECOMES AN EDITOR.
 *     A PANEL WITHOUT ONE IS A CONTROL, AND STAYS A CONTROL.
 *
 * It is read off the markup rather than listed here on purpose: a list of
 * panel ids in this file would be a second place to keep true, and a panel
 * added later would get whichever behaviour nobody remembered to choose.
 * `data-editor="off"` opts a panel out where the test is wrong.
 *
 * A PANEL THAT RENDERS ITS OWN BODY MUST OPT OUT, and this is the one thing
 * to know before marking up a new one. The wrapper below goes around the
 * nodes that are in the shipped markup; a renderer that replaces the
 * panel's innerHTML afterwards throws that wrapper away. Worse, if the Save
 * button arrives with the body, whether the panel became an editor at all
 * would depend on whether a fetch had answered — a race, and the behaviour
 * would differ between a fast box and a slow one. The transparency log, the
 * map editor, the logbook builder and the list editor are all of this kind
 * and all say so in the markup.
 *
 * AND THE OTHER HALF OF THAT RULE: part of what was confusing is that some
 * things saved when you touched them and some needed a button, and nothing
 * on the screen said which. So a control that applies immediately now says
 * so — `toast()` below, called from the handlers that write straight away.
 *
 * THE COLLAPSED STATE HAS TO BE WORTH READING. This is the half most
 * likely to be skimped, and skimping it makes the whole thing a net loss:
 * if a closed panel shows only its name, an operator has to open all of
 * them to find anything. A closed panel shows its CURRENT VALUES; opening
 * turns those values into fields.
 *
 * IT MUST NOT BECOME LAZY LOADING. Every pane is in the DOM from the first
 * byte — that is the gate's requirement and not a performance choice, since
 * the lock screen is all that stands between a visitor and the site's
 * writing. Collapsing is `hidden` on a wrapper around nodes that are
 * already there. Nothing here fetches markup and nothing here builds a
 * panel on demand.
 */

import { esc } from './answers.js';

/* ---------- notifications for what saves itself ----------------------
 *
 * ONE REGION, REUSED, and it is polite rather than assertive: this is the
 * confirmation of something the operator just did, not an error that is
 * worth interrupting them for. The errors on this page are role=alert and
 * stay that way.
 */
var TOAST_MS = 4000;
var toastTimer = null;

function toastBox() {
  var box = document.getElementById('admin-toast');
  if (box) return box;
  box = document.createElement('div');
  box.id = 'admin-toast';
  box.className = 'adm-toast';
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  document.body.appendChild(box);
  return box;
}

/**
 * Say that something has been applied.
 *
 * FOR THE THINGS THAT WRITE WITHOUT A SAVE BUTTON. Called from the handler
 * AFTER the server has answered, never from the click — a notification that
 * appears whether or not the write landed is worse than none, because it
 * teaches an operator to believe it.
 */
function toast(message) {
  var box = toastBox();
  box.textContent = '';
  var el = document.createElement('div');
  el.className = 'adm-toast-msg';
  el.textContent = message;
  box.appendChild(el);
  box.classList.add('on');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    box.classList.remove('on');
    box.textContent = '';
  }, TOAST_MS);
}

/* ---------- the one open editor --------------------------------------
 *
 * ACROSS THE WHOLE SCREEN, not one per tab. A dirty map editor and a dirty
 * site-settings editor at the same time is exactly the state this removes,
 * and a per-tab rule would leave it reachable by changing tab.
 */
var OPEN = null;       // the panel element, or null
var SNAPSHOT = null;   // what its fields held when it opened
var OPENER = null;     // the control that opened it, for focus on the way back

function fieldsOf(panel) {
  var out = [];
  panel.querySelectorAll('input, select, textarea').forEach(function (f) {
    if (f.type === 'hidden' || f.type === 'file') return;
    if (f.disabled) return;
    /* A panel can contain a nested editor of the older kind — the logbook
       editor, the list editor — which is marked data-closed and owns its
       own open/save/cancel. Not ours to collapse or to snapshot. */
    if (f.closest('[data-closed]') && f.closest('[data-closed]') !== panel) return;
    if (f.closest('[data-editor-bar]')) return;
    out.push(f);
  });
  return out;
}

function valueOf(f) {
  if (f.type === 'checkbox' || f.type === 'radio') return f.checked ? '1' : '0';
  return f.value;
}

function snapshot(panel) {
  return fieldsOf(panel).map(valueOf).join('\u0000');
}

/** Is the open editor changed from what it held when it opened? */
function isDirty() {
  if (!OPEN) return false;
  return snapshot(OPEN) !== SNAPSHOT;
}

function openEditorName() {
  if (!OPEN) return null;
  return OPEN.getAttribute('data-editor-name') || 'this panel';
}

/* ---------- the bar -------------------------------------------------- */

function bar() {
  var el = document.getElementById('editor-bar');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'editor-bar';
  el.className = 'ed-bar';
  el.setAttribute('data-editor-bar', '1');
  el.hidden = true;
  el.innerHTML = '<div class="ed-bar-in">'
    + '<span class="ed-bar-what" id="editor-bar-what"></span>'
    + '<span class="ed-bar-acts">'
    /* CANCEL IS ALWAYS THERE. A one-at-a-time pattern on a phone is close
       enough to a modal that it can strand somebody, so there is always a
       way out that is not Save. */
    + '<button type="button" class="button is-secondary is-small" id="editor-bar-cancel">Cancel</button>'
    + '<button type="button" class="button" id="editor-bar-save">Save</button>'
    + '</span></div>';
  document.body.appendChild(el);
  el.querySelector('#editor-bar-cancel').addEventListener('click', function () {
    closeEditor({ discard: true });
  });
  el.querySelector('#editor-bar-save').addEventListener('click', saveOpen);
  return el;
}

/* THE BAR'S REAL HEIGHT, MEASURED, not a number in the stylesheet.
 *
 * It was written down twice — 72px, and 104px for a phone on the theory
 * that the bar wraps to two rows there. It does not: the name and the two
 * buttons fit on one row, so everything spaced off the bar sat about fifty
 * pixels too high and the notification floated in the middle of nowhere
 * instead of just above it.
 *
 * A guessed height is wrong the first time the wording is longer, the
 * buttons are bigger, or somebody's text size is turned up. So the bar is
 * measured and publishes what it actually is.
 */
function publishBarHeight() {
  var el = document.getElementById('editor-bar');
  if (!el || el.hidden) return;
  var h = el.offsetHeight;
  if (h > 0) document.documentElement.style.setProperty('--ed-bar-h', h + 'px');
}

if (window.ResizeObserver) {
  /* Re-measured when it changes rather than only when it opens: the name in
     it is the panel's, so the bar is a different height for a long one, and
     rotating the phone can rewrap it. */
  new ResizeObserver(publishBarHeight).observe(bar());
}

function paintBar() {
  var el = bar();
  if (!OPEN) { el.hidden = true; document.body.classList.remove('has-editor'); return; }
  /* IT NAMES WHAT IT WILL SAVE. That is the whole reason there is one bar
     rather than several: "Save" on its own was the ambiguity. */
  el.querySelector('#editor-bar-what').textContent = openEditorName()
    + (isDirty() ? ' — unsaved changes' : '');
  el.hidden = false;
  document.body.classList.add('has-editor');
  /* After it is shown, or a hidden element measures zero. */
  publishBarHeight();
}

/* ---------- the summary a closed panel shows ------------------------- */

function labelFor(f) {
  if (f.id) {
    var lab = f.ownerDocument.querySelector('label[for="' + f.id + '"]');
    if (lab) return (lab.textContent || '').trim();
  }
  var wrap = f.closest('.form_field-wrapper, .f');
  var inner = wrap && wrap.querySelector('.form_label, .lab');
  if (inner) return (inner.textContent || '').trim();
  return f.getAttribute('aria-label') || f.getAttribute('placeholder') || '';
}

function shown(f) {
  /* A PASSWORD IS NEVER SUMMARISED. The site password's field is blank for
     "keep the current one", and printing anything at all about it here
     would be either a lie or a leak. */
  if (f.type === 'password') return null;
  if (f.type === 'checkbox') return f.checked ? 'on' : 'off';
  /* A radio is one option of a set and tells you nothing on its own; the
     set's answer would need the group's label, which not every group here
     has. Left out rather than summarised wrongly. */
  if (f.type === 'radio') return null;
  if (f.tagName === 'SELECT') {
    var o = f.options[f.selectedIndex];
    return o ? (o.textContent || '').trim() : '';
  }
  var v = (f.value || '').trim();
  if (!v) return 'not set';
  return v.length > 90 ? v.slice(0, 90) + '…' : v;
}

function paintSummary(panel) {
  var box = panel.querySelector('[data-editor-summary]');
  if (!box) return;
  var rows = [];
  fieldsOf(panel).forEach(function (f) {
    var val = shown(f);
    if (val === null) return;
    var lab = labelFor(f);
    if (!lab) return;
    rows.push('<div class="ed-sum-row"><span class="ed-sum-lab">' + esc(lab)
      + '</span><span class="ed-sum-val">' + esc(val) + '</span></div>');
  });
  box.innerHTML = rows.length
    ? rows.join('')
    : '<div class="ed-sum-row"><span class="ed-sum-val">Open it to see what is set.</span></div>';
}

/* ---------- open and close ------------------------------------------- */

/**
 * Open one editor, closing whatever was open.
 *
 * FOCUS MOVES IN, and closing puts it back on the control that opened it.
 * On a phone that is the difference between a pattern that reads as a
 * drawer and one that reads as being thrown somewhere.
 */
function openEditor(panel) {
  if (!panel) return;
  if (OPEN === panel) return;
  /* Changing editors is leaving one, so it asks the same question as
     changing tab does. */
  if (OPEN && !confirmDiscard()) return;
  if (OPEN) closeEditor({ discard: true, keepFocus: true });

  OPEN = panel;
  SNAPSHOT = snapshot(panel);
  OPENER = panel.querySelector('[data-editor-open]');
  panel.classList.add('ed-open');
  var body = panel.querySelector('[data-editor-body]');
  if (body) body.hidden = false;
  var sum = panel.querySelector('[data-editor-summary]');
  if (sum) sum.hidden = true;
  if (OPENER) OPENER.hidden = true;
  paintBar();

  var first = fieldsOf(panel)[0];
  if (first) {
    try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); }
    panel.scrollIntoView({ block: 'nearest' });
  }
}

/**
 * Close the open editor.
 *
 * `discard` puts the snapshot back, which is what Cancel means. It is a
 * restore rather than a re-read from the server because with one editor
 * open there is exactly one snapshot and nothing to reconcile — and
 * because a re-read would also throw away an error the panel is showing.
 */
function closeEditor(opts) {
  opts = opts || {};
  var panel = OPEN;
  if (!panel) return;
  if (opts.discard) {
    var vals = SNAPSHOT.split('\u0000');
    fieldsOf(panel).forEach(function (f, i) {
      if (i >= vals.length) return;
      if (f.type === 'checkbox' || f.type === 'radio') f.checked = vals[i] === '1';
      else f.value = vals[i];
    });
  }
  var body = panel.querySelector('[data-editor-body]');
  if (body) body.hidden = true;
  var sum = panel.querySelector('[data-editor-summary]');
  if (sum) sum.hidden = false;
  panel.classList.remove('ed-open');
  var opener = panel.querySelector('[data-editor-open]');
  if (opener) opener.hidden = false;
  paintSummary(panel);
  OPEN = null; SNAPSHOT = null;
  paintBar();
  if (opener && !opts.keepFocus) {
    try { opener.focus({ preventScroll: true }); } catch (e) { opener.focus(); }
  }
  OPENER = null;
}

/**
 * Save through the panel's OWN save button.
 *
 * NOTHING ABOUT WHAT A PANEL SAVES LIVES HERE. Every one of these panels
 * already had a working save — its own validation, its own endpoint, its
 * own error box — and a second copy of any of that in this file would be a
 * second thing to be wrong. The bar presses the button the panel already
 * has.
 *
 * WHICH IS WHY IT DOES NOT CLOSE IMMEDIATELY. The panel's handler is a
 * fetch; its outcome arrives later, in its own error box. So the editor
 * stays open, and closes a moment later only if nothing showed an error —
 * an operator whose save was refused must not have the panel shut on them
 * with the reason inside it.
 */
function saveOpen() {
  var panel = OPEN;
  if (!panel) return;
  var btn = panel.querySelector('[data-editor-save]');
  if (!btn) { closeEditor({}); return; }
  var name = openEditorName();
  btn.click();
  setTimeout(function () {
    if (OPEN !== panel) return;
    var err = panel.querySelector('.form_error.on');
    if (err && (err.textContent || '').trim()) {
      paintBar();
      return;
    }
    /* The fields now hold what was sent, so this is no longer a change
       waiting to be saved. */
    SNAPSHOT = snapshot(panel);
    closeEditor({});
    toast(name + ' saved.');
  }, 700);
}

/* ---------- leaving with changes in flight ---------------------------
 *
 * A WARNING, AND THEN IT GOES. A pop-up should warn that
 * the changes will be discarded, and then the navigation happens. Staying
 * is still possible — that is what Cancel on the dialog means — because the
 * repository's own rule is that nothing on the card in front of somebody
 * changes underneath them, and silently dropping what they typed is the
 * worst version of that.
 */
function confirmDiscard() {
  if (!isDirty()) {
    if (OPEN) closeEditor({ discard: true, keepFocus: true });
    return true;
  }
  var ok = window.confirm('Your unsaved changes to ' + openEditorName()
    + ' will be discarded.\n\nLeave without saving?');
  if (!ok) return false;
  closeEditor({ discard: true, keepFocus: true });
  return true;
}

/**
 * The same question for anything that leaves the screen.
 *
 * Exported so the tab strip and the history handler ask it rather than
 * each having their own idea of what dirty means.
 */
function mayLeave() {
  return confirmDiscard();
}

/* The browser's own version, for closing the tab and for a real
   navigation — which is not ours to intercept with a dialog of our own. */
window.addEventListener('beforeunload', function (e) {
  if (!isDirty()) return;
  e.preventDefault();
  e.returnValue = '';
});

/* ---------- making the panels editors --------------------------------
 *
 * READ OFF THE MARKUP. Every panel in the pane that has its own save
 * button becomes an editor; everything else is left exactly as it was.
 * Run once per pane, and idempotent, because the admin pane is rendered
 * again every time it is opened.
 */
function panelName(panel) {
  var h = panel.querySelector('h2, h3, .lab, .panel_title');
  var t = h ? (h.textContent || '').trim() : '';
  return t || 'this panel';
}

function makeEditor(panel) {
  if (panel.getAttribute('data-editor') === 'off') return;
  if (panel.getAttribute('data-editor-ready')) return;
  if (panel.hasAttribute('data-closed')) return;

  /* THE TEST, and the only one: does this panel have a save of its own. */
  var save = panel.querySelector('[data-editor-save]');
  if (!save) {
    var saves = panel.querySelectorAll('button[id$="-save"]');
    /* A PANEL WITH TWO SAVES IS TWO FORMS SHARING A CARD, and one bar
       cannot speak for both — the Legal panel holds the imprint and the
       privacy policy, each with its own box and its own button. Making it
       an editor would give it a bar that saved one of them and named
       neither. Left alone until it is two panels, which is the fix; this
       is read off the markup rather than listed by id so the next one is
       caught the same way. */
    if (saves.length !== 1) return;
    save = saves[0];
  }
  if (!save) return;
  save.setAttribute('data-editor-save', '1');

  var name = panelName(panel);
  panel.setAttribute('data-editor-name', name);

  /* The heading stays where it is and everything under it moves into a
     wrapper that can be hidden. MOVED, not re-rendered: these nodes have
     listeners on them from half a dozen modules, and rebuilding them from
     innerHTML would drop every one. */
  var head = panel.querySelector('h2, h3');
  /* A COLLAPSED PANEL HAS TO SAY WHAT IT IS. Most of these open with a
     heading; the few that open with a styled line get one made for them,
     because collapsing a panel whose name went into the hidden half would
     leave a row of anonymous Edit buttons. */
  if (!head) {
    head = document.createElement('p');
    head.className = 'lab';
    head.textContent = name;
    panel.insertBefore(head, panel.firstChild);
  }
  var body = document.createElement('div');
  body.setAttribute('data-editor-body', '1');
  body.hidden = true;
  var node = head ? head.nextSibling : panel.firstChild;
  while (node) {
    var next = node.nextSibling;
    body.appendChild(node);
    node = next;
  }
  panel.appendChild(body);

  var sum = document.createElement('div');
  sum.className = 'ed-sum';
  sum.setAttribute('data-editor-summary', '1');
  panel.appendChild(sum);

  var open = document.createElement('button');
  open.type = 'button';
  open.className = 'button is-secondary is-small margin-top margin-tiny';
  open.setAttribute('data-editor-open', '1');
  open.textContent = 'Edit';
  open.addEventListener('click', function () { openEditor(panel); });
  panel.appendChild(open);

  panel.setAttribute('data-editor-ready', '1');
  paintSummary(panel);
}

/**
 * Collapse every form panel in a pane, and refresh the summaries.
 *
 * Called whenever the pane is rendered. The summaries are repainted every
 * time because the panels fetch their own values asynchronously — a summary
 * built the instant the pane opened would show the markup's defaults.
 */
function initEditors(paneId) {
  var pane = document.getElementById(paneId);
  if (!pane) return;
  pane.querySelectorAll('.panel_component[data-sec]').forEach(makeEditor);
  /* After the panels' own fetches have answered. Not a load-bearing delay:
     every field is also summarised again whenever an editor closes. */
  setTimeout(function () {
    pane.querySelectorAll('[data-editor-ready]').forEach(function (p) {
      if (p !== OPEN) paintSummary(p);
    });
  }, 900);
}

/* ---- the on-screen keyboard -----------------------------------------
 *
 * A BAR FIXED TO THE BOTTOM IS FIXED TO THE BOTTOM OF THE LAYOUT VIEWPORT,
 * and the keyboard does not move that. So on a phone, the moment somebody
 * touched the field the bar belongs to, the bar and the notification went
 * behind the keyboard — exactly when they are needed, and they could not be
 * scrolled back because they are not in the scroll.
 *
 * TWO MECHANISMS, because one is not enough yet. `interactive-widget=
 * resizes-content` in the viewport meta is the real fix and Chrome honours
 * it; iOS Safari does not, and there the visual viewport shrinks while the
 * layout viewport does not. This measures the difference and publishes it
 * as `--kb-inset`, which the bar, the notification and the corner buttons
 * all sit on top of.
 *
 * IT COSTS NOTHING WHERE THE META WORKS: the two viewports agree there, so
 * the inset measures zero and nothing moves twice.
 */
function trackKeyboard() {
  var vv = window.visualViewport;
  if (!vv) return;
  var paint = function () {
    /* What the keyboard covers: the part of the layout viewport that is
       below the visible one. Never negative — a rubber-band scroll on iOS
       can make the arithmetic go the other way for a frame. */
    var hidden = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
    /* Under a few pixels is measurement noise, not a keyboard, and writing
       a property on every scroll frame is work for nothing. */
    document.documentElement.style.setProperty('--kb-inset', (hidden > 8 ? hidden : 0) + 'px');
  };
  vv.addEventListener('resize', paint);
  vv.addEventListener('scroll', paint);
  paint();
}
trackKeyboard();

/* AND THE FIELD HAS TO BE ABOVE THE BAR, not merely not under the keyboard.
   Focusing a field near the bottom scrolls it into view by the browser's
   reckoning, which does not know the bar is there — so the field lands
   under it. `scroll-margin-bottom` in the stylesheet tells the browser how
   much room to leave; this is the part that cannot be done in CSS, because
   the keyboard's height is only known at the moment it opens. */
document.addEventListener('focusin', function (e) {
  if (!OPEN || !e.target || !OPEN.contains(e.target)) return;
  /* After the keyboard has actually opened, or the measurement is of the
     screen as it was a moment ago. */
  setTimeout(function () {
    if (!OPEN || !OPEN.contains(document.activeElement)) return;
    var bar = document.getElementById('editor-bar');
    if (!bar || bar.hidden) return;
    var box = document.activeElement.getBoundingClientRect();
    var top = bar.getBoundingClientRect().top;
    if (box.bottom > top) window.scrollBy({ top: box.bottom - top + 12, behavior: 'smooth' });
  }, 300);
});

/* Typing in the open editor changes what the bar says, so the bar is
   repainted on input rather than only when something opens. Delegated once
   on the document: a listener per field would have to be re-attached every
   time a panel re-rendered itself. */
['input', 'change'].forEach(function (ev) {
  document.addEventListener(ev, function (e) {
    if (!OPEN || !e.target || !e.target.closest) return;
    if (!OPEN.contains(e.target)) return;
    paintBar();
  }, true);
});

/* Escape is Cancel, with the same warning. A pattern this close to a modal
   should answer the key people press to get out of one. */
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape' || !OPEN) return;
  if (confirmDiscard()) e.preventDefault();
});

/* The trailing export block, which is the convention every module here
   follows and which scripts/selftest.js reads to check that an import names
   something real. */
export {
  closeEditor, confirmDiscard, initEditors, isDirty, mayLeave, openEditor,
  openEditorName, toast,
};
