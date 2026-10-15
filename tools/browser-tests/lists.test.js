/**
 * Lists on screen: the form a visitor fills in, the front-page buttons, the
 * admin tab's first question, and the moderators' bulk review.
 *
 * The rules are proved where they live — scripts/selftest.js for the pure
 * ones, scripts/lists-selftest.mjs and lists-routes-selftest.mjs against a
 * real database and app. What is only true on screen is here, and most of it
 * is about what the page does NOT do:
 *
 *   - it does not ask for an address from somebody who wrote nothing
 *   - it does not send one it was not given
 *   - it does not lead an administrator to a list by default
 *   - it does not approve entries that were not on screen
 *
 * The API is intercepted; everything past the network is the real page.
 */
import { BASE, Report, open, settle } from './lib.js';

const json = (body, status = 200) => (route) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body),
});

const ADMIN = { id: '1', email: 'admin@example.org', role: 'admin', is_tester: false, memberships: [] };

const TIPS = {
  slug: 'tips', title: 'Send a link', blurb: 'Links to posts about what happened.',
  accepting: true, asksEmail: true, emailWhen: 'if-written', emailReason: 'erase', personalKeys: ['description'], personalDays: 90,
  fields: [
    { key: 'links', kind: 'url', label: 'Link', help: null, required: true, maxValues: 3, options: [], allowOther: false, erased: false },
    { key: 'state', kind: 'choice_one', label: 'Where', help: null, required: true, maxValues: 1, options: ['Ohio', 'Texas'], allowOther: false, erased: false },
    { key: 'description', kind: 'long_text', label: 'Anything we should know', help: null, required: false, maxValues: 1, options: [], allowOther: false, erased: true },
  ],
};

async function openForm(browser, posted) {
  return open(browser, `${BASE}/list/tips`, undefined, async (page) => {
    await page.route('**/api/lists/tips', json(TIPS));
    await page.route('**/api/lists/tips/entries', (route) => {
      posted.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({ status: 201, contentType: 'application/json',
        body: JSON.stringify({ ok: true, erasable: posted.at(-1).answers.description !== undefined, erasureMailed: true }) });
    });
  });
}

const onCard = (page) => page.$eval('#lf-cards .card.on', (e) => e.getAttribute('data-card'));
const next = async (page) => { await page.click('#lf-next'); await settle(page); };

export default async function run(browser) {
  const r = new Report('lists');

  /* ---- the front page offers what is listed and open ---------------------
   *
   * THE LISTS NO LONGER HAVE A CONTAINER OF THEIR OWN. They used to be
   * drawn into `#home-lists` by list-form.js, while logbooks sat behind a
   * generic "Submit a Report" — so a list had a front-page button and a
   * logbook did not. Both are now one ordered list from one endpoint, and
   * what this still has to prove is unchanged: a list that is listed and
   * open gets a button, and it is a real link somebody can share. */
  {
    const page = await open(browser, `${BASE}/`, undefined, async (p) => {
      await p.route('**/api/home/buttons', json({
        buttons: [{
          kind: 'list', ref: 'tips', label: 'Send a link', href: '/list/tips', accent: true,
        }],
      }));
    });
    r.ok('the front page has a button for an open listed list',
      (await page.$$eval('#home-buttons [data-list-open]', (a) => a.map((x) => x.textContent))).includes('Send a link'));
    r.ok('and it is a real link somebody can share',
      await page.$eval('#home-buttons a', (a) => a.getAttribute('href')) === '/list/tips');
    await page.close();
  }

  /* ---- somebody who sends a link and writes nothing ----------------------- */
  {
    const posted = [];
    const page = await openForm(browser, posted);
    r.ok('the form opens on a card that says nothing sent is published',
      (await onCard(page)) === 'intro-list'
      && /Nothing you send here is published/.test(await page.$eval('#lf-cards .card.on', (e) => e.textContent)));
    await next(page);
    r.ok('one question per card: the link first', (await onCard(page)) === 'lf-links');
    await next(page);
    r.ok('a required question cannot be skipped',
      (await onCard(page)) === 'lf-links' && /answer is needed/.test(await page.textContent('#lf-err')));
    await page.fill('#lf-cards .card.on input[type=url]', 'https://example.org/a');
    await next(page);
    await page.click('#lf-cards .card.on .picktile:has(b:text-is("Texas"))');
    await settle(page);
    r.ok('choosing an answer does not move the card on by itself', (await onCard(page)) === 'lf-state');
    await next(page);
    await next(page); // the optional description, left empty
    r.ok('the address card says it is not needed when nothing was written',
      (await onCard(page)) === 'lf-email'
      && /Not needed/.test(await page.textContent('#lf-email-why')));
    await page.waitForTimeout(2600);
    await next(page);
    r.ok('and it sends without one', posted.length === 1 && posted[0].email === null, JSON.stringify(posted));
    r.ok('carrying only what was answered',
      JSON.stringify(posted[0].answers) === JSON.stringify({ links: ['https://example.org/a'], state: 'Texas' }),
      JSON.stringify(posted[0].answers));
    r.ok('the thank-you shows', await page.$eval('#lf-done', (e) => !e.hidden));
    r.ok('and no page errors', page.pageErrors.length === 0, page.pageErrors.join(' | '));
    await page.close();
  }

  /* ---- somebody who writes something -------------------------------------- */
  {
    const posted = [];
    const page = await openForm(browser, posted);
    await next(page);
    await page.fill('#lf-cards .card.on input[type=url]', 'https://example.org/b');
    await next(page);
    await page.click('#lf-cards .card.on .picktile:has(b:text-is("Ohio"))');
    await next(page);
    r.ok('the free-text card says it is deleted on the timer',
      /Deleted after 90 days/.test(await page.$eval('#lf-cards .card.on', (e) => e.textContent)));
    await page.fill('#lf-cards .card.on textarea', 'Posted outside the office.');
    await next(page);
    r.ok('now the address card says it is needed, and why',
      /Needed, because you wrote something/.test(await page.textContent('#lf-email-why')));
    await next(page);
    r.ok('and refuses to send without one',
      posted.length === 0 && /we need an email address/.test(await page.textContent('#lf-err')));
    await page.fill('#lf-email', 'someone@example.org');
    await page.waitForTimeout(2600);
    await next(page);
    r.ok('with one it sends', posted.length === 1 && posted[0].email === 'someone@example.org', JSON.stringify(posted));
    r.ok('and says the deletion link was emailed',
      /emailed you a link that deletes/.test(await page.textContent('#lf-done')));
    await page.close();
  }

  /* ---- a form people use to reach the site: always asks, and says why ---- */
  {
    const VOL = {
      slug: 'volunteer', title: 'Volunteer', blurb: null, accepting: true,
      asksEmail: true, emailWhen: 'always', emailReason: 'reply', personalKeys: ['name'], personalDays: 90,
      fields: [
        { key: 'name', kind: 'short_text', label: 'Your name', help: null, required: true, maxValues: 1, options: [], allowOther: false, erased: true },
        { key: 'roles', kind: 'choice_many', label: 'How would you like to help?', help: null, required: true, maxValues: 1, options: ['Testing', 'Outreach'], allowOther: false, erased: false },
      ],
    };
    const posted = [];
    const page = await open(browser, `${BASE}/list/volunteer`, undefined, async (p) => {
      await p.route('**/api/lists/volunteer', json(VOL));
      await p.route('**/api/lists/volunteer/entries', (route) => {
        posted.push(JSON.parse(route.request().postData() || '{}'));
        return route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true,"erasable":true,"erasureMailed":true}' });
      });
    });
    const intro = await page.$eval('#lf-cards .card.on', (e) => e.textContent);
    r.ok('the first card says the address is so the site can reply — not "if you write anything"',
      /so whoever runs this site can reply/.test(intro) && !/If you write anything/i.test(intro), intro.slice(0, 200));
    await next(page);
    await page.fill('#lf-cards .card.on input', 'Sam');
    await next(page);
    await page.click('#lf-cards .card.on .choice_item');
    await next(page);
    const why = await page.textContent('#lf-email-why');
    r.ok('the address card gives the same reason, and never "because you wrote something"',
      /can reply/.test(why) && !/because you wrote/.test(why), why);
    r.ok('and has no "you may write back" box, because sending it is asking for a reply',
      !(await page.$('#lf-consent')));
    await next(page);
    r.ok('leaving it empty is refused plainly', /This form needs your email address/.test(await page.textContent('#lf-err')));
    await page.fill('#lf-email', 'sam@example.org');
    await page.waitForTimeout(2600);
    await next(page);
    r.ok('with an address it sends, as a request for a reply',
      posted.length === 1 && posted[0].email === 'sam@example.org' && posted[0].email_consent === true, JSON.stringify(posted));
    r.ok('and no page errors', page.pageErrors.length === 0, page.pageErrors.join(' | '));
    await page.close();
  }

  /* ---- a list that is not there, or not open ----------------------------- */
  {
    const page = await open(browser, `${BASE}/list/nope`, undefined, async (p) => {
      await p.route('**/api/lists/nope', json({ error: 'No such list' }, 404));
    });
    r.ok('an address with no list says so, without a form',
      /no form at this address/.test(await page.textContent('#lf-closed'))
      && await page.$eval('#lf-form', (e) => e.hidden));
    await page.close();
  }

  /* ---- the admin tab asks the container question first ------------------- */
  {
    const page = await open(browser, `${BASE}/admin`, undefined, async (p) => {
      await p.route('**/api/auth/me', json(ADMIN));
      await p.route('**/api/admin/lists', json({
        lists: [], kinds: [{ id: 'url', label: 'Web address' }], personalDays: 90,
        templates: [{ slug: 'tips', title: 'Send a link', blurb: 'Links.', requiresEmail: true, questions: ['Link'] }],
      }));
    });
    await page.click('#admin-subnav [data-adminsec="lists"]');
    await settle(page);
    r.ok('the Lists tab is there', await page.$eval('#panel-lists', (e) => !e.hidden));
    await page.click('#ls-new');
    await settle(page);
    r.ok('making a list first asks whether it must be permanent, and offers nothing else yet',
      await page.$eval('#ls-create-list', (e) => e.hidden) && await page.$eval('#ls-to-logbooks', (e) => e.hidden));
    await page.click('label[for="ls-format-logbook"]');
    await settle(page);
    r.ok('answering "yes" points at logbooks, not at a list',
      await page.$eval('#ls-to-logbooks', (e) => !e.hidden) && await page.$eval('#ls-create-list', (e) => e.hidden));
    await page.click('label[for="ls-format-list"]');
    await settle(page);
    r.ok('answering "no" offers the starting points',
      await page.$eval('#ls-create-list', (e) => !e.hidden)
      && (await page.$$('#ls-templates .picktile')).length === 1);
    r.ok('and no page errors', page.pageErrors.length === 0, page.pageErrors.join(' | '));
    await page.close();
  }

  /* ---- bulk review sends what was on screen ------------------------------ */
  {
    const reviewed = [];
    const page = await open(browser, `${BASE}/moderators`, undefined, async (p) => {
      await p.route('**/api/auth/me', json({ ...ADMIN, role: 'moderator' }));
      await p.route('**/api/moderators/**', json([]));
      await p.route('**/api/list-review', json([{ id: 7, slug: 'tips', title: 'Send a link', waiting: 2, oldest: null }]));
      await p.route(/\/api\/list-review\/7\?/, json({
        list: { id: 7, slug: 'tips', title: 'Send a link' },
        fields: [{ key: 'links', label: 'Link', kind: 'url' }, { key: 'state', label: 'Where', kind: 'choice_one' }],
        state: 'received',
        entries: [
          { id: 11, createdAt: '2026-10-10T10:00:00Z', reviewState: 'received', answers: { state: 'Ohio' }, erasableAnswers: null,
            links: [{ host: 'example.org', urlRaw: 'https://example.org/a', knownHost: false }], erased: false },
          { id: 12, createdAt: '2026-10-10T10:00:30Z', reviewState: 'received', answers: { state: 'Ohio' }, erasableAnswers: null,
            links: [{ host: 'example.org', urlRaw: 'https://example.org/b', knownHost: true }], erased: false },
        ],
        clusters: { repeatedSubmitters: 1, largestRepeatedSubmitter: 2, entriesFromRepeatedSubmitters: [11, 12], busiestMinutes: [] },
      }));
      await p.route('**/api/list-review/7/review', (route) => {
        reviewed.push(JSON.parse(route.request().postData()));
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"changed":2}' });
      });
    });
    await page.waitForTimeout(600);
    r.ok('the list entries panel shows on the Moderators page', await page.$eval('#lr-panel', (e) => !e.hidden));
    r.ok('an unfamiliar site is marked', (await page.$$('#lr-entries .lr-unknown')).length === 1);
    r.ok('entries from one source are called out',
      /came from 1 source sending more than once/.test(await page.textContent('#lr-clusters')));
    await page.click('#lr-approve');
    await settle(page);
    r.ok('approving with nothing ticked sends nothing', reviewed.length === 0);
    await page.click('#lr-all');
    await page.click('#lr-approve');
    await settle(page);
    r.ok('approving sends exactly the ids on screen',
      reviewed.length === 1 && JSON.stringify(reviewed[0]) === JSON.stringify({ state: 'approved', ids: [11, 12] }),
      JSON.stringify(reviewed));
    await page.close();
  }

  /* ---- with the site password on ---------------------------------------- */
  const LOCKED = { locked: true, devMode: false, devModeUntil: null, version: 'MK test' };
  const lockedState = (page) => page.evaluate(() => ({
    locked: document.getElementById('site-lock').classList.contains('on'),
    pane: (document.querySelector('.pane.active') || {}).id || null,
  }));
  {
    const page = await open(browser, `${BASE}/`, undefined, async (p) => {
      await p.route('**/api/site-access/status', json(LOCKED));
      await p.route('**/api/doors', json([
        { kind: 'list', slug: 'volunteer', title: 'Volunteer', href: '/list/volunteer' },
        { kind: 'logbook', slug: 'open-lb', title: 'Report a problem', href: '/file/open-lb' },
      ]));
    });
    const st = await lockedState(page);
    r.ok('locked, the password page shows and nothing behind it', st.locked && st.pane === null, JSON.stringify(st));
    const links = await page.$$eval('#site-lock-doors a', (a) => a.map((x) => [x.textContent, x.getAttribute('href')]));
    r.ok('and it links what an administrator opened without the password',
      JSON.stringify(links) === JSON.stringify([['Volunteer', '/list/volunteer'], ['Report a problem', '/file/open-lb']]),
      JSON.stringify(links));
    await page.close();
  }
  {
    const page = await open(browser, `${BASE}/list/tips`, undefined, async (p) => {
      await p.route('**/api/site-access/status', json(LOCKED));
      await p.route('**/api/lists/tips', json(TIPS));
    });
    const st = await lockedState(page);
    r.ok('a list opened without the password shows its form while locked',
      !st.locked && st.pane === 'pane-list' && await page.$eval('#lf-form', (e) => !e.hidden), JSON.stringify(st));
    r.ok('and no page errors', page.pageErrors.length === 0, page.pageErrors.join(' | '));
    await page.close();
  }
  {
    const page = await open(browser, `${BASE}/list/secret`, undefined, async (p) => {
      await p.route('**/api/site-access/status', json(LOCKED));
      await p.route('**/api/lists/secret', json({ error: 'Site access required', locked: true }, 401));
    });
    const st = await lockedState(page);
    r.ok('a list NOT opened puts the password back, showing nothing', st.locked && st.pane === null, JSON.stringify(st));
    await page.close();
  }
  {
    const lb = {
      slug: 'open-lb', title: 'Report a problem', blurb: null, state: 'open', accepting: true, acceptsFiles: false,
      fields: [{ key: 'what', kind: 'short_text', label: 'What happened', help: null, required: true, settings: {} }],
      filters: [],
    };
    let askedForAll = false;
    const page = await open(browser, `${BASE}/file/open-lb`, undefined, async (p) => {
      await p.route('**/api/site-access/status', json(LOCKED));
      await p.route('**/api/logbooks/open-lb', json(lb));
      await p.route(/\/api\/logbooks$/, (route) => { askedForAll = true; return route.fulfill({ status: 401, contentType: 'application/json', body: '{"locked":true}' }); });
    });
    await page.waitForTimeout(600);
    const st = await lockedState(page);
    r.ok('a logbook opened without the password shows its filing form while locked',
      !st.locked && st.pane === 'pane-submit', JSON.stringify(st));
    r.ok('and it never asks for the list of logbooks, which would name the others', !askedForAll);
    r.ok('and no page errors', page.pageErrors.length === 0, page.pageErrors.join(' | '));
    await page.close();
  }

  /* ---- Insert a number ------------------------------------------------- */
  {
    const page = await open(browser, `${BASE}/`, undefined, async (p) => {
      await p.route('**/api/auth/me', json(ADMIN));
      await p.route('**/api/admin/copy', json({ slots: [{ key: 'home_intro', kind: 'block', label: 'Front page', help: '', page: 'home', body: 'In the last week ', written: true }] }));
      await p.route('**/api/admin/figures', json({ figures: [
        { id: 'reports.filed.7d', group: 'Reports', label: 'Reports filed in the last 7 days', value: 12 },
      ] }));
    });
    await page.click('#fab-edit');
    await page.waitForTimeout(400);
    await page.click('[data-copy="home_intro"] + .copy-pen, .copy-pen[data-copy-for="home_intro"], [data-copy-edit="home_intro"]').catch(() => {});
    // Open the dialog directly if the pen's markup differs: what is under
    // test is the menu inside it.
    await page.evaluate(() => document.getElementById('ovl-edit').classList.add('on'));
    await page.fill('#edit-body', 'In the last week ');
    await page.click('#edit-fig-toggle');
    await page.waitForTimeout(400);
    r.ok('the menu offers the numbers the server has',
      (await page.$$eval('#edit-fig-pick option', (o) => o.map((x) => x.value))).includes('reports.filed.7d'));
    r.ok('and shows what the number is right now', /12/.test(await page.textContent('#edit-fig-now')));
    await page.click('#edit-fig-insert');
    r.ok('inserting puts a placeholder at the cursor, not today\'s number',
      (await page.inputValue('#edit-body')) === 'In the last week {{ [reports.filed.7d] }}',
      await page.inputValue('#edit-body'));
    r.ok('and no page errors', page.pageErrors.length === 0, page.pageErrors.join(' | '));
    await page.close();
  }

  return r;
}
