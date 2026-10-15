/* admin-translog.js — where the daily anchor is published, and the backups.
 *
 * TWO PANELS IN OPERATIONS, both owner-only on the server. The screen does
 * not enforce that and must not pretend to: it asks, and a refusal is
 * shown as the server worded it.
 *
 * WHY THIS SCREEN EXISTS AT ALL. The anchor is the archive's claim that it
 * has not been quietly altered — every chain head, timestamped by an
 * authority that is not this server, published somewhere this server does
 * not control. Until now the destination lived in three environment
 * variables, so an operator with an admin panel and no shell had a
 * deployment that anchored to whatever `origin` happened to be, or to
 * nothing at all, with no screen saying which. A record that exists only
 * on the box it was meant to outlive is not a record.
 */

var TL = null;
var BK = null;

function el(id) { return document.getElementById(id); }
function say(id, t) { var n = el(id); if (n) n.textContent = t || ''; }
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ago(iso) {
  if (!iso) return 'never';
  var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return Math.round(s / 60) + ' minutes ago';
  if (s < 172800) return Math.round(s / 3600) + ' hours ago';
  return Math.round(s / 86400) + ' days ago';
}

function getJSON(url) {
  return fetch(url, { credentials: 'same-origin' }).then(function (r) {
    return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; });
  });
}
function send(url, method, body) {
  return fetch(url, {
    method: method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body || {}),
  }).then(function (r) {
    return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; });
  });
}

/* ---------- the log ---------- */

function remoteRows() {
  var list = (TL.remotes || []).slice();
  // ALWAYS ONE BLANK ROW at the end, so adding a mirror is typing rather
  // than finding a button. Mirrors are the point of the design and a
  // deployment with one is a deployment one company can silence.
  list.push({ name: '', url: '' });
  return list.map(function (r, i) {
    return '<div class="row grouped tl-remote">'
      + '<input class="form_input" data-tl-name="' + i + '" value="' + esc(r.name)
      + '" placeholder="origin" maxlength="39">'
      + '<input class="form_input" data-tl-url="' + i + '" value="' + esc(r.url)
      + '" placeholder="git@github.com:you/reportlog-transparency-log.git" maxlength="400">'
      + (r.name
        ? '<button type="button" class="button is-secondary is-small" data-tl-test="'
          + esc(r.name) + '">Test</button>'
        : '')
      + '</div>'
      + '<p class="form_help" id="tl-test-' + i + '"></p>';
  }).join('');
}

function keyBlock() {
  if (!TL.deploy_public_key) {
    return '<p class="form_help">No deploy key yet. Making one writes the private half '
      + 'to a file on this server that only the service user can read &mdash; never into '
      + 'the database and never into a backup of it, so a copy of the archive cannot '
      + 'publish to the log. The public half appears here for you to paste into the '
      + 'repository.</p>'
      + '<button type="button" class="button is-secondary is-small" id="tl-make-key">'
      + 'Make a deploy key</button>';
  }
  return '<p class="form_help">Paste this into the repository as a deploy key '
    + '<b>with write access</b>. Read-only is enough to pass the test below and not '
    + 'enough to publish, which is the one failure that looks like success.</p>'
    + '<div class="vpre" id="tl-pub">' + esc(TL.deploy_public_key) + '</div>'
    + '<p class="form_help">Fingerprint <code>' + esc(TL.deploy_key_fingerprint || '?')
    + '</code> &mdash; the host shows the same string, so you can compare them by eye. '
    + 'Made ' + esc(ago(TL.deploy_key_made_at)) + '.'
    + (TL.deploy_key_present ? '' : ' <b>The private half is missing from this server</b>, '
      + 'so pushes will fail until you make a new key and put it on the host.')
    + '</p>'
    + '<button type="button" class="button is-secondary is-small" id="tl-replace-key">'
    + 'Replace it</button>';
}

function lastPush() {
  if (!TL.last_push_at) {
    return '<p class="form_help">The anchor has not recorded a push yet. It runs once a '
      + 'day; nothing here is wrong on a deployment that has not reached its first run.</p>';
  }
  return '<p class="form_help">Last push ' + esc(ago(TL.last_push_at)) + ' &mdash; '
    + (TL.last_push_ok ? 'reached' : '<b>reached nothing</b>') + '. '
    + esc(TL.last_push_detail || '') + '</p>';
}

function renderLog() {
  var box = el('tl-body');
  if (!box) return;
  box.innerHTML =
    '<p class="lab form_label-sep">Where it is published</p>'
    + '<span class="form_help">One line per mirror. The daily push goes to exactly '
    + 'these addresses &mdash; the same ones Test tries. Several hosts under different '
    + 'operators is the whole design and not redundancy for its own sake: a record one '
    + 'company holds is a record one company can be compelled to remove.</span>'
    + remoteRows()
    + '<label class="form_label" for="tl-branch">The branch it pushes</label>'
    + '<input class="form_input" id="tl-branch" value="' + esc(TL.branch) + '">'

    + '<p class="lab form_label-sep">The checkout it commits into</p>'
    + '<input class="form_input" id="tl-dir" value="'
    + esc(TL.repo_dir_is_default ? '' : TL.repo_dir) + '" placeholder="' + esc(TL.repo_dir) + '">'
    + '<span class="form_help">Left blank this is ' + esc(TL.repo_dir)
    + '. A git checkout of the log, which the service user must be able to write.</span>'

    + '<p class="lab form_label-sep">The timestamp authority</p>'
    + '<input class="form_input" id="tl-tsa" value="' + esc(TL.tsa_url) + '">'
    + '<span class="form_help">It stamps the digest of the day&rsquo;s chain heads. It has '
    + 'to be somebody other than this server &mdash; that is what the timestamp is for.</span>'

    + '<p class="lab form_label-sep">The key it publishes with</p>'
    + keyBlock()

    + '<p class="lab form_label-sep">What happened last time</p>'
    + lastPush()

    + '<p class="form_error" id="tl-err" role="status" aria-live="polite"></p>'
    + '<div class="row grouped margin-top margin-tiny">'
    + '<button type="button" class="button" id="tl-save">Save</button></div>';
}

function collectLog() {
  var remotes = [];
  var names = document.querySelectorAll('[data-tl-name]');
  Array.prototype.forEach.call(names, function (n) {
    var i = n.getAttribute('data-tl-name');
    var u = document.querySelector('[data-tl-url="' + i + '"]');
    var name = n.value.trim();
    var url = u ? u.value.trim() : '';
    if (name || url) remotes.push({ name: name, url: url });
  });
  return {
    remotes: remotes,
    branch: el('tl-branch').value.trim(),
    repo_dir: el('tl-dir').value.trim(),
    tsa_url: el('tl-tsa').value.trim(),
  };
}

function loadLog() {
  var box = el('tl-body');
  if (!box) return Promise.resolve();
  return getJSON('/api/admin/transparency-log').then(function (res) {
    if (res.status === 403) {
      box.innerHTML = '<div class="empty_component">Only the owner can see where the '
        + 'transparency log is published.</div>';
      return;
    }
    if (!res.ok) { box.innerHTML = '<div class="empty_component">That could not be read.</div>'; return; }
    TL = res.d;
    renderLog();
  });
}

/* ---------- backups ---------- */

function renderBackups() {
  var box = el('bk-body');
  if (!box) return;
  if (!BK.readable) {
    box.innerHTML = '<p class="form_help"><b>' + esc(BK.dir) + ' cannot be read</b> by the '
      + 'application. That is either a directory that does not exist yet or one the service '
      + 'user has no access to &mdash; and it means nothing here can tell you whether '
      + 'backups are being taken.</p>';
    return;
  }
  box.innerHTML = '<p class="form_help">'
    + esc(String(BK.count)) + ' backup' + (BK.count === 1 ? '' : 's') + ' in <code>'
    + esc(BK.dir) + '</code>, keeping ' + esc(String(BK.keep)) + '. Newest: '
    + esc(BK.newest || 'none') + '.</p>'
    + (BK.health && BK.health.stale
      ? '<p class="form_help reason-warn"><b>The newest backup is older than it should be.</b> '
        + 'A backup that quietly stopped looks exactly like one that is working.</p>'
      : '')
    + '<p class="lab form_label-sep">Restoring one</p>'
    + '<p class="form_help">This is not a button, deliberately. Restoring means dropping and '
    + 'rebuilding the database this page is being served from, which the thing being '
    + 'restored cannot do to itself. Run it where you can watch it:</p>'
    + '<div class="vpre">' + esc(BK.restoreHint) + '</div>';
}

function loadBackups() {
  var box = el('bk-body');
  if (!box) return Promise.resolve();
  return getJSON('/api/admin/backups').then(function (res) {
    if (res.status === 403) {
      box.innerHTML = '<div class="empty_component">Only the owner can see the backups.</div>';
      return;
    }
    if (!res.ok) { box.innerHTML = '<div class="empty_component">That could not be read.</div>'; return; }
    BK = res.d;
    renderBackups();
  });
}

/* ---------- the archive, out and in ---------- */

function renderArchive() {
  var box = el('ar-body');
  if (!box) return;
  box.innerHTML =
    '<p class="lab form_label-sep">Take a copy out</p>'
    + '<p class="form_help">One JSON file holding the whole archive: every report and '
    + 'its versions, the logbooks and their forms, the restricted fields, the contact '
    + 'keys, the user accounts and the access log. <b>Treat the file the way you treat '
    + 'the database</b> &mdash; it is the same thing in a different shape, and it leaves '
    + 'here over your browser.</p>'
    + '<p class="form_help">This is NOT a backup. It re-encodes rather than preserving '
    + 'bytes. For a backup, use the <code>pg_dump</code> the panel above describes.</p>'
    + '<a class="button is-secondary is-small" id="ar-export" '
    + 'href="/api/admin/archive/export">Download the archive</a>'
    + '<p class="form_help" id="ar-export-note"></p>'

    + '<p class="lab form_label-sep">Put one in</p>'
    + '<p class="form_help"><b>Only into an empty archive.</b> Replaying into one that '
    + 'holds reports would interleave two histories, so it is refused &mdash; here and '
    + 'again in the script, because that is the copy that is true no matter who calls '
    + 'it.</p>'
    + '<p class="form_help reason-warn"><b>The reports come back; the hashes do not.</b> '
    + 'Every content hash and chain hash is computed afresh, because the hashed object\u2019s '
    + 'shape is whatever the current code says it is. The result is a valid archive that '
    + 'is NOT the archive it came from. On a real deployment that means the anchors '
    + 'already published name a head that no longer exists &mdash; and an archive that '
    + 'quietly stops reconciling with its own published proofs looks exactly like one '
    + 'that has been tampered with. Say it happened, in the transparency log, or do not '
    + 'do it. On a test server none of this matters.</p>'
    + '<input type="file" class="form_input" id="ar-file" accept="application/json,.json">'
    + '<p class="form_error" id="ar-err" role="status" aria-live="polite"></p>'
    + '<button type="button" class="button is-secondary is-small" id="ar-import">'
    + 'Import that file</button>'
    + '<p class="form_help" id="ar-import-note"></p>';
}

function renderOps() {
  renderArchive();
  return Promise.all([loadLog(), loadBackups()]);
}

/* ---------- wiring ---------- */

document.addEventListener('click', function (e) {
  if (!e.target.closest) return;

  if (e.target.closest('#tl-save')) {
    say('tl-err', '');
    send('/api/admin/transparency-log', 'PATCH', collectLog()).then(function (res) {
      if (!res.ok) { say('tl-err', res.d.error || 'That could not be saved.'); return; }
      TL = res.d;
      renderLog();
      say('tl-err', '');
    });
    return;
  }

  var make = e.target.closest('#tl-make-key') || e.target.closest('#tl-replace-key');
  if (make) {
    var replacing = make.id === 'tl-replace-key';
    if (replacing && !window.confirm('Replace the deploy key? Every push stops working '
      + 'until you put the new public half on each host.')) return;
    say('tl-err', '');
    send('/api/admin/transparency-log/key', 'POST', { replace: replacing }).then(function (res) {
      if (!res.ok) { say('tl-err', res.d.error || 'The key could not be made.'); return; }
      return loadLog();
    });
    return;
  }

  if (e.target.closest('#ar-import')) {
    say('ar-err', '');
    var input = el('ar-file');
    var f = input && input.files && input.files[0];
    if (!f) { say('ar-err', 'Choose a file first.'); return; }
    if (!window.confirm('Import ' + f.name + '? This replays an archive into this '
      + 'deployment and builds a NEW chain. It only works on an empty archive.')) return;
    say('ar-import-note', 'Reading ' + f.name + '\u2026');
    f.text().then(function (text) {
      say('ar-import-note', 'Importing ' + Math.round(text.length / 1024) + ' KB\u2026 '
        + 'this can take a while and the page will wait for it.');
      return fetch('/api/admin/archive/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: text,
      });
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, d: d }; });
    }).then(function (res) {
      if (!res.ok) {
        say('ar-import-note', '');
        say('ar-err', (res.d.error || 'The import failed.')
          + (res.d.detail ? ' — ' + res.d.detail.split('\n').slice(-3).join(' ') : ''));
        return;
      }
      say('ar-import-note', 'Done: ' + res.d.reports + ' report(s) in the archive. '
        + 'Reload to see them.');
    }).catch(function (err) {
      say('ar-import-note', '');
      say('ar-err', 'The import could not be sent: ' + err.message);
    });
    return;
  }

  var test = e.target.closest('[data-tl-test]');
  if (test) {
    var name = test.getAttribute('data-tl-test');
    var row = test.closest('.tl-remote');
    var out = row && row.nextElementSibling;
    if (out) out.textContent = 'Asking ' + name + '…';
    send('/api/admin/transparency-log/test/' + encodeURIComponent(name), 'POST', {})
      .then(function (res) {
        if (!out) return;
        if (!res.ok) { out.textContent = res.d.error || 'That could not be tested.'; return; }
        var d = res.d;
        if (!d.ok) { out.textContent = d.reason; return; }
        /* REACHING IT IS NOT THE SAME AS BEING ABLE TO PUBLISH TO IT, and
           saying "works" here would be the failure that looks like
           success: ls-remote passes on a read-only deploy key. */
        out.textContent = 'Reached it' + (d.usedKey ? ' with the deploy key' : '')
          + '. ' + (d.hasBranch
            ? 'The branch is there.'
            : 'It has no ' + (TL ? TL.branch : 'target') + ' branch yet — the first push makes it.')
          + ' This proves it can be READ; only a real anchor proves it can be written.';
      });
  }
});

export {
  renderOps,
};
