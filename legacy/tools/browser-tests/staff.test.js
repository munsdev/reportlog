/**
 * The two staff screens that draw logbook reports and logbook questions:
 * the moderator queue, and a coordinator entering accounts off paper.
 *
 * The session and the staff endpoints are answered here, as the settings
 * suite does, because a browser test cannot sign in by email. Everything
 * past the network is the real page. The server's side of both — the
 * queue's query, a batch's checks and seal — is walked for real by
 * scripts/intake-selftest.mjs and scripts/confirm-selftest.mjs.
 */
import {
  BASE, Report, open, settle, withLogbooks, FIXTURE_LOGBOOK,
} from './lib.js';

const json = (body, status = 200) => (route) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body),
});

const MODERATOR = { id: '4', email: 'mod@example.org', role: 'moderator', memberships: [] };
const COORDINATOR = {
  id: '5', email: 'coord@example.org', role: 'user',
  memberships: [{ organization_id: 7, name: 'Example Coalition', role: 'coordinator' }],
};

const ROW = {
  id: 'RL-TEST01-AAAAAA', thread_id: '11111111-1111-1111-1111-111111111111',
  received_at: '2026-11-03T10:00:00Z', recipe: 1, logbook_slug: FIXTURE_LOGBOOK.slug,
  logbook_title: FIXTURE_LOGBOOK.title,
  answers: { role: 'A voter', state: 'Ohio', when: '2026-11-03', what: ['Long lines'],
    account: 'The line went round the block.' },
  may_publish: true, severity: null, veracity: 'pending', moderation_status: 'pending',
  withdrawn: false, corroboration_count: 0, chain_hash: 'a'.repeat(64),
};

async function as(browser, who, path, routes) {
  return open(browser, `${BASE}${path}`, { width: 900, height: 1000 }, async (page) => {
    await page.route((u) => u.pathname === '/api/auth/me', json(who));
    await withLogbooks(page);
    for (const [match, handler] of routes) await page.route(match, handler);
  });
}

export default async function run(browser) {
  const r = new Report('staff screens');

  /* ---- the moderator queue -------------------------------------------- */
  {
    const page = await as(browser, MODERATOR, '/moderators', [
      [(u) => u.pathname === '/api/moderators/reports', json([ROW])],
    ]);
    await page.waitForTimeout(900);
    const text = ((await page.textContent('#mods-list')) || '').replace(/\s+/g, ' ');
    r.ok('the queue shows which logbook a report came through', text.includes(FIXTURE_LOGBOOK.title), text.slice(0, 200));
    r.ok('and each answer under the words of its question',
      /What was your role\? A voter/.test(text) && /Which state\? Ohio/.test(text), text.slice(0, 300));
    r.ok('and the written answer in full', text.includes('The line went round the block.'));
    r.ok('with the moderator’s actions', Boolean(await page.$('#mods-list [data-status="valid"]')));
    const filters = await page.$$eval('#ovl-modsfilter select, #ovl-modsfilter input', (els) => els.map((e) => e.id || e.name));
    r.ok('and no built-in date or reporter-type filter', !filters.some((f) => /reporter|from|to$/.test(f)),
      filters.join(','));
    r.ok('no uncaught errors in the queue', page.pageErrors.length === 0, page.pageErrors.join(' | '));
    await page.close();
  }

  /* ---- a coordinator's entry ------------------------------------------ */
  {
    let saved = null;
    const BATCH = { id: 9, organization_id: 7, organization: 'Example Coalition', status: 'draft' };
    const page = await as(browser, COORDINATOR, '/intake', [
      [(u) => u.pathname === '/api/intake/organizations', json(COORDINATOR.memberships)],
      [(u) => u.pathname === '/api/intake/batches', json([{ ...BATCH, created_at: '2026-11-03T10:00:00Z', entries: 1, filed: 0 }])],
      [(u) => u.pathname === '/api/intake/batches/9', json({ batch: BATCH, drafts: [{ id: 5, ordinal: 1, payload: {}, report_id: null }] })],
      [(u) => u.pathname === '/api/intake/batches/9/review', json({ batch: BATCH, entries: [], ready: 0, blocked: 1 })],
      [(u) => u.pathname === '/api/intake/drafts/5', (route) => {
        saved = JSON.parse(route.request().postData() || '{}');
        return json({ id: 5 })(route);
      }],
    ]);
    await page.waitForTimeout(900);
    await page.click('[data-batch="9"]');
    await settle(page);
    await page.click('[data-edit="5"]');
    await page.waitForTimeout(700);
    r.ok('an account starts by saying which logbook it is for',
      await page.$eval('#draft-logbook', (e) => e.value) === FIXTURE_LOGBOOK.slug);
    const labels = await page.$$eval('#draft-questions .form_label', (ls) => ls.map((l) => l.textContent));
    r.ok('and that logbook’s questions are drawn below it, in its order',
      FIXTURE_LOGBOOK.fields.every((f, i) => (labels[i] || '').startsWith(f.label)), labels.join(' | '));
    r.ok('with no old built-in fields beside them',
      !(await page.$('#draft-narr')) && !(await page.$('#draft-states')) && !(await page.$('#draft-cats')));

    await page.selectOption('#dq-role', 'A poll worker');
    await page.selectOption('#dq-state', 'Indiana');
    await page.fill('#dq-when', '2026-11-03');
    await page.check('#dq-what input[value="Late opening"]');
    await page.fill('#dq-account', 'Taken down off the paper form.');
    await page.selectOption('#draft-method', 'paper');
    await page.check('input[name="draft-publish"][value="no"]');
    await page.click('#draft-save');
    await page.waitForTimeout(600);
    r.ok('saving sends the logbook and its answers under their keys',
      saved?.logbook === FIXTURE_LOGBOOK.slug && saved?.answers?.role === 'A poll worker'
      && saved?.answers?.state === 'Indiana' && saved?.answers?.what?.[0] === 'Late opening'
      && saved?.answers?.account === 'Taken down off the paper form.', JSON.stringify(saved));
    r.ok('and what the person said about publication, on the coordinators’ wording',
      saved?.may_publish === false && /^[a-f0-9]{64}$/.test(saved?.may_publish_digest || ''),
      JSON.stringify(saved));
    r.ok('and how it was collected', saved?.intake_method === 'paper');
    r.ok('no uncaught errors entering an account', page.pageErrors.length === 0, page.pageErrors.join(' | '));
    await page.close();
  }
  return r;
}
