/*
 * The Updates panel.
 *
 * Shows what this deployment is running, what is on the branch it follows,
 * and the release notes for everything in between. The button asks for an
 * update; it does not perform one. A root timer does that, and re-checks
 * everything this page says before it acts — so nothing here is trusted and
 * nothing here is a privilege.
 *
 * NO INLINE STYLE OR SCRIPT, like everything else in public/: the CSP is
 * `script-src 'self'` and `style-src 'self'`, so a style attribute added
 * here is a console error and a panel that renders wrong.
 */

const $ = (id) => document.getElementById(id);

// While an update is running the server restarts underneath us, so a failed
// poll is expected rather than an error worth showing.
let polling = null;

/* The last payload, kept so the "checked N ago" line can be re-rendered
   without asking the server again. A relative time that is itself stale
   is worse than none: a pane left open for half an hour would sit there
   saying "just now", which is the exact misreading the line exists to
   prevent. Re-rendered from the same payload, so this costs no fetch and
   cannot change what the panel claims. */
let last = null;
let ticking = null;

function text(el, s) { el.textContent = s; }

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s == null ? '' : s);
  return d.innerHTML;
}

/* Release notes are markdown-ish prose. Rendering markdown honestly needs a
   parser and a sanitiser, and this application has seven dependencies — the
   same decision editorial notes made. So: paragraphs, and bold where the
   notes use it, and nothing else. */
function notesHtml(notes) {
  return String(notes || '')
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p class="text-size-small">${
      esc(para).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\n/g, ' ')
    }</p>`)
    .join('');
}

/* Plain language, because this sits on a panel an operator reads rather
   than a log. The absolute time goes in the title attribute: the question
   this line answers is "is what I am looking at stale", and a clock time
   does not answer it without arithmetic. */
function ago(then, now) {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 10) return 'just now';
  if (s < 90) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 90) return m === 1 ? 'a minute ago' : `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 36) return h === 1 ? 'an hour ago' : `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/**
 * WHEN THE DEPLOYMENT LAST ASKED, which is not when this page loaded.
 *
 * `checkForUpdate()` caches its answer for ten minutes and the cached
 * value carries the time it was actually computed, so "Up to date" on a
 * freshly opened pane can be nine minutes old. Nothing on the panel said
 * so, and the server had been sending `checkedAt` the whole time — the
 * pane simply never rendered it.
 *
 * A failed fetch is still a check, and saying only "checked" for one
 * would claim a comparison against the remote that did not happen.
 */
function renderChecked(d) {
  const box = $('upd-checked');
  if (!box) return;
  last = d;
  if (!ticking) ticking = setInterval(() => { if (last) renderChecked(last); }, 30000);
  const when = d.checkedAt ? new Date(d.checkedAt) : null;
  // No commit means this is not a git checkout, so there was nothing to
  // check and a time would be describing a thing that did not happen.
  if (!d.currentCommit || !when || Number.isNaN(when.getTime())) {
    text(box, '');
    box.removeAttribute('title');
    return;
  }
  const stamp = ago(when.getTime(), Date.now());
  text(box, d.fetched === false
    ? `Checked ${stamp}, but the remote could not be reached — what is above is the previous fetch.`
    : `Checked ${stamp}.`);
  box.title = when.toLocaleString();
}

function renderReleases(releases) {
  const wrap = $('upd-releases');
  if (!wrap) return;
  if (!releases || !releases.length) { wrap.innerHTML = ''; return; }

  // Each release folds open on its own. A deployment three versions behind
  // is being asked to accept three sets of changes, and "what am I about to
  // change" is not answered by the newest one alone.
  wrap.innerHTML = `<h3 class="heading-style-h5 margin-top margin-tiny">What is in it</h3>${
    releases.map((r, i) => `<details class="margin-bottom margin-tiny"${i === 0 ? ' open' : ''}>
      <summary><b>${esc(r.version)}</b>${r.date ? ` &middot; ${esc(r.date)}` : ''}</summary>
      ${notesHtml(r.notes) || '<p class="text-size-small text-color-muted">No release notes.</p>'}
    </details>`).join('')}`;
}

function renderCommits(commits) {
  const wrap = $('upd-commits-wrap');
  const box = $('upd-commits');
  if (!wrap || !box) return;
  if (!commits || !commits.length) { wrap.hidden = true; box.innerHTML = ''; return; }
  wrap.hidden = false;
  box.innerHTML = `<ul class="text-size-small">${
    commits.map((c) => `<li><code>${esc(c.sha)}</code> ${esc(c.subject)}</li>`).join('')}</ul>`;
}

function renderHistory(history) {
  const wrap = $('upd-history-wrap');
  const box = $('upd-history');
  if (!wrap || !box) return;
  if (!history || !history.length) { wrap.hidden = true; return; }
  wrap.hidden = false;
  box.innerHTML = `<ul class="text-size-small">${history.map((h) => {
    const when = h.requested_at ? new Date(h.requested_at).toLocaleString() : '';
    const who = h.requested_email ? esc(h.requested_email) : 'somebody';
    const moved = `${esc(h.from_version || '?')} &rarr; ${esc(h.target_version || '?')}`;
    const how = h.outcome ? esc(h.outcome) : 'no result recorded';
    return `<li>${esc(when)} &middot; ${who} &middot; ${moved} &middot; ${how}</li>`;
  }).join('')}</ul>`;
}

function render(d) {
  const box = $('upd-state');
  const apply = $('upd-apply');
  const cancel = $('upd-cancel');
  if (!box) return;

  const st = d.state || {};
  const status = d.status || { state: 'idle' };
  const busy = d.busy || status.state === 'running' || status.state === 'queued';

  if (!d.available) {
    box.innerHTML = `<p class="text-size-small">${esc(d.reason || 'Updates cannot be checked here.')}</p>
      <p class="text-size-small text-color-muted">Update over SSH with <code>contrib/deploy.sh</code>.</p>`;
    if (apply) apply.hidden = true;
    if (cancel) cancel.hidden = true;
    renderChecked(d);
    renderReleases([]); renderCommits([]); renderHistory(d.history);
    return;
  }

  const lines = [];
  /* SEVEN CHARACTERS, BECAUSE THAT IS WHAT EVERYTHING ELSE SAYS. This line
     showed twelve, on the argument that twelve can be pasted into
     `git show` with confidence and seven cannot. True, and it lost to a
     worse problem: `git log --oneline`, `git rev-parse --short` and so
     deploy.sh's own "BEFORE -> AFTER" all print seven, so the one number
     on the screen was the one number that matched nothing. Comparing
     "31df9ef7a26d" here against "31df9ef" in a terminal is work, and work
     at exactly the moment somebody is asking the simple question this line
     exists for: is the thing I just built the thing that is running.

     THE WHOLE COMMIT IS STILL HERE, in the title and selectable, so
     anything that needs pasting has it. */
  const commit = String(d.currentCommit || '');
  lines.push(`<p class="text-size-small">Running <b>${esc(st.currentVersion || 'unknown')}</b>`
    + (commit
      ? ` &middot; built from <code title="${esc(commit)}">${esc(commit.slice(0, 7))}</code>`
      : ' &middot; <span class="text-color-muted">no commit — this checkout is not a git clone</span>')
    + ` on <code>${esc(d.branch || 'stable')}</code>.</p>`);

  // THE SCHEMA, which is the other half of "what is on this box" and the
  // half nothing used to show. The commit says what the CODE is; this says
  // what the DATABASE is, and a deploy that pulled without migrating has
  // the new commit and the old schema, with every new feature simply
  // absent and nothing reporting a fault.
  const sc = d.schema;
  if (sc) {
    if (!sc.reachable) {
      lines.push('<p class="text-size-small"><b>No schema yet.</b> Nothing has been'
        + ` migrated here. ${sc.pending.length} migration(s) are waiting:`
        + ' <code>npm run migrate</code>.</p>');
    } else if (sc.pending.length) {
      // The loud case, deliberately: this is a deployment running code
      // against a database that has not caught up with it.
      lines.push('<p class="text-size-small"><b>The database has not caught up with this'
        + ` code.</b> ${sc.applied} of ${sc.onDisk} migrations are applied, and`
        + ` ${sc.pending.length} are waiting &mdash; starting with`
        + ` <code>${esc(sc.pending[0])}</code>. Anything those add is absent until`
        + ' somebody runs <code>npm run migrate</code>.</p>');
    } else {
      lines.push(`<p class="text-size-small">Schema: <b>${sc.applied}</b> migrations applied,`
        + ` newest <code>${esc(sc.newest || '—')}</code>.</p>`);
    }
    if (sc.unknown && sc.unknown.length) {
      // The other direction, which is a different fault: the database has
      // run migrations this checkout does not carry, so the code is OLDER
      // than the archive it is reading.
      lines.push('<p class="text-size-small"><b>This code is older than this'
        + ` database.</b> It has run ${sc.unknown.length} migration(s) this checkout`
        + ` does not carry, starting with <code>${esc(sc.unknown[0])}</code>.`
        + ' Updating is the fix; do not migrate.</p>');
    }
  }

  /* IS ANYTHING LISTENING? Computed before the state lines, because both
     "up to date" and "an update is available" want to say something about
     it, and they want to say different things. src/updateWorker.js has the
     whole of why this had to exist. */
  const worker = d.worker || {};
  const noWorker = worker.listening === false || worker.listening === null;

  if (busy) {
    lines.push(`<p class="text-size-small"><b>Updating.</b> ${esc(status.detail || 'in progress')}`
      + ' &mdash; the site will restart in a moment.</p>');
  } else if (status.state === 'failed') {
    // Shown prominently and not cleared by a refresh: a failed update is the
    // one state where somebody has to go and look.
    // WITH ITS TIME. Without one, a failure from before a later manual
    // deploy reads as the state of the box now — which is what happened on
    // the first real install: a refusal from the old updater went on being
    // shown, undated, after the box had been updated by hand past it.
    const when = status.at ? new Date(status.at) : null;
    const stamp = when && !Number.isNaN(when.getTime())
      ? ` at ${esc(when.toLocaleString())}` : '';
    lines.push(`<p class="text-size-small"><b>The update attempted${stamp} failed.</b>`
      + ` ${esc(status.detail || '')}</p>`);
  } else if (!st.hasUpdate) {
    lines.push('<p class="text-size-small">Up to date.</p>');
    /* QUIETLY, WHEN THERE IS NOTHING TO INSTALL. An operator wants to find
       out that the button is dead while setting the box up, not in three
       weeks with a release waiting — but a loud warning on a screen where
       nothing is wrong is the kind of noise that teaches somebody to stop
       reading this panel. So: muted here, prominent below once an update is
       actually available. */
    if (noWorker) {
      lines.push('<p class="text-size-small text-color-muted">One step is missing before '
        + 'this deployment can install an update itself. '
        + esc(worker.reason || '')
        + (worker.fix ? ` Run once: <code>${esc(worker.fix)}</code>` : '') + '</p>');
    }
  }

  /* ONE STEP IS MISSING, AND HERE IS THE COMMAND.
     The application cannot apply an update itself — it leaves a file naming
     a commit and a root timer does the work, which is what stops a web
     vulnerability becoming root on an archive of people's identities. If
     that timer was never installed the button cannot work, and the fix is
     one idempotent command.
     SAID AS AN UNFINISHED SETUP RATHER THAN AS A LIMITATION, because that
     is what it is: `contrib/deploy.sh` installs units now, so this only
     happens on a box that has not deployed since the timer existed.
     src/updateWorker.js has the rest. */
  if (noWorker && st.hasUpdate && !busy) {
    lines.push('<p class="text-size-small"><b>One step is missing before this can'
      + ' install itself.</b> ' + esc(worker.reason || '')
      + (worker.fix
        /* `.vpre` and not `.cmd`: `.cmd` is the install guide's class and
           lives in docs-page.css, which the app shell does not load — so it
           would have rendered unstyled here. `.vpre` is page.css's
           monospace block, already used for things meant to be copied. */
        ? ` Run it over SSH, once:</p><div class="vpre">${esc(worker.fix)}</div>`
        : '</p>'));
  }

  if (st.hasUpdate && !busy) {
    const behind = st.behind === 1 ? '1 commit' : `${st.behind} commits`;
    const to = st.availableVersion && st.availableVersion !== st.currentVersion
      ? ` &mdash; <b>${esc(st.availableVersion)}</b> is available`
      : '';
    lines.push(`<p class="text-size-small">${behind} behind${to}.</p>`);
    if (st.undocumented) {
      lines.push('<p class="text-size-small text-color-muted">There are no release'
        + ' notes for this one. The commit list below is all there is.</p>');
    }
  }

  if (d.reason) lines.push(`<p class="text-size-small text-color-muted">${esc(d.reason)}</p>`);
  box.innerHTML = lines.join('');

  if (apply) {
    /* THE BUTTON IS NOT HIDDEN FOR A MISSING WORKER, and that was the wrong
       answer the first time. Hiding a control is a polite way of saying the
       feature does not work: the operator is left with a panel that has
       nothing on it and no idea what to do. Updating from the admin page is
       supposed to work, so the button stays and the panel says the one
       thing standing in the way — above, with the command. The route still
       refuses to write a request nobody would read, so pressing it cannot
       pretend to have worked. */
    apply.hidden = !(st.hasUpdate && !busy);
    apply.disabled = Boolean(busy);
  }
  if (cancel) cancel.hidden = !(status.state === 'queued' && !busy);

  renderChecked(d);
  renderReleases(st.releases);
  renderCommits(st.commits);
  renderHistory(d.history);
}

async function load(refresh) {
  const err = $('upd-err');
  const btn = $('upd-refresh');
  if (err) text(err, '');

  /* THE BUTTON HAS TO SAY IT IS DOING SOMETHING. A forced check runs
     `git fetch` against the remote, which is a network call bounded at
     twenty seconds — and if the answer comes back the same, the panel
     afterwards is byte-identical to the panel before. So pressing it
     looked exactly like pressing a dead button, for up to twenty
     seconds, and the honest cases are the slow ones: an unreachable
     remote waits out the whole timeout. */
  if (refresh && btn) {
    btn.disabled = true;
    btn.dataset.idleLabel = btn.textContent;
    text(btn, 'Checking…');
    btn.setAttribute('aria-busy', 'true');
  }

  try {
    const r = await fetch(`/api/admin/update${refresh ? '?refresh=1' : ''}`, {
      credentials: 'same-origin',
    });
    if (!r.ok) throw new Error(`${r.status}`);
    const d = await r.json();
    render(d);
    const busy = d.busy || (d.status && (d.status.state === 'running' || d.status.state === 'queued'));
    if (busy && !polling) polling = setInterval(() => load(false), 5000);
    if (!busy && polling) { clearInterval(polling); polling = null; }
  } catch (e) {
    // During an update the server is restarting, so a failure here is the
    // expected middle of the operation rather than something to alarm about.
    if (!polling && err) text(err, 'Could not read the update state.');
  } finally {
    // In a `finally` so a thrown fetch does not leave the button stuck
    // reading "Checking…" with nothing on its way back.
    if (refresh && btn) {
      btn.disabled = false;
      text(btn, btn.dataset.idleLabel || 'Check now');
      btn.removeAttribute('aria-busy');
    }
  }
}

function renderUpdates() { load(false); }

function wireUpdates() {
  const refresh = $('upd-refresh');
  const apply = $('upd-apply');
  const cancel = $('upd-cancel');
  const err = $('upd-err');
  if (!refresh || !apply) return;

  refresh.addEventListener('click', () => load(true));

  apply.addEventListener('click', async () => {
    // One confirmation, because this restarts the site and runs migrations
    // against an append-only archive. Not a second one: a dialog nobody
    // reads is not a safeguard.
    if (!window.confirm('Install the update? The site will go down for about a minute'
      + ' while it backs up, installs and restarts.')) return;
    apply.disabled = true;
    if (err) text(err, '');
    try {
      const r = await fetch('/api/admin/update', {
        method: 'POST', credentials: 'same-origin',
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `${r.status}`);
      if (err) text(err, 'Asked for. It starts within a minute.');
    } catch (e) {
      if (err) text(err, `Could not ask for the update: ${e.message}`);
      apply.disabled = false;
    }
    load(false);
  });

  if (cancel) {
    cancel.addEventListener('click', async () => {
      try {
        await fetch('/api/admin/update', { method: 'DELETE', credentials: 'same-origin' });
      } catch { /* the reload below says what actually happened */ }
      load(false);
    });
  }
}

/* Wired on import, the same way admin-settings.js does it. Every element
   is looked up defensively because every pane is in the DOM from the first
   byte but this one is only reachable by an admin. */
wireUpdates();

export {
  renderUpdates, wireUpdates,
};
