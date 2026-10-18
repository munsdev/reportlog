/**
 * The Updates panel.
 *
 * The logic is proved in scripts/selftest.js and the privileged half in
 * contrib/update-apply.sh, which this cannot reach at all. What is only
 * true on screen is here, and the parts that matter are the ones about
 * NOT offering something:
 *
 *   - no button when there is nothing to install
 *   - no button while an update is already running
 *   - a deployment that cannot self-update says so and points at SSH
 *
 * A button that appears when it should not is how somebody restarts a live
 * archive by accident.
 */
import { BASE, Report, settle } from './lib.js';

const ADMIN = {
  id: '1', email: 'admin@example.org', role: 'admin', is_tester: false, memberships: [],
};

const json = (body) => (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify(body),
});

const SHA_OLD = 'a'.repeat(40);
const SHA_NEW = 'b'.repeat(40);

/** The shape /api/admin/update returns, with only what a case changes. */
function payload(over = {}) {
  const state = {
    currentVersion: 'v0.0.3',
    availableVersion: 'v0.0.3',
    hasUpdate: false,
    behind: 0,
    releases: [],
    undocumented: false,
    commits: [],
    status: { state: 'idle', detail: '', at: null, commit: null },
    ...(over.state || {}),
  };
  return {
    available: true,
    reason: null,
    branch: 'stable',
    currentCommit: SHA_OLD,
    availableCommit: SHA_OLD,
    /* WHEN THE CHECK WAS MADE. `checkForUpdate` sets this on every answer
       it returns, cached or fresh, so a payload without it is not a shape
       the server produces — and this fixture not having one is what failed
       the four assertions about the checked-at line while the code was
       right. A fixture that is missing a field the server always sends
       does not test leniency, it tests a case that cannot happen. */
    checkedAt: new Date().toISOString(),
    // Whether the fetch behind that check reached the remote. A failed one
    // is still a check and is reported as one that did not get through.
    fetched: true,
    /* AND WHETHER ANYTHING WILL ACT ON A REQUEST. The route sends this on
       every answer, so a fixture without it is again a shape the server
       cannot produce — the same mistake `checkedAt` was. Default to a
       working worker, because that is what the tests below about the button
       are about; the ones that care set it. */
    worker: { listening: true, unit: 'reportlog-update.timer', reason: null, fix: null },
    status: { state: 'idle', detail: '', at: null, commit: null },
    busy: false,
    history: [],
    ...over,
    state,
  };
}

async function openAdmin(browser, body) {
  const page = await browser.newPage();
  await page.route('**://*.google*/**', (r) => r.abort());
  await page.route('**://*.gstatic.com/**', (r) => r.abort());
  await page.route('**/api/auth/me', json(ADMIN));
  await page.route('**/api/admin/update*', json(body));
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  await page.click('#admin-subnav [data-adminsec="ops"]');
  await settle(page);
  await settle(page);
  return page;
}

export default async function run(browser) {
  const r = new Report('updates panel');

  /* ---- nothing to do ---------------------------------------------------- */
  {
    const page = await openAdmin(browser, payload());
    r.ok('the panel is on the Operations tab',
      Boolean(await page.$('#panel-updates')));
    r.ok('it says the deployment is up to date',
      (await page.$eval('#upd-state', (e) => e.textContent)).includes('Up to date'));
    r.ok('AND OFFERS NO BUTTON, because there is nothing to install',
      await page.$eval('#upd-apply', (e) => e.hidden) === true);
    r.ok('the version it reports is the one it is running',
      (await page.$eval('#upd-state', (e) => e.textContent)).includes('v0.0.3'));

    /* HOW OLD THE ANSWER IS. checkForUpdate caches for ten minutes and the
       cached value carries the time it was computed, so "Up to date" on a
       freshly opened pane can be nine minutes old — and the server had been
       sending `checkedAt` the whole time with nothing rendering it. */
    const checked = await page.$eval('#upd-checked', (e) => e.textContent);
    r.ok('and says when the deployment last asked', /Checked/.test(checked), checked);
    r.ok('relatively, because "is this stale" is the question a clock time '
      + 'does not answer without arithmetic',
      /just now|seconds ago|minutes? ago|hours? ago/.test(checked), checked);
    r.ok('with the exact time behind it for somebody who wants it',
      Boolean(await page.$eval('#upd-checked', (e) => e.title)));
    r.ok('and it is a live region, so the line changing is announced',
      await page.$eval('#upd-checked', (e) => e.getAttribute('aria-live')) === 'polite');
    await page.close();
  }

  /* ---- nothing is listening for the request ------------------------------
   *
   * THE FEATURE NOT WORKING AT ALL, and the shape of it is worth keeping.
   * The app cannot apply an update: it writes a file naming a commit and a
   * root systemd timer does the work. Without that timer the pane offered
   * the button, said "Asked for. It starts within a minute", and the
   * request sat in var/ forever — no error, nothing in a log. A box reaches
   * that state by being upgraded with deploy.sh, which installs no units,
   * across the release that added the timer.
   */
  for (const [what, worker] of [
    ['the timer is not enabled', {
      listening: false,
      unit: 'reportlog-update.timer',
      reason: 'Nothing on this deployment is watching for the request, so the button '
        + 'was never installed on this box. It is one command.',
      fix: 'sudo /srv/reportlog/contrib/install-units.sh',
    }],
    ['there is no systemd at all', {
      listening: null,
      unit: 'reportlog-update.timer',
      reason: 'This box has no systemd, so nothing can apply an update on its own. '
        + 'Update over SSH with contrib/deploy.sh.',
      fix: null,
    }],
  ]) {
    const page = await openAdmin(browser, payload({
      availableCommit: SHA_NEW,
      worker,
      state: {
        hasUpdate: true, behind: 4, currentVersion: 'v0.0.3', availableVersion: 'v0.0.4',
      },
    }));
    const text = await page.$eval('#upd-state', (e) => e.textContent);
    r.ok(`${what}: the pane says one step is missing`,
      /one step is missing/i.test(text), text.slice(0, 200));
    /* THE BUTTON STAYS. Hiding it was the first attempt and it was wrong:
       hiding a control is a polite way of saying the feature does not work,
       and leaves an operator with an empty panel and nothing to act on.
       The route refuses the request, so pressing it cannot pretend to have
       worked — but the operator can see what the panel is for. */
    r.ok(`${what}: and the button is still there`,
      await page.$eval('#upd-apply', (e) => e.hidden) === false);
    r.ok(`${what}: and it still says what version is available`,
      /v0\.0\.4/.test(text), text.slice(0, 200));
    // THE COMMAND, ON SCREEN. The point of saying a step is missing is that
    // somebody can finish it without going to look anything up.
    if (worker.fix) {
      r.ok(`${what}: and prints the command that finishes the setup`,
        /install-units\.sh/.test(text), text.slice(0, 260));
    } else {
      r.ok(`${what}: and sends them to SSH, because there is nothing to install`,
        /contrib\/deploy\.sh/.test(text), text.slice(0, 260));
    }
    await page.close();
  }

  {
    // AND WITH A WORKER, the button comes back — or the two halves above
    // would pass against a pane that never shows a button at all.
    const page = await openAdmin(browser, payload({
      availableCommit: SHA_NEW,
      worker: { listening: true, unit: 'reportlog-update.timer', reason: null, fix: null },
      state: {
        hasUpdate: true, behind: 4, currentVersion: 'v0.0.3', availableVersion: 'v0.0.4',
      },
    }));
    r.ok('a deployment whose timer IS enabled gets the button',
      await page.$eval('#upd-apply', (e) => e.hidden) === false);
    r.ok('and is not told anything about a missing step',
      !/one step is missing/i.test(await page.$eval('#upd-state', (e) => e.textContent)));
    await page.close();
  }

  {
    // Up to date and no worker: said QUIETLY. An operator should learn the
    // button is dead while setting the box up rather than in three weeks
    // with a release waiting — but a loud warning on a screen where nothing
    // is wrong is what teaches somebody to stop reading this panel.
    const page = await openAdmin(browser, payload({
      worker: {
        listening: false,
        unit: 'reportlog-update.timer',
        reason: 'The timer that applies an update was never installed on this box.',
        fix: 'sudo /srv/reportlog/contrib/install-units.sh',
      },
    }));
    const text = await page.$eval('#upd-state', (e) => e.textContent);
    r.ok('an up-to-date deployment with no worker is told, but gently',
      /Up to date/.test(text) && /one step is missing/i.test(text), text.slice(0, 220));
    r.ok('and the command is there to finish it now rather than later',
      /install-units\.sh/.test(text), text.slice(0, 260));
    /* GENTLY MEANS MUTED, not silent and not alarming: the loud copy is in
       its own paragraph and this one is in the muted class. An operator
       should be able to finish the setup while nothing is wrong, without a
       warning on a screen where nothing is wrong. */
    r.ok('and it is muted rather than shouted',
      await page.$$eval('#upd-state p.text-color-muted',
        (ps) => ps.some((p) => /one step is missing/i.test(p.textContent))));
    await page.close();
  }

  /* ---- pressing Check now ----------------------------------------------- */
  {
    /* THE BUTTON HAD TO SAY IT WAS DOING SOMETHING. A forced check runs a
       `git fetch` bounded at twenty seconds, and when the answer comes back
       unchanged the panel afterwards is byte-identical to the panel before
       — so pressing it was indistinguishable from pressing a dead button,
       for up to twenty seconds, and the slow cases are the honest ones. */
    const page = await browser.newPage();
    await page.route('**://*.google*/**', (route) => route.abort());
    await page.route('**://*.gstatic.com/**', (route) => route.abort());
    await page.route('**/api/auth/me', json(ADMIN));
    let held = null;
    await page.route('**/api/admin/update*', async (route) => {
      // The first load answers at once; the forced check is held open, which
      // is the state the reaction exists for.
      if (route.request().url().includes('refresh=1')) {
        held = route;
        return;
      }
      return json(payload())(route);
    });
    await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
    await page.click('#admin-subnav [data-adminsec="ops"]');
    await settle(page);

    await page.click('#upd-refresh');
    await settle(page);
    r.ok('pressing Check now says it is checking',
      /Checking/.test(await page.$eval('#upd-refresh', (e) => e.textContent)),
      await page.$eval('#upd-refresh', (e) => e.textContent));
    r.ok('and the button cannot be pressed again while it is',
      await page.$eval('#upd-refresh', (e) => e.disabled) === true);
    r.ok('and says so to a screen reader rather than only in its label',
      await page.$eval('#upd-refresh', (e) => e.getAttribute('aria-busy')) === 'true');

    if (held) await json(payload())(held);
    await settle(page);
    r.ok('and goes back to being a button when the answer lands',
      await page.$eval('#upd-refresh', (e) => e.disabled) === false
      && /Check now/.test(await page.$eval('#upd-refresh', (e) => e.textContent)));
    await page.close();
  }

  /* ---- a check that could not reach the remote --------------------------- */
  {
    // A failed fetch is still a check. Saying only "checked" for one would
    // claim a comparison against the remote that did not happen.
    const page = await openAdmin(browser, payload({ fetched: false }));
    const checked = await page.$eval('#upd-checked', (e) => e.textContent);
    r.ok('a check that did not reach the remote is not reported as one that did',
      /could not be reached/.test(checked), checked);
    await page.close();
  }

  /* ---- an update, within the same version -------------------------------- */
  {
    const page = await openAdmin(browser, payload({
      availableCommit: SHA_NEW,
      state: {
        hasUpdate: true,
        behind: 4,
        commits: [{ sha: 'abc1234', subject: 'A fix' }, { sha: 'def5678', subject: 'Another' }],
      },
    }));
    r.ok('four commits behind is said in commits, not in versions',
      (await page.$eval('#upd-state', (e) => e.textContent)).includes('4 commits behind'));
    r.ok('and the button appears', await page.$eval('#upd-apply', (e) => e.hidden) === false);
    r.ok('the commit list is there to open',
      await page.$eval('#upd-commits-wrap', (e) => e.hidden) === false);
    r.ok('and it lists them', (await page.$eval('#upd-commits', (e) => e.textContent)).includes('A fix'));
    await page.close();
  }

  /* ---- several releases behind ------------------------------------------- */
  {
    const page = await openAdmin(browser, payload({
      availableCommit: SHA_NEW,
      state: {
        availableVersion: 'v0.2.0',
        hasUpdate: true,
        behind: 40,
        releases: [
          { version: 'v0.2.0', date: '1 November 2026', notes: 'The **second** thing.' },
          { version: 'v0.1.0', date: '20 October 2026', notes: 'The first thing.' },
        ],
      },
    }));
    const notes = await page.$eval('#upd-releases', (e) => e.textContent);
    r.ok('EVERY release being moved through is shown, not just the newest',
      notes.includes('v0.2.0') && notes.includes('v0.1.0'));
    r.ok('each one folds open on its own',
      (await page.$$eval('#upd-releases details', (d) => d.length)) === 2);
    r.ok('the newest is open to begin with',
      await page.$eval('#upd-releases details', (e) => e.open) === true);
    // Bold survives; nothing else is rendered, because there is no markdown
    // parser here and there is not going to be one.
    r.ok('bold in the notes renders, and no raw asterisks are shown',
      (await page.$$eval('#upd-releases b', (b) => b.length)) > 0 && !notes.includes('**'));
    await page.close();
  }

  /* ---- a release nobody wrote notes for ---------------------------------- */
  {
    const page = await openAdmin(browser, payload({
      availableCommit: SHA_NEW,
      state: {
        availableVersion: 'v0.3.0', hasUpdate: true, behind: 3, undocumented: true, releases: [],
      },
    }));
    r.ok('an undocumented release SAYS SO rather than showing an empty box',
      (await page.$eval('#upd-state', (e) => e.textContent)).includes('no release'));
    await page.close();
  }

  /* ---- already running ---------------------------------------------------- */
  {
    const page = await openAdmin(browser, payload({
      availableCommit: SHA_NEW,
      busy: true,
      status: { state: 'running', detail: 'running migrations', at: null, commit: SHA_NEW },
      state: { hasUpdate: true, behind: 4 },
    }));
    r.ok('it says what the worker is doing',
      (await page.$eval('#upd-state', (e) => e.textContent)).includes('running migrations'));
    r.ok('AND THE BUTTON IS GONE while one is in flight',
      await page.$eval('#upd-apply', (e) => e.hidden) === true);
    await page.close();
  }

  /* ---- the last one failed ------------------------------------------------ */
  {
    const page = await openAdmin(browser, payload({
      status: { state: 'failed', detail: 'migrations failed', at: null, commit: SHA_NEW },
    }));
    r.ok('a failed update is reported rather than cleared by the next look',
      (await page.$eval('#upd-state', (e) => e.textContent)).includes('failed'));
    await page.close();
  }

  /* ---- not a git checkout ------------------------------------------------- */
  {
    const page = await openAdmin(browser, payload({
      available: false,
      reason: 'this deployment is not a git checkout, so it cannot self-update',
    }));
    const t = await page.$eval('#upd-state', (e) => e.textContent);
    r.ok('a deployment that cannot update says why', t.includes('not a git checkout'));
    r.ok('and points at the SSH route instead', t.includes('deploy.sh'));
    r.ok('offering no button at all', await page.$eval('#upd-apply', (e) => e.hidden) === true);
    await page.close();
  }

  /* ---- who did it before -------------------------------------------------- */
  {
    const page = await openAdmin(browser, payload({
      history: [{
        requested_email: 'moderator@example.org',
        requested_at: '2026-10-07T12:00:00Z',
        from_version: 'v0.0.2',
        target_version: 'v0.0.3',
        outcome: 'done',
        applied_at: '2026-10-07T12:01:00Z',
      }],
    }));
    const h = await page.$eval('#upd-history', (e) => e.textContent);
    r.ok('the log says who asked for the last update', h.includes('moderator@example.org'));
    r.ok('and what it moved between', h.includes('v0.0.2') && h.includes('v0.0.3'));
    await page.close();
  }

  return r;
}
