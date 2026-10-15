/**
 * The first-run setup wizard, in a browser.
 *
 * The server side of setup is checked against a real database by
 * scripts/setup-selftest.mjs. What cannot be checked there is the part that
 * only exists on screen: that it is one question per screen, that choosing
 * an answer does not move the page underneath the person choosing, and that
 * the curtain-password decision has no default and cannot be skipped.
 *
 * The wizard only appears on a deployment with no owner, and the app under
 * test has one. So the two setup calls are answered here instead of by the
 * server. That is the right seam: everything below the intercept is the
 * real page, the real markup and the real script.
 */
import { BASE, Report, open, settle } from './lib.js';

// Stand in for a deployment that has been installed and not yet handed over.
async function stubSetup(page, {
  needed = true, hasAdmin = false, minPassword = 8, storageConfigured = true,
} = {}) {
  await page.route('**/api/setup/status', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ needed, hasAdmin, minPassword }),
  }));
  await page.route('**/api/setup/request-code', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, emailed: true }),
  }));
  await page.route('**/api/setup/verify-code', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, role: 'admin' }),
  }));

  // Screens three to five read and write the ordinary admin settings
  // routes, because by then the operator holds an administrator's session.
  // Answered here so the wizard can be walked; the page below is real.
  await page.route('**/api/admin/identity', (route) => (route.request().method() === 'POST'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    : route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ siteName: 'ReportLog', isDefault: true, stored: null, software: 'ReportLog', maxLength: 60 }),
    })));
  await page.route('**/api/admin/publication', (route) => (route.request().method() === 'POST'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    : route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ publicArchive: true, distribution: false, distributionImplemented: false }),
    })));
  await page.route('**/api/admin/templates', (route) => (route.request().method() === 'POST'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"applied":"workplace"}' })
    : route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        applied: null,
        appliedAt: null,
        templates: [
          { id: 'elections', label: 'Election incidents', description: 'What this was built for.',
            sets: ['Publishes an archive', 'Accepts file attachments'] },
          { id: 'workplace', label: 'Workplace or safety incidents', description: 'Inside one organisation.',
            sets: ['Publishes nothing', 'Replaces the category list with 9 of its own'] },
        ],
      }),
    })));
  await page.route('**/api/admin/look', (route) => (route.request().method() === 'POST'
    ? route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, look: { palette: 'bureau', theme: 'docket', layout: 'wide' } }),
    })
    : route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({"look": {"palette": "flint", "theme": "signal", "layout": "sheet"}, "palettes": [{"id": "flint", "label": "Flint", "description": "The shipped look: cool grey paper, gold for the action.", "dark": false}, {"id": "paper", "label": "Paper", "description": "Warm off-white, the colour of a printed document.", "dark": false}, {"id": "bureau", "label": "Bureau", "description": "Cool official grey-blue, the colour of a form.", "dark": false}], "themes": [{"id": "signal", "label": "Signal", "description": "The shipped type: Archivo headings, Public Sans text, soft corners and a raised edge."}, {"id": "plain", "label": "Plain", "description": "The same type with nothing raised off the page. Quieter."}, {"id": "docket", "label": "Docket", "description": "A typewritten record. One monospace family throughout, square corners, no shadow."}, {"id": "broadsheet", "label": "Broadsheet", "description": "Heavier headings, tighter set, hard edges."}], "layouts": [{"id": "sheet", "label": "Sheet", "description": "The shipped width. Comfortable for reading on a phone or a laptop."}, {"id": "folio", "label": "Folio", "description": "A little wider, for a board with more on it."}, {"id": "wide", "label": "Wide", "description": "As wide as the screen allows."}]}),
    })));
  await page.route('**/api/admin/attachments', (route) => (route.request().method() === 'POST'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    : route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ enabled: true, kinds: [], allKinds: [], storageConfigured }),
    })));
}

const visible = (page, sel) => page.$eval(sel, (e) => e.classList.contains('on'));
const shown = (page, sel) => page.$eval(sel, (e) => e.offsetParent !== null);

export default async function run(browser) {
  const r = new Report('first-run setup');

  /* ---- it appears, and only where it should ------------------------- */
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**://*.google*/**', (x) => x.abort());
    await page.route('**://*.gstatic.com/**', (x) => x.abort());
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await stubSetup(page);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);

    r.ok('a deployment with no owner opens the wizard', await visible(page, '#setup'));

    // Walked rather than counted: every screen the markup carries must be
    // reachable in order. The step list used to be written out by hand in
    // the script as well as in the markup, the two disagreed after a screen
    // was inserted, and the only symptom was the wizard skipping a
    // question — which no assertion about any single screen would catch.
    const stepIds = await page.$$eval('#setup .step', (els) => els.map((e) => e.id));
    r.ok('the screens are numbered in order with no gaps',
      stepIds.every((id, i) => id === `setup-s${i + 1}`), JSON.stringify(stepIds));

    // ONE progress line for the whole wizard, counted from how many screens
    // there ARE. Three per-screen counters said "of 3" after the wizard
    // grew to six — the steps worked, the tests passed, and the first
    // screen told the operator a number that was a lie.
    const total = stepIds.length;
    r.ok('the progress line counts the real number of screens',
      (await page.textContent('#setup-progress')) === `Step 1 of ${total}`,
      await page.textContent('#setup-progress'));
    r.ok('and there is exactly one of them, not one per screen',
      (await page.$$('#setup .stepno')).length === 1);
    r.ok('Back is not offered while the account is still being minted',
      await page.$eval('#setup-back', (e) => e.hidden));
    r.ok('and starts on the first question', await visible(page, '#setup-s1'));
    r.ok('showing exactly one question',
      (await page.$$eval('#setup .step.on', (e) => e.length)) === 1);

    /* ---- one question per screen ------------------------------------ */
    await page.fill('#setup-email', '');
    await page.click('#setup-s1-go');
    await settle(page);
    r.ok('an empty address does not advance the wizard', await visible(page, '#setup-s1'));
    r.ok('and says so', await visible(page, '#setup-s1-err'));

    await page.fill('#setup-email', 'owner@example.org');
    await page.click('#setup-s1-go');
    await page.waitForTimeout(400);
    r.ok('a real address moves to the code', await visible(page, '#setup-s2'));
    r.ok('and the first question is gone rather than stacked', !(await visible(page, '#setup-s1')));

    await page.fill('#setup-code', '123456');
    await page.click('#setup-s2-go');
    await page.waitForTimeout(600);

    /* ---- the questions a setup should ask ---------------------------- */
    // It used to be three screens, two of which were "prove your email",
    // so it read as a sign-in rather than a setup. Every setting below
    // already existed and the wizard asked about none of them.
    // THE NAME COMES FIRST OF THE REAL QUESTIONS, and it is required. It used
    // to be the fourth screen saying "leave blank to use ReportLog", so doing
    // nothing was the easiest answer and a deployment went live named after the
    // software.
    r.ok('the code moves on to the name', await visible(page, '#setup-s3'));
    r.ok('and the name field is there to answer it', await shown(page, '#setup-name'));

    await page.click('#setup-s3-go');
    await page.waitForTimeout(400);
    r.ok('a blank name is refused rather than meaning the default',
      (await visible(page, '#setup-s3'))
      && /name/i.test((await page.textContent('#setup-s3-err')) || ''),
      (await page.textContent('#setup-s3-err')) || '(no error shown)');

    await page.fill('#setup-name', 'Munich Incident Archive');
    await page.click('#setup-s3-go');
    await page.waitForTimeout(600);
    r.ok('naming it moves on to the starting point', await visible(page, '#setup-s4'));
    r.ok('and the name screen is gone rather than stacked', !(await visible(page, '#setup-s3')));

    // A bundle that applies invisibly is a bundle nobody can agree to, so
    // every template says what it will change before it is chosen.
    const tplOpts = await page.$$eval('#setup-template-choices input', (els) => els.map((e) => e.value));
    r.ok('the templates on offer come from the server', tplOpts.includes('workplace'), JSON.stringify(tplOpts));
    const tplText = ((await page.textContent('#setup-template-choices')) || '').replace(/\s+/g, ' ');
    r.ok('and each one lists what applying it would change',
      /Replaces the category list/.test(tplText), tplText.slice(0, 200));
    // AND NONE OF THEM CLEARS THE NAME any more. The name is answered on the
    // screen before this one, so a starting point that cleared it would wipe
    // what somebody just typed.
    r.ok('and none offers to clear the name, which was just answered',
      !/Clears the name/.test(tplText), tplText.slice(0, 300));
    r.ok('none is preselected, so a starting point is a choice',
      (await page.$$eval('#setup-template-choices input', (els) => els.filter((e) => e.checked).length)) === 0);
    r.ok('and skipping is offered as a real answer', await shown(page, '#setup-s4-skip'));

    await page.check('#setup-tpl-workplace');
    await page.click('#setup-s4-go');
    await page.waitForTimeout(600);
    r.ok('applying one moves on to whether it publishes', await visible(page, '#setup-s5'));
    r.ok('and the name it was given survived the starting point',
      (await page.$eval('#setup-name', (e) => e.value)) === 'Munich Incident Archive',
      await page.$eval('#setup-name', (e) => e.value));

    // Preselected at what the software would do anyway, and the screen
    // says which that is. Unlike the password decision, where offering no
    // default is the entire point.
    r.ok('publishing arrives set to what this deployment already does',
      await page.$eval('#setup-pub-yes', (e) => e.checked));
    r.ok('and says which answer is the default',
      /if nobody chooses/i.test((await page.textContent('#setup-pub-yes-l')) || ''));

    await page.check('#setup-pub-no');
    await settle(page);
    r.ok('choosing does not advance the publishing screen', await visible(page, '#setup-s5'));

    await page.click('#setup-s5-go');
    await page.waitForTimeout(400);
    r.ok('publishing moves on to attachments', await visible(page, '#setup-s6'));
    r.ok('attachments arrive set to what this deployment already does',
      await page.$eval('#setup-att-yes', (e) => e.checked));
    r.ok('and nothing warns about storage when storage is configured',
      !(await shown(page, '#setup-att-nostorage')));

    await page.click('#setup-s6-go');
    await page.waitForTimeout(600);

    /* ---- the look, late and with a preview --------------------------- */
    // Late on purpose: by this screen the site has a name, so the preview
    // shows theirs rather than ours.
    r.ok('attachments move on to the look', await visible(page, '#setup-s7'));
    r.ok('the two dials are drawn from what the server offers',
      (await page.$$eval('#setup-palette option', (e) => e.length)) > 1
      && (await page.$$eval('#setup-theme option', (e) => e.length)) > 1);
    r.ok('and the wizard asks nothing about width',
      (await page.$$('#setup-layout')).length === 0);
    r.ok('and the preview carries the name that was just typed',
      ((await page.textContent('#setup-look-preview')) || '').includes('Munich'));

    // THE FRAMES ONLY, the same rule as the admin panel. Asserted on the
    // colour rather than the attribute: a frame carrying data-palette and
    // painting the page's colours is what the attribute version of this
    // check could not tell apart.
    await page.selectOption('#setup-palette', 'bureau');
    await settle(page);
    const frame = await page.$eval('#setup-look-preview .lp-page', (e) => ({
      palette: e.getAttribute('data-palette'),
      background: getComputedStyle(e).backgroundColor,
    }));
    r.ok('turning a dial repaints the preview frames',
      frame.palette === 'bureau' && frame.background === 'rgb(243, 245, 248)',
      JSON.stringify(frame));
    r.ok('and leaves the page behind them alone until the button',
      (await page.getAttribute('html', 'data-palette')) === null);
    r.ok('and does not advance the screen', await visible(page, '#setup-s7'));

    await page.click('#setup-s7-go');
    await page.waitForTimeout(400);
    r.ok('the button is what puts the look on the site',
      (await page.getAttribute('html', 'data-palette')) === 'bureau');
    r.ok('the look moves on to the password decision', await visible(page, '#setup-s8'));

    /* ---- the decision has no default -------------------------------- */
    const checked = await page.$$eval('input[name="setup-curtain"]', (els) => els.filter((e) => e.checked).length);
    r.ok('neither choice is preselected', checked === 0);
    r.ok('and no password field is showing yet', !(await shown(page, '#setup-pw-wrap')));

    await page.click('#setup-s8-go');
    await settle(page);
    r.ok('finishing without choosing is refused', await visible(page, '#setup-s8-err'));
    r.ok('and the wizard has not closed', await visible(page, '#setup'));

    /* ---- choosing does not move the page ---------------------------- */
    await page.check('#setup-change');
    await settle(page);
    r.ok('choosing does not advance the screen', await visible(page, '#setup-s8'));
    r.ok('and reveals the field that choice needs', await shown(page, '#setup-pw-wrap'));

    await page.check('#setup-keep');
    await settle(page);
    r.ok('choosing the other way hides it again', !(await shown(page, '#setup-pw-wrap')));
    r.ok('and still does not advance the screen', await visible(page, '#setup-s8'));

    /* ---- the rule is stated before anybody types --------------------- */
    await page.check('#setup-change');
    await settle(page);
    const rule = (await page.textContent('#setup-pw-rule')) || '';
    r.ok('the eight-character rule is on the screen, not only in the error',
      /\b8\b/.test(rule), JSON.stringify(rule));

    /* ---- and the password is asked for twice ------------------------- */
    r.ok('there is a confirmation field', await shown(page, '#setup-pw2'));
    r.ok('and neither field shows what is typed',
      (await page.$eval('#setup-pw', (e) => e.type)) === 'password'
      && (await page.$eval('#setup-pw2', (e) => e.type)) === 'password');

    await page.fill('#setup-pw', 'LONGENOUGH1');
    await page.fill('#setup-pw2', 'LONGENOUGH2');
    await page.click('#setup-s8-go');
    await settle(page);
    r.ok('a mistyped confirmation is refused', await visible(page, '#setup-s8-err'));
    r.ok('and the wizard does not close on it', await visible(page, '#setup'));

    /* ---- the radio is a radio, not a stretched text field ------------ */
    // The screen's actual fault: `.setupscreen input{width:100%}` applied
    // to radios too, so the control filled the row and its label sat under
    // it. Measured rather than read off the rule, because the rule is not
    // what renders.
    const radioBox = await page.$eval('#setup-change', (e) => e.getBoundingClientRect().width);
    const labelBox = await page.$eval('#setup-change-l', (e) => e.getBoundingClientRect().width);
    r.ok('the radio is not stretched to the width of the choice',
      radioBox < labelBox / 2, radioBox + ' of ' + labelBox);

    // Beside the first line of its label, not above it.
    const sameLine = await page.evaluate(() => {
      const radio = document.getElementById('setup-change').getBoundingClientRect();
      const title = document.querySelector('#setup-change-l .t').getBoundingClientRect();
      return radio.right <= title.left + 1 && radio.top < title.bottom;
    });
    r.ok('and sits beside the title rather than above it', sameLine);

    r.ok('no uncaught errors in the wizard', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  /* ---- the admin routes are admin-only, and the wizard must respect it */
  {
    // THE BUG HIT ON THE FIRST REAL RUN. Every route this wizard
    // writes through is admin-only, and on a fresh install the
    // administrator does not exist until screen two has been answered. The
    // starting-point catalogue was fetched once when the wizard STARTED, so
    // it answered 401, the list stayed empty, and screen three offered
    // Continue and Skip with nothing to choose between them.
    //
    // Every earlier test stubbed the catalogue unconditionally, so none of
    // them could see it. This one answers 401 until the code is verified,
    // which is what the server actually does.
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**://*.google*/**', (x) => x.abort());
    await page.route('**://*.gstatic.com/**', (x) => x.abort());

    let hasSession = false;
    await page.route('**/api/setup/status', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ needed: true, hasAdmin: false, minPassword: 8 }),
    }));
    await page.route('**/api/setup/request-code', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: '{"ok":true,"emailed":true}',
    }));
    await page.route('**/api/setup/verify-code', (route) => {
      hasSession = true;
      return route.fulfill({
        status: 200, contentType: 'application/json', body: '{"ok":true,"role":"admin"}',
      });
    });
    for (const path of ['templates', 'identity', 'look', 'publication', 'attachments']) {
      await page.route(`**/api/admin/${path}`, (route) => {
        if (!hasSession) {
          return route.fulfill({
            status: 401, contentType: 'application/json', body: '{"error":"Not authenticated"}',
          });
        }
        if (route.request().method() === 'POST') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
        }
        const bodies = {
          templates: { applied: null, templates: [
            { id: 'elections', label: 'Election incidents', description: 'What this was built for.', sets: ['Publishes an archive'] },
            { id: 'blank', label: 'Start from nothing', description: 'Set it up by hand.', sets: ['Leaves the form closed'] },
          ] },
          identity: { siteName: 'ReportLog', isDefault: true, stored: null, software: 'ReportLog', maxLength: 60 },
          look: { look: { palette: 'flint', theme: 'signal', layout: 'sheet' },
            palettes: [{ id: 'flint', label: 'Flint', description: 'The shipped look.', dark: false }],
            themes: [{ id: 'signal', label: 'Signal', description: 'The shipped type.' }],
            layouts: [{ id: 'sheet', label: 'Sheet', description: 'The shipped width.' }] },
          publication: { publicArchive: true, distribution: false, distributionImplemented: false },
          attachments: { enabled: true, kinds: [], allKinds: [], storageConfigured: true },
        };
        return route.fulfill({
          status: 200, contentType: 'application/json', body: JSON.stringify(bodies[path]),
        });
      });
    }

    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);

    // Walk it the way a real operator does: from screen one.
    await page.fill('#setup-email', 'owner@example.org');
    await page.click('#setup-s1-go');
    await page.waitForTimeout(400);
    await page.fill('#setup-code', '123456');
    await page.click('#setup-s2-go');
    await page.waitForTimeout(900);

    r.ok('the starting points arrive on a wizard walked from the beginning',
      (await page.$$('#setup-template-choices input')).length >= 2,
      String((await page.$$('#setup-template-choices input')).length));
    r.ok('and the empty-state note is not showing',
      await page.$eval('#setup-tpl-none', (e) => e.hidden));
    await page.close();
  }

  /* ---- and when a deployment offers none of them --------------------- */
  {
    // A screen offering a choice with nothing in it reads as broken. If the
    // catalogue cannot be read at all, say so and point at Skip.
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**://*.google*/**', (x) => x.abort());
    await page.route('**://*.gstatic.com/**', (x) => x.abort());
    await stubSetup(page, { needed: true, hasAdmin: true });
    await page.route('**/api/admin/templates', (route) => route.fulfill({
      status: 500, contentType: 'application/json', body: '{"error":"nope"}',
    }));
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    r.ok('a catalogue that cannot be read says so rather than showing a gap',
      !(await page.$eval('#setup-tpl-none', (e) => e.hidden)));
    // The skip button is ON the starting-point screen, which is now the fourth,
    // so the name has to be answered before it is on screen to be shown at all.
    await page.fill('#setup-name', 'Named Archive');
    await page.click('#setup-s3-go');
    await page.waitForTimeout(500);
    r.ok('and skipping is still offered', await shown(page, '#setup-s4-skip'));
    await page.close();
  }

  /* ---- a reloaded tab resumes where it was -------------------------- */
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**://*.google*/**', (x) => x.abort());
    await page.route('**://*.gstatic.com/**', (x) => x.abort());
    await stubSetup(page, { needed: true, hasAdmin: true });
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);

    // Restarting at step 1 would put the operator in front of two screens
    // the server now refuses, which reads as the software being broken.
    r.ok('a wizard whose owner already exists resumes at the first unanswered screen',
      await visible(page, '#setup-s3'));
    r.ok('and does not offer to mint a second owner',
      !(await visible(page, '#setup-s1')));
    await page.close();
  }

  /* ---- the answers are written, not collected and dropped ----------- */
  {
    // The wizard asking is worth nothing if the answers go nowhere. Each
    // screen writes its own before moving on, so a tab closed halfway
    // keeps what was already given.
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**://*.google*/**', (x) => x.abort());
    await page.route('**://*.gstatic.com/**', (x) => x.abort());
    const wrote = [];
    await stubSetup(page, { needed: true, hasAdmin: true });
    // Registered after stubSetup so this sees the POSTs first.
    for (const path of ['identity', 'look', 'publication', 'attachments', 'templates']) {
      await page.route(`**/api/admin/${path}`, async (route) => {
        if (route.request().method() === 'POST') {
          wrote.push([path, route.request().postDataJSON()]);
          return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
        }
        return route.fallback();
      });
    }
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);

    // Skipped rather than applied, so what is checked below is what these
    // screens saved and not what a template wrote for them.
    await page.fill('#setup-name', 'Munich Incident Archive');
    await page.click('#setup-s3-go');
    await page.waitForTimeout(400);
    await page.click('#setup-s4-skip');
    await page.waitForTimeout(400);
    await page.check('#setup-pub-no');
    await page.click('#setup-s5-go');
    await page.waitForTimeout(400);
    await page.check('#setup-att-no');
    await page.click('#setup-s6-go');
    await page.waitForTimeout(600);
    await page.selectOption('#setup-palette', 'bureau');
    await page.click('#setup-s7-go');
    await page.waitForTimeout(400);

    const sent = Object.fromEntries(wrote);
    r.ok('the name is saved as typed',
      sent.identity?.siteName === 'Munich Incident Archive', JSON.stringify(wrote));
    r.ok('an archive turned off is saved as off',
      sent.publication?.publicArchive === false, JSON.stringify(wrote));
    r.ok('attachments turned off are saved as off',
      sent.attachments?.enabled === false, JSON.stringify(wrote));
    r.ok('skipping the starting point writes no template',
      !wrote.some(([path]) => path === 'templates'), JSON.stringify(wrote.map((w) => w[0])));
    r.ok('the chosen look is saved', sent.look?.palette === 'bureau', JSON.stringify(wrote));
    r.ok('and each screen saved before the next was shown', wrote.length === 4, JSON.stringify(wrote));
    await page.close();
  }

  /* ---- a screen that cannot save does not advance -------------------- */
  {
    // Carrying on regardless would hand somebody a deployment configured
    // the way they did not choose, with the wizard reporting it had asked.
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**://*.google*/**', (x) => x.abort());
    await page.route('**://*.gstatic.com/**', (x) => x.abort());
    await stubSetup(page, { needed: true, hasAdmin: true });
    await page.route('**/api/admin/identity', (route) => (route.request().method() === 'POST'
      ? route.fulfill({
        status: 500, contentType: 'application/json',
        body: JSON.stringify({ error: 'The database is not answering' }),
      })
      : route.fallback()));
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);

    await page.fill('#setup-name', 'Munich Incident Archive');
    await page.click('#setup-s3-go');
    await settle(page);
    r.ok('a name that could not be saved does not advance', await visible(page, '#setup-s3'));
    r.ok('and says so rather than failing quietly', await visible(page, '#setup-s3-err'));
    await page.close();
  }

  /* ---- no storage, and the screen says so --------------------------- */
  {
    // A switch that appears to turn attachments on while there is nowhere
    // to put them is a switch that lies.
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**://*.google*/**', (x) => x.abort());
    await page.route('**://*.gstatic.com/**', (x) => x.abort());
    await stubSetup(page, { needed: true, hasAdmin: true, storageConfigured: false });
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);

    await page.fill('#setup-name', 'Named Archive');
    await page.click('#setup-s3-go');
    await page.waitForTimeout(400);
    await page.click('#setup-s4-skip');
    await page.waitForTimeout(400);
    await page.click('#setup-s5-go');
    await page.waitForTimeout(400);
    r.ok('the attachments screen warns when there is nowhere to put a file',
      await shown(page, '#setup-att-nostorage'));
    r.ok('and says what answering yes does anyway',
      /records the decision/i.test((await page.textContent('#setup-att-nostorage')) || ''));
    await page.close();
  }

  /* ---- a screen taller than the window is not cut off at the top ------ */
  {
    // It was: the wizard was centred with align-items:center, and a centred
    // flex item taller than the window overflows at the top where nothing
    // can scroll to it. The starting-point screen hit that once it listed
    // four templates. A short window makes any screen taller than it.
    const page = await browser.newPage({ viewport: { width: 390, height: 480 } });
    await page.route('**://*.google*/**', (x) => x.abort());
    await page.route('**://*.gstatic.com/**', (x) => x.abort());
    await stubSetup(page, { needed: true, hasAdmin: true });
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    const fit = await page.evaluate(() => {
      const box = document.querySelector('#setup .box').getBoundingClientRect();
      return { top: Math.round(box.top), height: Math.round(box.height), window: innerHeight };
    });
    r.ok('a wizard screen taller than the window starts at the top, not above it',
      fit.height > fit.window && fit.top >= 0, JSON.stringify(fit));
    r.ok('and its heading can be seen without scrolling',
      await page.evaluate(() => {
        const h = document.querySelector('#setup .step.on h1').getBoundingClientRect();
        return h.top >= 0 && h.bottom <= innerHeight;
      }));
    await page.close();
  }

  /* ---- the stated rule is the server's number, not the page's -------- */
  {
    // Stubbed at something the markup could not be carrying by accident. A
    // number typed into the page would disagree with the server the first
    // time anybody changed MIN_CURTAIN_PASSWORD, and would go on reading
    // correctly while doing it.
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**://*.google*/**', (x) => x.abort());
    await page.route('**://*.gstatic.com/**', (x) => x.abort());
    await stubSetup(page, { needed: true, hasAdmin: true, minPassword: 23 });
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);

    const rule = (await page.textContent('#setup-pw-rule')) || '';
    r.ok('the screen states the minimum the server sent', /\b23\b/.test(rule), JSON.stringify(rule));
    await page.close();
  }

  /* ---- and stays out of the way otherwise --------------------------- */
  {
    const page = await open(browser, `${BASE}/`);
    r.ok('a deployment that has been set up never sees the wizard',
      !(await visible(page, '#setup')));
    await page.close();
  }

  return r;
}
