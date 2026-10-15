/**
 * The two permissions a reporter can take back, in My Reports.
 *
 * This is the first browser coverage My Reports has ever had, which is why
 * the toggles got it: they are the only controls in the product that change a
 * permission, and a checkbox that looks right and posts the wrong thing looks
 * exactly like a checkbox that works.
 *
 * What matters here and cannot be checked anywhere else:
 *
 * - the boxes show what the SERVER says, not what was last clicked;
 * - the answer given at filing is stated as a fact and is not a control,
 *   because it is sealed into the report and nobody can change it;
 * - taking the attachment permission back asks first when files are actually
 *   published, since it takes them down rather than flagging them;
 * - a refused write puts the box back, so the page never shows a permission
 *   the archive does not have.
 *
 * Everything is routed, so no report, no account and no database state is
 * needed. The suite mocks what the reporter's own pages read.
 */
import { BASE, Report, open } from './lib.js';

const THREAD = '11111111-2222-3333-4444-555555555555';

const json = (body, status = 200) => (route) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body),
});

/** One report of the reporter's own, with whatever permission state we want. */
const reportRow = (over = {}) => ({
  id: 'RL-260929-000001',
  received_at: '2026-09-29T09:00:00.000Z',
  recipe: 1,
  answers: { what: 'Something happened' },
  thread_id: THREAD,
  chain_hash: 'a'.repeat(64),
  may_publish: true,
  withdrawn: false,
  moderation_status: 'pending',
  logbook_slug: 'browser-fixture',
  logbook_title: 'Polling place incidents',
  erasable: true,
  attachment_count: 0,
  attachment_published_count: 0,
  permissions: { contact_passing: false, attachment_publication: false },
  ...over,
});

/**
 * My Reports, signed in, with one report on it. `posted` collects every
 * permission write the page makes; `answer` is what the server says back.
 */
async function myReports(browser, row, posted, answer) {
  return open(browser, `${BASE}/my-reports`, { width: 900, height: 1200 }, async (p) => {
    await p.route((u) => u.pathname === '/api/auth/me',
      json({ email: 'reporter@example.org', role: null }));
    await p.route((u) => u.pathname === '/api/me/reports', json([row]));
    await p.route((u) => u.pathname === '/api/me/access-log', json([]));
    await p.route((u) => u.pathname === `/api/logbooks/${row.logbook_slug}`,
      json({ slug: row.logbook_slug, title: row.logbook_title, fields: [] }));
    await p.route((u) => /\/api\/me\/reports\/.+\/permissions$/.test(u.pathname), (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const body = JSON.parse(route.request().postData() || '{}');
      posted.push(body);
      if (answer && answer.fail) {
        return json({ error: 'That did not work' }, 409)(route);
      }
      const permissions = { ...row.permissions, [body.permission]: body.granted };
      return json({ ok: true, permissions, filesWithdrawn: (answer && answer.filesWithdrawn) || 0 })(route);
    });
  });
}

export default async function run(browser) {
  const r = new Report('a reporter’s own permissions');

  /* ---- they are drawn, and they are drawn from the server ------------- */
  {
    const posted = [];
    const page = await myReports(browser, reportRow({
      permissions: { contact_passing: true, attachment_publication: false },
    }), posted);
    await page.waitForTimeout(400);

    const box = async (key) => page.$eval(`[data-perm="${key}"]`, (e) => e.checked)
      .catch(() => null);
    r.ok('both permissions appear on the reporter’s own card',
      await box('contact_passing') !== null && await box('attachment_publication') !== null);
    r.ok('and each shows what the server says, not a default',
      await box('contact_passing') === true && await box('attachment_publication') === false);

    // The sealed answer must never look like something that can be changed.
    const sealed = await page.$$eval('.perms .form_help', (els) => els.map((e) => e.textContent).join(' '));
    r.ok('the answer given at filing is stated as a fact',
      /sealed into the record/.test(sealed));
    r.ok('and is not offered as a control',
      !(await page.$('[data-perm="may_publish"]')));
    await page.close();
  }

  /* ---- ticking one writes exactly one permission ---------------------- */
  {
    const posted = [];
    const page = await myReports(browser, reportRow(), posted);
    await page.waitForTimeout(400);
    await page.click('[data-perm="contact_passing"]');
    await page.waitForTimeout(500);

    r.ok('ticking a box writes once', posted.length === 1);
    r.ok('and names the permission and the value it is setting',
      posted[0] && posted[0].permission === 'contact_passing' && posted[0].granted === true);
    r.ok('and does not touch the other permission',
      !posted.some((b) => b.permission === 'attachment_publication'));
    r.ok('the box ends up reflecting the server’s answer',
      await page.$eval('[data-perm="contact_passing"]', (e) => e.checked) === true);
    await page.close();
  }

  /* ---- a refused write does not leave a lie on screen ----------------- */
  {
    const posted = [];
    const page = await myReports(browser, reportRow(), posted, { fail: true });
    await page.waitForTimeout(400);
    await page.click('[data-perm="contact_passing"]');
    await page.waitForTimeout(500);

    r.ok('a write the server refuses puts the box back',
      await page.$eval('[data-perm="contact_passing"]', (e) => e.checked) === false);
    r.ok('and says so rather than failing silently',
      /did not work/i.test(await page.$eval(`#perm-status-${THREAD}`, (e) => e.textContent)));
    await page.close();
  }

  /* ---- taking published files down asks first ------------------------- */
  {
    const posted = [];
    const page = await myReports(browser, reportRow({
      attachment_count: 2,
      attachment_published_count: 2,
      permissions: { contact_passing: false, attachment_publication: true },
    }), posted);
    await page.waitForTimeout(400);

    // Dismissed: nothing is written and the box goes back to on.
    page.once('dialog', (d) => d.dismiss());
    await page.click('[data-perm="attachment_publication"]');
    await page.waitForTimeout(400);
    r.ok('switching the attachment permission off asks before taking files down',
      posted.length === 0);
    r.ok('and leaves the permission alone when the answer is no',
      await page.$eval('[data-perm="attachment_publication"]', (e) => e.checked) === true);

    // Accepted: it writes, and says how many files went down.
    page.once('dialog', (d) => d.accept());
    await page.click('[data-perm="attachment_publication"]');
    await page.waitForTimeout(500);
    r.ok('and writes the revocation when the answer is yes',
      posted.length === 1 && posted[0].granted === false
      && posted[0].permission === 'attachment_publication');
    await page.close();
  }

  /* ---- nothing here appears on anybody else's view of a report -------- */
  {
    const page = await open(browser, `${BASE}/board`, { width: 900, height: 900 });
    await page.waitForTimeout(600);
    r.ok('the public board offers no permission control',
      !(await page.$('[data-perm]')));
    await page.close();
  }

  return r;
}
