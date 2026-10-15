/* admin-maps.js — Making and changing heat maps.
 *
 * A map's rules live on the server and this page decides nothing that
 * matters. Every refusal that counts comes back from the route in words and
 * is shown as it came: a threshold under the floor, an outcome view with no
 * question behind it, a slot the interface does not have, a logbook that
 * does not exist. The server is the one that decides, and src/mapData.js
 * re-applies every publication rule from scratch on each read — so the
 * worst a wrong setting here can do is publish less than was meant.
 *
 * TWO PANELS, BECAUSE THERE ARE TWO KINDS OF DECISION. A map's own settings
 * are a map's. Which QUESTION places a report is the logbook's, and is
 * shared by every map that reads that logbook — so it is set once, in its
 * own panel. Putting it inside a map's form would read as though the mark
 * belonged to that map, and the next map would appear to need its own.
 *
 * NO INLINE STYLE OR SCRIPT, like everything else in public/.
 */

import { esc } from './answers.js';
import { toast } from './admin-editors.js';

var HM = { maps: [], candidates: [], slots: [], planes: [], views: [], floor: 2 };
var hmOpen = null;   // the map being edited, as the server last described it
var hmDraft = null;  // what is on screen, not yet saved

function el(id) { return document.getElementById(id); }

function say(id, msg) {
  var e = el(id);
  if (!e) return;
  e.textContent = msg || '';
}

var PLANE_NAMES = {
  us: 'The United States, by state',
  world: 'The world, by country',
};

var VIEW_NAMES = {
  volume: 'How many reports',
  outcome: 'The answer to a question',
  severity: 'How serious a moderator judged them',
};

var VIEW_HELP = {
  volume: 'Every map can show this.',
  outcome: 'Needs a question below, with its answers marked positive or negative.',
  severity: 'A moderator’s judgement rather than a reporter’s answer, which is '
    + 'why it is its own view and never mixed into the one above.',
};

/* ---- the list of maps ------------------------------------------------- */

function mapRow(m) {
  var slot = HM.slots.find(function (s) { return s.id === m.slot; });
  var feeds = (m.logbook_ids || []).length
    ? (m.logbook_ids || []).map(function (id) {
      var c = HM.candidates.find(function (x) { return x.id === Number(id); });
      return c ? c.title : 'a logbook that is gone';
    }).join(', ')
    : 'every launched logbook';

  // Named separately in the summary too, so an operator reading the row
  // can see that entries are being counted and which lists they come from.
  var listFeeds = (m.list_ids || []).map(function (id) {
    var c = (HM.lists || []).find(function (x) { return x.id === Number(id); });
    return c ? c.title : 'a list that is gone';
  });
  if (listFeeds.length) feeds += ', and ' + listFeeds.join(', ');

  return '<div class="rc-card"><div class="who">'
    + '<b>' + esc(m.title) + '</b> '
    + (m.enabled
      ? '<span class="opt-req">published</span>'
      : '<span class="opt-req">not published</span>')
    + '<br><span class="opt-req">'
    + 'Shades an area at ' + esc(String(m.min_area)) + ' reports or more'
    + ' &middot; ' + esc(slot ? slot.label : m.slot)
    + ' &middot; fed by ' + esc(feeds)
    + '<br>Its own address: <code>/board/map/' + esc(m.slug) + '</code>'
    + '</span></div>'
    + '<button type="button" class="button is-secondary is-small" data-hm-open="'
    + esc(String(m.id)) + '">Change it</button></div>';
}

function renderMaps() {
  var box = el('hm-list');
  if (!box) return;
  say('hm-err', '');
  fetch('/api/admin/heat-maps', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) { box.innerHTML = '<div class="empty_component">Could not be read.</div>'; return; }
      HM = d;
      if (!HM.maps.length) {
        box.innerHTML = '<div class="empty_component">No maps yet. A deployment with no map '
          + 'publishes no map, which is the shipped state.</div>';
      } else {
        box.innerHTML = HM.maps.map(mapRow).join('');
      }
      renderFeeds();
      if (hmOpen) openMap(hmOpen.id);
    })
    .catch(function () {
      box.innerHTML = '<div class="empty_component">Could not be read.</div>';
    });
}

/* ---- one map's settings ------------------------------------------------ */

function checkRow(name, value, label, help, checked, disabled) {
  return '<label class="form_label"><input type="checkbox" data-hm-' + name + '="'
    + esc(value) + '"' + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') + '> '
    + esc(label) + '</label>'
    + (help ? '<span class="form_help">' + esc(help) + '</span>' : '');
}

/** Every question an operator marked as able to colour an outcome. */
function outcomeChoices() {
  var out = [];
  HM.candidates.forEach(function (c) {
    (c.outcomes || []).forEach(function (f) {
      if (f.map_outcome) out.push({ field: f, book: c });
    });
  });
  return out;
}

function editorHtml() {
  var m = hmDraft;
  var isNew = !m.id;
  var marked = outcomeChoices();

  var logbooks = HM.candidates.map(function (c) {
    var on = (m.logbook_ids || []).map(Number).indexOf(c.id) >= 0;
    var placed = (c.places || []).some(function (p) { return p.map_location; });
    return '<label class="form_label"><input type="checkbox" data-hm-logbook="'
      + esc(String(c.id)) + '"' + (on ? ' checked' : '') + '> ' + esc(c.title)
      + '</label><span class="form_help">'
      + (placed
        ? (c.launched ? 'Ready to be mapped.' : 'Not launched yet, so it has no published reports.')
        : 'No question places a report on a map yet — set one in the panel below, '
          + 'or nothing from this logbook will appear.')
      + '</span>';
  }).join('');

  /* LISTS, UNDER THEIR OWN HEADING AND NOT MIXED IN WITH THE LOGBOOKS.
     The two are different id spaces and the server stores them in two
     columns; ticking them into one group would be the panel pretending
     they are one thing. The wording also has to differ, because the
     defaults differ: no tick means EVERY launched logbook, and no tick
     means NO lists. */
  var lists = (HM.lists || []).map(function (c) {
    var on = (m.list_ids || []).map(Number).indexOf(c.id) >= 0;
    var placed = (c.places || []).some(function (p) { return p.map_location; });
    return '<label class="form_label"><input type="checkbox" data-hm-list="'
      + esc(String(c.id)) + '"' + (on ? ' checked' : '') + '> ' + esc(c.title)
      + '</label><span class="form_help">'
      + (placed
        ? 'Ready to be counted. Approved entries only.'
        : 'No question places an entry on a map yet. A list’s form stays '
          + 'editable, so you can add a “Location on a map” question and mark '
          + 'it in the panel below.')
      + '</span>';
  }).join('');

  return '<div class="panel_component margin-top margin-xsmall">'
    + '<h3 class="heading-style-h5 margin-bottom margin-tiny">'
    + (isNew ? 'A new map' : 'Changing &ldquo;' + esc(m.title) + '&rdquo;') + '</h3>'

    + '<label class="form_label" for="hm-title">What it is called</label>'
    + '<input class="form_input" id="hm-title" value="' + esc(m.title || '') + '" maxlength="160">'
    + '<span class="form_help">A reader sees this above the map.</span>'

    + '<label class="form_label" for="hm-slug">Its short name</label>'
    + '<input class="form_input" id="hm-slug" value="' + esc(m.slug || '') + '">'
    + '<span class="form_help">Lowercase letters, numbers and hyphens. It goes in the '
    + 'address, so a link somebody shares stops working if you change it.</span>'

    + '<label class="form_label" for="hm-blurb">A line about it</label>'
    + '<textarea class="form_input" id="hm-blurb" rows="2" maxlength="2000">'
    + esc(m.blurb || '') + '</textarea>'

    + '<p class="lab form_label-sep">The threshold</p>'
    + '<label class="form_label" for="hm-min">Shade an area once it has this many reports</label>'
    + '<input class="form_input" id="hm-min" type="number" min="' + esc(String(HM.floor))
    + '" max="1000" value="' + esc(String(m.min_area || 3)) + '">'
    + '<span class="form_help">An area under this is sent to the reader without its '
    + 'count at all, so nobody can read the number off the page or out of the network. '
    + 'The lowest allowed is ' + esc(String(HM.floor)) + ': a threshold of 1 is the '
    + 'protection switched off while still looking as though it is on. Think hard about '
    + 'this one if your archive covers a small place — an area crossing the '
    + 'threshold tells somebody watching daily that a report arrived there.</span>'

    + '<p class="lab form_label-sep">Which map</p>'
    + HM.planes.map(function (p) {
      return checkRow('plane', p, PLANE_NAMES[p] || p, null,
        (m.planes || []).indexOf(p) >= 0, false);
    }).join('')

    + '<p class="lab form_label-sep">What the colour shows</p>'
    + '<span class="form_help">The reader picks among whatever you offer here. The '
    + 'threshold is not theirs to change.</span>'
    + HM.views.map(function (v) {
      return checkRow('view', v, VIEW_NAMES[v] || v, VIEW_HELP[v],
        (m.views || []).indexOf(v) >= 0,
        v === 'outcome' && !marked.length);
    }).join('')

    + '<label class="form_label" for="hm-outcome">The question that colours it</label>'
    + '<select class="form_select" id="hm-outcome">'
    + '<option value="">None</option>'
    + marked.map(function (o) {
      return '<option value="' + esc(String(o.field.id)) + '"'
        + (Number(m.outcome_field_id) === o.field.id ? ' selected' : '') + '>'
        + esc(o.book.title + ' — ' + o.field.label) + '</option>';
    }).join('')
    + '</select>'
    + '<span class="form_help">'
    + (marked.length
      ? 'Only questions marked below are offered.'
      : 'Nothing is marked yet. Mark a question in the panel below first.')
    + '</span>'

    + '<p class="lab form_label-sep">What feeds it</p>'
    + '<span class="form_help">Tick none to count every launched logbook, which is '
    + 'what a deployment with one kind of report wants.</span>'
    + logbooks
    + ((HM.lists || []).length
      ? '<p class="lab form_label-sep">Lists it also counts</p>'
        + '<span class="form_help">A list is counted only if you tick it — '
        + 'unlike logbooks, where ticking none means all of them. Only entries '
        + 'a moderator has approved are counted, and only the durable half of '
        + 'one: a place code is never erased by the retention sweep. An entry '
        + 'cannot colour the Outcome view, because a list is approved in bulk '
        + 'rather than judged one at a time.</span>'
        + lists
      : '')

    + '<p class="lab form_label-sep">Where it appears</p>'
    + '<label class="form_label" for="hm-slot">On the site</label>'
    + '<select class="form_select" id="hm-slot">'
    + HM.slots.map(function (s) {
      return '<option value="' + esc(s.id) + '"'
        + (m.slot === s.id ? ' selected' : '') + '>' + esc(s.label) + '</option>';
    }).join('')
    + '</select>'
    + '<span class="form_help" id="hm-slot-help">'
    + esc((HM.slots.find(function (s) { return s.id === m.slot; }) || {}).description || '')
    + '</span>'

    + '<label class="form_label" for="hm-position">Its order, where there is more than one</label>'
    + '<input class="form_input" id="hm-position" type="number" value="'
    + esc(String(m.position || 0)) + '">'

    + '<p class="lab form_label-sep">Publishing it</p>'
    + '<label class="form_label"><input type="checkbox" id="hm-enabled"'
    + (m.enabled ? ' checked' : '') + '> Publish this map</label>'
    + '<span class="form_help">Off until you turn it on. Nothing of it is drawn, '
    + 'fetched or counted for a reader while it is off.</span>'

    + '<p class="form_error" id="hm-edit-err" role="status" aria-live="polite"></p>'
    + '<div class="row grouped margin-top margin-tiny">'
    + '<button type="button" class="button" id="hm-save">'
    + (isNew ? 'Make it' : 'Save it') + '</button>'
    + '<button type="button" class="button is-secondary is-small" id="hm-cancel">Cancel</button>'
    + (isNew ? '' : '<button type="button" class="button is-secondary is-small" id="hm-delete">'
      + 'Delete this map</button>')
    + '</div></div>';
}

function paintEditor() {
  var box = el('hm-editor');
  if (!box) return;
  if (!hmDraft) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = editorHtml();
}

function openMap(id) {
  var m = HM.maps.find(function (x) { return String(x.id) === String(id); });
  if (!m) return;
  hmOpen = m;
  hmDraft = JSON.parse(JSON.stringify(m));
  paintEditor();
}

function newMap() {
  hmOpen = null;
  hmDraft = {
    title: '', slug: '', blurb: '', enabled: false, min_area: 3,
    planes: ['us'], views: ['volume'], logbook_ids: [], list_ids: [], outcome_field_id: null,
    slot: (HM.slots[0] || {}).id || 'board_tab', position: 0,
  };
  paintEditor();
}

/** What is on screen, as the route wants it. */
function collect() {
  var ticked = function (attr) {
    return Array.prototype.slice
      .call(document.querySelectorAll('[data-hm-' + attr + ']'))
      .filter(function (b) { return b.checked; })
      .map(function (b) { return b.getAttribute('data-hm-' + attr); });
  };
  return {
    title: el('hm-title').value.trim(),
    slug: el('hm-slug').value.trim(),
    blurb: el('hm-blurb').value.trim(),
    enabled: el('hm-enabled').checked,
    min_area: Number(el('hm-min').value),
    planes: ticked('plane'),
    views: ticked('view'),
    logbook_ids: ticked('logbook').map(Number),
    list_ids: ticked('list').map(Number),
    outcome_field_id: el('hm-outcome').value ? Number(el('hm-outcome').value) : null,
    slot: el('hm-slot').value,
    position: Number(el('hm-position').value) || 0,
  };
}

function save() {
  var body = collect();
  var isNew = !hmDraft.id;
  say('hm-edit-err', '');
  fetch('/api/admin/heat-maps' + (isNew ? '' : '/' + hmDraft.id), {
    method: isNew ? 'POST' : 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  }).then(function (r) {
    return r.json().then(function (d) { return { ok: r.ok, d: d }; });
  }).then(function (res) {
    // THE SERVER'S OWN WORDS. Each refusal names the box that is wrong and
    // says why; rewriting them here would be a second explanation to keep
    // true, and the server's is the one that matches what it actually did.
    if (!res.ok) { say('hm-edit-err', res.d.error || 'That could not be saved.'); return; }
    hmOpen = null; hmDraft = null;
    paintEditor();
    renderMaps();
  }).catch(function () { say('hm-edit-err', 'That could not be saved.'); });
}

function remove() {
  if (!hmDraft || !hmDraft.id) return;
  /* ONE CONFIRMATION, because what is lost is the settings and not any
     report. A heat map holds no reports and is referenced by none —
     deleting one removes a view. Saying so in the question is the point:
     an operator who thinks they might be deleting reports will not press
     it, and an operator who thinks a delete is harmless when it is not is
     the worse failure. */
  if (!window.confirm('Delete this map? Its settings go; no report is touched, '
    + 'and any link to it stops working.')) return;
  fetch('/api/admin/heat-maps/' + hmDraft.id, {
    method: 'DELETE', credentials: 'same-origin',
  }).then(function () {
    hmOpen = null; hmDraft = null;
    paintEditor();
    renderMaps();
  });
}

/* ---- which questions can feed a map ----------------------------------- */

function feedRow(book) {
  var places = (book.places || []).map(function (f) {
    return '<label class="form_label"><input type="radio" name="hm-place-' + esc(String(book.id))
      + '" data-hm-place="' + esc(String(f.id)) + '"' + (f.map_location ? ' checked' : '')
      + '> ' + esc(f.label) + '</label>';
  }).join('');

  var outcomes = (book.outcomes || []).map(function (f) {
    return '<label class="form_label"><input type="checkbox" data-hm-outcome-flag="'
      + esc(String(f.id)) + '"' + (f.map_outcome ? ' checked' : '') + '> '
      + esc(f.label) + '</label>'
      + (f.map_outcome && !f.stances
        ? '<span class="form_help">Marked, but none of its answers are called positive or '
          + 'negative yet, so it colours nothing. Set those where the question is edited.</span>'
        : '');
  }).join('');

  return '<div class="rc-card"><div class="who"><b>' + esc(book.title) + '</b>'
    + (book.launched ? '' : ' <span class="opt-req">not launched</span>')
    + '<br>'
    + (places
      ? '<span class="opt-req">Which question places a report</span>' + places
        + '<label class="form_label"><input type="radio" name="hm-place-'
        + esc(String(book.id)) + '" data-hm-place="none"'
        + ((book.places || []).some(function (f) { return f.map_location; }) ? '' : ' checked')
        + '> None of them</label>'
      : '<span class="opt-req">This logbook has no &ldquo;Location on a map&rdquo; '
        + 'question, so it cannot be mapped. Add one where its questions are edited '
        + '&mdash; on a launched logbook it can be added as an optional question.</span>')
    + (outcomes
      ? '<span class="opt-req">Questions that may colour an outcome</span>' + outcomes
      : '')
    + '</div></div>';
}

/* THE SAME CARD FOR A LIST, and a separate function rather than a flag on
   feedRow, because three of the four things feedRow says do not apply: a
   list has no launch state, no outcome questions, and its form can simply
   be edited to add the question it is missing. One function with branches
   for all of that would be harder to read than two. */
function listFeedRow(list) {
  var places = (list.places || []).map(function (f) {
    return '<label class="form_label"><input type="radio" name="hm-lplace-'
      + esc(String(list.id)) + '" data-hm-list-place="' + esc(String(f.id)) + '"'
      + (f.map_location ? ' checked' : '') + '> ' + esc(f.label) + '</label>';
  }).join('');

  return '<div class="rc-card"><div class="who"><b>' + esc(list.title) + '</b>'
    + ' <span class="opt-req">list</span><br>'
    + (places
      ? '<span class="opt-req">Which question places an entry</span>' + places
        + '<label class="form_label"><input type="radio" name="hm-lplace-'
        + esc(String(list.id)) + '" data-hm-list-place="none"'
        + ((list.places || []).some(function (f) { return f.map_location; }) ? '' : ' checked')
        + '> None of them</label>'
      : '<span class="opt-req">This list has no &ldquo;Location on a map&rdquo; '
        + 'question yet. Add one where its questions are edited &mdash; a '
        + 'list&rsquo;s form stays editable, so there is no launch to work '
        + 'around.</span>')
    + '</div></div>';
}

function renderFeeds() {
  var box = el('hm-feeds');
  if (!box) return;
  if (!HM.candidates.length && !(HM.lists || []).length) {
    box.innerHTML = '<div class="empty_component">No logbooks or lists yet.</div>';
    return;
  }
  box.innerHTML = HM.candidates.map(feedRow).join('')
    + (HM.lists || []).map(listFeedRow).join('');
}

/** The question marked for one list, or none. Mirrors choosePlace. */
function chooseListPlace(list, fieldId) {
  // UNMARK THE OLD ONE FIRST, for the reason choosePlace does: the database
  // holds at most one per list, so marking a second while the first stands
  // is refused — and that refusal reads as "this question cannot be used",
  // which is not what happened.
  var current = (list.places || []).find(function (f) { return f.map_location; });
  var chain = (current && String(current.id) !== String(fieldId))
    ? setListFlag(current.id, false)
    : Promise.resolve();
  return chain.then(function () {
    if (fieldId === 'none') return renderMaps();
    return setListFlag(fieldId, true);
  });
}

function setListFlag(fieldId, on) {
  say('hm-feeds-err', '');
  return fetch('/api/admin/heat-maps/list-question/' + fieldId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ map_location: !!on }),
  }).then(function (r) {
    return r.json().then(function (d) { return { ok: r.ok, d: d }; });
  }).then(function (res) {
    if (!res.ok) say('hm-feeds-err', res.d.error || 'That could not be saved.');
    renderMaps();
  });
}

function setFlags(fieldId, flags) {
  say('hm-feeds-err', '');
  return fetch('/api/admin/heat-maps/question/' + fieldId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(flags),
  }).then(function (r) {
    return r.json().then(function (d) { return { ok: r.ok, d: d }; });
  }).then(function (res) {
    if (!res.ok) say('hm-feeds-err', res.d.error || 'That could not be saved.');
    /* IT APPLIED WHEN THEY TOUCHED IT. Marking a question as a feed has no
       Save next to it and writes straight away, so it says so — after the
       server has answered, and only when it accepted. A notification that
       appears either way teaches an operator not to believe it. */
    else toast('Feed saved.');
    // Re-read either way: a refusal means the screen is now showing
    // something the server did not accept.
    renderMaps();
  });
}

/** The question marked for one logbook, or none. */
function choosePlace(book, fieldId) {
  // UNMARK THE OLD ONE FIRST. The database holds at most one per logbook, so
  // marking a second while the first is still marked is refused — and the
  // refusal would read to an operator as "this question cannot be used",
  // which is not what happened.
  var current = (book.places || []).find(function (f) { return f.map_location; });
  var clear = current && String(current.id) !== String(fieldId)
    ? setFlags(current.id, { map_location: false, map_outcome: current.map_outcome })
    : Promise.resolve();
  return clear.then(function () {
    if (fieldId === 'none') return renderMaps();
    var f = (book.places || []).find(function (x) { return String(x.id) === String(fieldId); });
    return setFlags(fieldId, { map_location: true, map_outcome: f ? f.map_outcome : false });
  });
}

function bookOfField(fieldId) {
  return HM.candidates.find(function (c) {
    return (c.places || []).some(function (f) { return String(f.id) === String(fieldId); })
      || (c.outcomes || []).some(function (f) { return String(f.id) === String(fieldId); });
  });
}

/* ---- wiring ------------------------------------------------------------ */

function wireMaps() {
  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;

    if (e.target.closest('#hm-new')) { newMap(); return; }
    if (e.target.closest('#hm-cancel')) { hmOpen = null; hmDraft = null; paintEditor(); return; }
    if (e.target.closest('#hm-save')) { save(); return; }
    if (e.target.closest('#hm-delete')) { remove(); return; }

    var open = e.target.closest('[data-hm-open]');
    if (open) { openMap(open.getAttribute('data-hm-open')); return; }

    var place = e.target.closest('[data-hm-place]');
    if (place) {
      var id = place.getAttribute('data-hm-place');
      var book = id === 'none'
        ? HM.candidates.find(function (c) {
          return (c.places || []).some(function (f) { return f.map_location; })
            && place.getAttribute('name') === 'hm-place-' + c.id;
        })
        : bookOfField(id);
      if (book) choosePlace(book, id);
      return;
    }

    var lplace = e.target.closest('[data-hm-list-place]');
    if (lplace) {
      var lid = lplace.getAttribute('data-hm-list-place');
      var name = lplace.getAttribute('name') || '';
      var list = (HM.lists || []).find(function (c) {
        return name === 'hm-lplace-' + c.id;
      });
      if (list) chooseListPlace(list, lid);
      return;
    }

    var flag = e.target.closest('[data-hm-outcome-flag]');
    if (flag) {
      var fid = flag.getAttribute('data-hm-outcome-flag');
      var b = bookOfField(fid);
      var f = b && (b.outcomes || []).find(function (x) { return String(x.id) === String(fid); });
      setFlags(fid, {
        map_outcome: flag.checked,
        map_location: f ? f.map_location : false,
      });
    }
  });

  // The slot's explanation follows the choice, because the slots differ in
  // ways that matter — the front page is the most visible one there is.
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'hm-slot') {
      var s = HM.slots.find(function (x) { return x.id === e.target.value; });
      say('hm-slot-help', s ? s.description : '');
    }
  });
}

wireMaps();

export {
  renderMaps,
};
