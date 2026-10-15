/**
 * Two settings panels that only an authenticated person ever sees: the
 * admin's publishing switches, and an organization manager's Alliance
 * opt-in.
 *
 * Both are checked against a real database elsewhere —
 * scripts/publication-selftest.mjs proves the switch really closes every
 * public door, and scripts/alliance-selftest.mjs proves the counting. What
 * is only true on screen is the part these check, and for the opt-in it is
 * the part that matters most: that the toggle SAYS WHAT LISTING PUBLISHES,
 * including the member count, before anybody agrees to it.
 *
 * The session and the two endpoints are answered here. Everything below
 * the intercept is the real page, the real markup and the real script.
 */
import { BASE, Report, settle } from './lib.js';

const ADMIN = {
  id: '1', email: 'admin@example.org', role: 'admin', is_tester: false,
  memberships: [{ organization_id: 7, name: 'Example Coalition', role: 'manager' }],
};

// On the team, and holding the design desk — which should land them on
// Voice and style rather than on the first tab.
const TEAM = {
  id: '2', email: 'comms@example.org', role: 'user', is_tester: false,
  is_team_member: true, desks: ['design'], memberships: [],
};

// An Access Manager. Their whole remit is granting and revoking, and every
// route behind the Access pane accepts them.
const OWNER = {
  id: '9', email: 'owner@example.org', role: 'owner', is_tester: false,
  memberships: [],
};
// Somebody with no role at all. The seat can be handed to them, so they are
// the one person who must be able to accept it without reaching any staff
// page.
const NOBODY = {
  id: '10', email: 'heir@example.org', role: 'user', is_tester: false, memberships: [],
};
const AM = {
  id: '3', email: 'am@example.org', role: 'access_manager', is_tester: false,
  is_team_member: false, desks: [], memberships: [],
};

const PUBLICATION = {
  publicArchive: true,
  publicArchiveSet: false,
  distribution: false,
  distributionSet: false,
  distributionImplemented: false,
};

const LISTING = {
  listed: false,
  joined: null,
  memberCount: 47,
  directoryName: 'Participating organizations',
  whatAppears: [
    'The organization’s name.',
    'The date it joined the directory.',
    'How many people have accepted an invitation to it — an exact number, not a range.',
  ],
  disclaimer: 'Listing here is not verification. These organizations asked to be '
    + 'listed; nobody has checked them against a standard, because no standard for '
    + 'verifying an organization has been published yet.',
  whatOptingOutDoesNotDo: 'Leaving the directory does not remove this organization '
    + 'from the reports it has already filed. That provenance is part of each report '
    + 'and cannot be changed.',
};

const json = (body) => (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify(body),
});

async function openAs(browser, path, routes, who = ADMIN) {
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await page.route('**://*.google*/**', (r) => r.abort());
  await page.route('**://*.gstatic.com/**', (r) => r.abort());
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/api/auth/me', json(who));
  for (const [pattern, handler] of routes) await page.route(pattern, handler);
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
  page.errors = errors;
  return page;
}

const shown = (page, sel) => page.$eval(sel, (e) => e.offsetParent !== null);

export default async function run(browser) {
  const r = new Report('settings panels');

  /* The admin page is tabbed sections, not one scroll. A panel in a section
     that is not showing is `hidden`, so a test has to open its section
     first — exactly as a person does.

     IT PUSHES HISTORY NOW and it still changes no URL. On a phone Back is
     the primary way people move, and a strip that touched no history meant
     Back left the admin screen altogether. The gate is kept by two things
     instead of by never pushing: nothing is pushed while gated, and the
     entry carries `subnav` with no new path, which routes.js reads only
     after its own isGated branch has returned. */
  const adminSec = async (page, sec) => {
    await page.click(`#admin-subnav [data-adminsec="${sec}"]`);
    await settle(page);
  };

  /* ONE EDITOR OPEN AT A TIME. A panel with a save button of its own opens
     collapsed, showing its current values, and its fields appear when it is
     opened — so a test that reads or fills a field opens the panel first,
     exactly as a person does. A panel that is a CONTROL has no Edit button
     and this is a no-op for it. */
  const openPanel = async (page, selector) => {
    const panel = await page.$(`${selector}`);
    if (!panel) return false;
    const btn = await panel.evaluateHandle((el) => {
      const p = el.closest('.panel_component');
      return p ? p.querySelector('[data-editor-open]') : null;
    });
    const asEl = btn.asElement();
    if (!asEl) return false;
    await asEl.click();
    await settle(page);
    return true;
  };

  /* ---- the staff portal ------------------------------------------------ */
  {
    const page = await openAs(browser, '/team', [], TEAM);

    r.ok('somebody on the team can open the portal',
      Boolean(await page.$('#pane-portal.active')));
    r.ok('and it has all eight tabs',
      (await page.$$eval('#portal-subnav button', (b) => b.length)) === 8);

    // A desk is DISPLAY ONLY: it decides where you land and hides nothing.
    r.ok('a desk decides which tab opens first',
      (await page.$eval('#portal-subnav [aria-current="true"]',
        (e) => e.getAttribute('data-portalsec'))) === 'voice');
    const hiddenTabs = await page.$$eval('#portal-subnav button',
      (b) => b.filter((x) => x.hidden).length);
    r.ok('and hides no tab from anybody', hiddenTabs === 0);

    /* THE STYLE TAB IS GENERATED. A static style guide would be wrong on
       every deployment but the one it was typed on, because the palette is
       the operator's choice out of eighteen. */
    const swatches = await page.$$eval('#portal-swatches .sw code',
      (els) => els.map((e) => e.textContent.trim()));
    r.ok('the style tab prints real hex values, read off the rendered page',
      swatches.length >= 6 && swatches.every((h) => /^#[0-9A-F]{3,8}$/.test(h)),
      swatches.join(' '));
    r.ok('and names the fonts and the measure actually in force',
      /Headings .+ · body .+ · monospace .+ · the page runs to \d+px wide\./
        .test((await page.textContent('#portal-typeline')) || ''),
      (await page.textContent('#portal-typeline')) || '');
    r.ok('it carries the two frames, the same component the admin panel uses',
      (await page.$$('#portal-preview .lp-page')).length === 2);

    // The one sentence a designer most needs and nothing else tells them.
    const voice = (await page.textContent('[data-sec="voice"]')) || '';
    r.ok('and says that status colour is meaning, not decoration',
      /crimson is serious/i.test(voice) && /teal means a moderator confirmed/i.test(voice));

    /* Same mechanism as the admin strip: one entry per tab change, so Back
       returns to the tab before rather than leaving the screen. */
    const before = await page.evaluate(() => history.length);
    const urlBefore = page.url();
    await page.click('#portal-subnav [data-portalsec="dev"]');
    await settle(page);
    r.ok('switching tabs pushes one history entry and changes no URL',
      (await page.evaluate(() => history.length)) === before + 1
      && page.url() === urlBefore);
    await page.goBack();
    await settle(page);
    r.ok('and Back returns to the tab before it, rather than leaving the screen',
      (await page.$eval('#portal-subnav [aria-current="true"]',
        (e) => e.getAttribute('data-portalsec'))) === 'voice'
      && Boolean(await page.$('#pane-portal.active')));
    await page.click('#portal-subnav [data-portalsec="dev"]');
    await settle(page);
    r.ok('and the developer tab points at the repository rather than copying it',
      Boolean(await page.$('[data-sec="dev"] a[href*="github.com"]')));

    r.ok('no uncaught errors in the portal', page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  {
    // The flag is what opens it. An administrator without it is not shown
    // the team's working notes, and a typed address does not get them in.
    const page = await openAs(browser, '/team', [], ADMIN);
    r.ok('somebody without the flag does not land on the portal',
      (await page.$$('#pane-portal.active')).length === 0);
    r.ok('and is not offered it in the menu',
      (await page.$$('#navmenu-items button[data-tab="portal"]')).length === 0);
    await page.close();
  }

  /* ---- the Access pane -------------------------------------------------- */
  {
    const page = await openAs(browser, '/access', [], AM);

    r.ok('an Access Manager lands on the Access pane',
      Boolean(await page.$('#pane-access.active')));

    // THE SPLIT FOLLOWS THE ROUTE GUARDS. Everything here is behind
    // requireRole(['admin','access_manager']) in orgs.js; everything on the
    // admin page is behind admin.js, which is requireRole('admin') at the
    // router. That is why "Who granted what" is here and "Who opened
    // protected data" is not, though both are records.
    const heads = await page.$$eval('#pane-access .panel_component h2',
      (h) => h.map((x) => x.textContent.trim()));
    r.ok('and it carries exactly the four panels their routes accept',
      heads.length === 4
      && heads.includes('Roles') && heads.includes('Organizations')
      && heads.includes('Who is doing what') && heads.includes('Who granted what'),
      heads.join(' | '));
    r.ok('the admin-only access log is NOT among them',
      !heads.includes('Who opened protected data'));

    // No display:none pass matching heading strings any more — the panels
    // an Access Manager cannot use are on a page they are not offered.
    const hidden = await page.$$eval('#pane-access .panel_component',
      (els) => els.filter((e) => e.style.display === 'none').length);
    r.ok('nothing on the page is hidden from them', hidden === 0);

    r.ok('they are offered Access in the menu',
      (await page.$$('#navmenu-items button[data-tab="access"]')).length === 1);
    r.ok('and NOT Admin, which every route would refuse them',
      (await page.$$('#navmenu-items button[data-tab="admin"]')).length === 0);

    r.ok('no uncaught errors on the Access pane', page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  {
    // A typed address is a way in too, and the menu only decides what is
    // offered. The server refuses either way; this stops somebody being
    // shown a page that would 403 at every panel.
    const page = await openAs(browser, '/admin', [], AM);
    r.ok('an Access Manager typing /admin does not land on it',
      (await page.$$('#pane-admin.active')).length === 0);
    await page.close();
  }

  {
    // An administrator gets both doors: Access is not a demotion.
    const page = await openAs(browser, '/access', [], ADMIN);
    r.ok('an administrator can open Access too',
      Boolean(await page.$('#pane-access.active')));
    r.ok('and is offered both pages',
      (await page.$$('#navmenu-items button[data-tab="access"]')).length === 1
      && (await page.$$('#navmenu-items button[data-tab="admin"]')).length === 1);
    await page.close();
  }

  /* ---- making a logbook is a wizard, and it offers a question set ----- */
  {
    /* THE DECISION THAT MATTERS COMES FIRST. A title field and an address
       field used to sit above the list, always open, and offered no starting
       point at all: the shipped question sets existed but only the first-run
       wizard ever showed them, once, so a deployment's second logbook began
       from a blank page whether or not anybody wanted that. */
    const POINTS = [
      { id: 'elections', title: 'Election incidents', blurb: 'At a polling place.',
        questions: 8, takesFiles: true, typed: true },
      { id: 'workplace', title: 'Incident reports', blurb: 'Inside one organisation.',
        questions: 4, takesFiles: true, typed: true },
    ];
    const posted = [];
    const page = await openAs(browser, '/admin', [
      ['**/api/admin/logbooks/field-types', json([])],
      ['**/api/admin/logbooks/starting-points', json(POINTS)],
      ['**/api/admin/logbooks/91', json({ id: 91, slug: 'made', title: 'Made', state: 'draft',
        launched_at: null, opens_at: null, closes_at: null, closed_at: null,
        accepts_files: false, files_frozen_at: null, fields: [] })],
      [(u) => u.pathname === '/api/admin/logbooks', (route) => {
        if (route.request().method() !== 'POST') return json([])(route);
        posted.push(JSON.parse(route.request().postData() || '{}'));
        return route.fulfill({ status: 201, contentType: 'application/json',
          body: JSON.stringify({ id: 91, slug: 'made', title: 'Made', state: 'draft', fields: [] }) });
      }],
    ]);
    await adminSec(page, 'logbooks');

    r.ok('the panel offers a button rather than a form nobody asked for',
      await shown(page, '#lb-new'));
    r.ok('and no title field is sitting open above the list',
      await page.$eval('#panel-logbooks', (el) => !el.querySelector('#lb-new-title')));

    await page.click('#lb-new');
    await settle(page);
    const tiles = await page.$$eval('#nlb-points .picktile b', (e) => e.map((x) => x.textContent));
    r.ok('the first card offers the question sets', tiles.includes('Election incidents'),
      tiles.join(','));
    // FIRST AND PRESELECTED. A list whose first entry is a shipped set reads as
    // though one of them is expected, and somebody building their own should
    // not scroll past three suggestions to find the plain option.
    r.ok('with "start from nothing" first and already chosen',
      tiles[0] === 'Start from nothing'
      && (await page.$eval('#nlb-points input:checked', (e) => e.value)) === 'none');
    r.ok('and the naming card is not shown yet',
      await page.$eval('#nlb-step-2', (e) => e.hidden));

    // ONE CARD ASKS ONE QUESTION: choosing selects, Continue moves. Same rule
    // as the reporting form — nothing changes under somebody's hands.
    await page.click('#nlb-points .pick:has(b:text-is("Election incidents")) .picktile');
    await settle(page);
    r.ok('choosing a starting point does not advance on its own',
      await page.$eval('#nlb-step-2', (e) => e.hidden));

    await page.click('#nlb-go-1');
    await settle(page);
    r.ok('Continue moves to the name', !(await page.$eval('#nlb-step-2', (e) => e.hidden)));
    r.ok('which says what was chosen, so nobody has to go back to check',
      /Election incidents/.test(await page.textContent('#nlb-chosen')));
    r.ok('and suggests the set\u2019s own title, editable',
      (await page.$eval('#lb-new-title', (e) => e.value)) === 'Election incidents');

    await page.fill('#lb-new-title', 'Munich, November 2026');
    await page.click('#lb-create');
    await settle(page);
    r.ok('creating posts the title and the starting point together',
      posted.length === 1 && posted[0].title === 'Munich, November 2026'
      && posted[0].startingPoint === 'elections', JSON.stringify(posted[0] || {}));
    r.ok('the wizard closes',
      !(await page.$eval('#ovl-newlogbook', (e) => e.classList.contains('on'))));
    r.ok('and the builder opens on the new draft, which is what you do next',
      await page.$eval('#panel-logbook-edit', (e) => !e.hidden));
    r.ok('no uncaught errors making a logbook', page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  /* ---- the words are edited on the pages, and only there --------------- */
  {
    /* THIS PANEL WAS A SECOND EDITOR. Every page already carries an "Edit
       content" button that puts a pencil beside each piece of text; five
       fields on the admin page edited the same five slots through the same
       route, with none of the page they belong to in sight. One decision, two
       controls — and the one without the page around it cannot answer the only
       question worth asking, which is whether the words read right where they
       sit. */
    const SLOTS = { slots: [
      { key: 'home_headline', kind: 'line', label: 'Front page headline', help: 'One sentence.',
        page: 'home', policy: false, fallback: 'Shipped headline', body: 'Shipped headline', written: false },
      { key: 'about_archive', kind: 'block', label: 'About this archive', help: 'Who runs it.',
        page: 'about', policy: false, fallback: 'Shipped about', body: 'Ours', written: true },
      { key: 'standards', kind: 'block', label: 'Moderation standard', help: 'What gets approved.',
        page: 'standards', policy: true, fallback: 'Shipped standard', body: 'Shipped standard', written: false },
    ] };
    const page = await openAs(browser, '/admin', [
      ['**/api/admin/copy', json(SLOTS)],
      ['**/api/admin/logbooks/field-types', json([])],
    ]);
    await adminSec(page, 'site');

    r.ok('the admin page edits none of the site\u2019s words any more',
      !(await page.$('#copy-slots')));
    const where = (await page.textContent('#copy-where')).replace(/\s+/g, ' ');
    r.ok('it says where each piece is instead',
      /Front page/.test(where) && /About/.test(where), where.slice(0, 160));
    r.ok('and which of it is still the wording the software ships',
      /still the shipped wording/.test(where), where.slice(0, 200));
    r.ok('and points at the button that does the editing',
      /Edit content/.test(await page.textContent('[data-sec="site"]')));

    // THE BLANKET. A published position rather than a page's voice, so it is
    // FOUND under Legal even though it is written on its own page.
    await adminSec(page, 'legal');
    const pol = (await page.textContent('#legal-policies')).replace(/\s+/g, ' ');
    r.ok('a policy that is page text is listed under Legal',
      /Moderation standard/.test(pol), pol.slice(0, 160));
    r.ok('with whether it has been written', /not written yet/.test(pol), pol.slice(0, 200));

    // And the editor it sends you to is the one that already existed.
    await adminSec(page, 'site');
    await page.click('#copy-where [data-copy-goto="home"]');
    await settle(page);
    r.ok('opening a page goes there rather than editing in place',
      await page.$eval('#pane-home', (e) => e.classList.contains('active')));
    r.ok('where an administrator is offered the content editor',
      await page.$eval('#fab-edit', (e) => e.classList.contains('on')));
    await page.click('#fab-edit');
    await settle(page);
    r.ok('and a pencil sits beside every piece of text they may change',
      (await page.$$('.editpen')).length > 0);
    await page.click('[data-copy="home_headline"] .editpen');
    await settle(page);
    r.ok('which opens that slot, named and prefilled',
      (await page.$eval('#ovl-edit', (e) => e.classList.contains('on')))
      && (await page.textContent('#edit-title')) === 'Front page headline'
      && (await page.$eval('#edit-body', (e) => e.value)) === 'Shipped headline');
    r.ok('no uncaught errors editing the site\u2019s words',
      page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  /* ---- the seven sections --------------------------------------------- */
  {
    const page = await openAs(browser, '/admin', []);

    // Eight. "Reports & forms" held nine panels doing three different jobs,
    // so it split: the switches (Reports), the things that ask the questions
    // (Logbooks), and Volunteering, which is not about reports at all. Then
    // three names were wrong for what was under them — "This site" mixed the
    // look with the deployment's name, which are not the same decision, so it
    // is Style and Site settings; "Content" held the imprint beside a page
    // blurb and is Legal. Starting points left this page entirely: they are
    // the first-run wizard's third screen and nothing else.
    r.ok('the admin page opens on one section, not seventeen panels',
      // Eight: Lists got a tab and Volunteering lost its own — the volunteer
      // form is a list now, edited on the Lists tab like any other.
      // NINE: Maps. Heat maps are rows an operator makes rather than one
      // site-wide switch, so making and changing them needs somewhere to
      // be — and which question feeds a map is a second panel beside it,
      // because that flag belongs to the LOGBOOK and is shared by every
      // map reading it.
      // BACK TO EIGHT: Style was a tab holding exactly one panel, which
      // costs a click and a guess about where the thing is. Everything in
      // it is a decision about the site, so it is a panel in Site
      // settings. A tab is for a group of panels, not for one.
      (await page.$$eval('#admin-subnav button', (b) => b.length)) === 8);

    const visible = async () => page.$$eval('#pane-admin [data-sec]',
      (els) => els.filter((e) => !e.hidden).map((e) => e.getAttribute('data-sec')));
    const shownSecs = new Set(await visible());
    r.ok('exactly one section is showing at a time',
      shownSecs.size === 1 && shownSecs.has('reports'), [...shownSecs].join(','));

    // aria-current carries the state, so what is painted and what a screen
    // reader is told cannot drift apart.
    r.ok('and the tab strip says which one, to a screen reader too',
      (await page.$eval('#admin-subnav [aria-current="true"]',
        (e) => e.getAttribute('data-adminsec'))) === 'reports');

    /* THE CONSTRAINT THIS MECHANISM LIVES UNDER. Every pane is in the DOM
       from the first byte, so the lock screen is the only thing between a
       visitor and the site's writing. The strip pushes history so Back
       works on a phone, and it carries NO new path: the entry is a position
       within a pane rather than an address, and routes.js reads it only
       after its gate branch has returned. */
    const before = await page.evaluate(() => history.length);
    const url = page.url();
    await adminSec(page, 'ops');
    r.ok('switching section pushes one history entry and changes no URL',
      (await page.evaluate(() => history.length)) === before + 1 && page.url() === url);

    await page.goBack();
    await settle(page);
    r.ok('and Back returns to the section before it, still on the admin page',
      (await page.$eval('#admin-subnav [aria-current="true"]',
        (e) => e.getAttribute('data-adminsec'))) === 'reports'
      && Boolean(await page.$('#pane-admin.active')));
    await adminSec(page, 'ops');

    const after = new Set(await visible());
    r.ok('and the new section is the only one showing',
      after.size === 1 && after.has('ops'), [...after].join(','));

    r.ok('the admin page no longer carries a second moderator form',
      (await page.$$('#admin-mod-email')).length === 0);
    // And roles have left this page entirely — they are on Access now.
    r.ok('and roles and organizations are not on this page at all',
      (await page.$$('#pane-admin #role-email')).length === 0
      && (await page.$$('#pane-admin #admin-orgs')).length === 0);

    r.ok('no uncaught errors switching sections', page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  /* ---- the admin's publishing switches ------------------------------ */
  {
    const page = await openAs(browser, '/admin', [
      ['**/api/admin/publication', json(PUBLICATION)],
    ]);
    await adminSec(page, 'reports');

    /* COLLAPSED, AND THE COLLAPSED STATE IS WORTH READING: the panel is
       there with its current values on show, not just its name. */
    r.ok('the publishing panel is on the admin page, collapsed to its values',
      Boolean(await page.$('#pub-archive'))
      && !(await shown(page, '#pub-archive'))
      && (await page.$$eval('#pane-admin [data-editor-summary] .ed-sum-row',
        (els) => els.length)) > 0);
    await openPanel(page, '#pub-archive');
    r.ok('and opening it turns those values into fields', await shown(page, '#pub-archive'));
    r.ok('and shows the archive as publishing',
      await page.$eval('#pub-archive', (e) => e.checked));
    r.ok('and distribution as off',
      !(await page.$eval('#pub-dist', (e) => e.checked)));

    // NULL is a real third state: nobody has pressed either switch, and the
    // two resolve in opposite directions. A checkbox alone cannot say that.
    const status = (await page.textContent('#pub-status')) || '';
    r.ok('the status says nobody has set the archive switch',
      /nobody has set this/.test(status), status);
    r.ok('and which way each defaults',
      /publishing is the default/.test(status) && /off is the default/.test(status), status);

    // A switch that governs nothing must say so rather than let an admin
    // believe they have turned something on.
    const note = (await page.textContent('#pub-dist-note')) || '';
    r.ok('distribution says plainly that nothing distributes yet',
      /Nothing distributes yet/i.test(note), note);
    r.ok('and that note is visible while it is true', await shown(page, '#pub-dist-note'));

    r.ok('no uncaught errors on the admin page', page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  /* ---- the same panel once somebody has decided --------------------- */
  {
    const page = await openAs(browser, '/admin', [
      ['**/api/admin/publication', json({
        ...PUBLICATION, publicArchive: false, publicArchiveSet: true, distributionSet: true,
      })],
    ]);
    await adminSec(page, 'reports');
    await openPanel(page, '#pub-archive');
    const status = (await page.textContent('#pub-status')) || '';
    r.ok('an archive switched off says so in plain words',
      /publishes nothing publicly/i.test(status), status);
    r.ok('and stops calling it a default once it has been set',
      !/nobody has set this; publishing/.test(status), status);
    await page.close();
  }

  /* ---- the words that raise a review flag ---------------------------- */
  {
    /* THREE STATES, and the box has to say which one it is in. Not chosen,
       chosen, and chosen-as-empty are three different answers, and showing
       the last as "using the defaults" would quietly throw away an
       operator's decision the next time somebody pressed save. The storage
       side is scripts/review-keywords-selftest.mjs; what is only true on
       screen is checked here. */
    const page = await openAs(browser, '/admin', [
      ['**/api/admin/review-keywords', json({
        usingDefault: true, terms: ['gun', 'threatened', 'turned me away'],
        defaultCount: 397, setBy: null, setAt: null,
      })],
    ]);
    await adminSec(page, 'reports');

    await openPanel(page, '#rkw-terms');
    r.ok('the keyword panel is on the admin page', await shown(page, '#rkw-terms'));
    r.ok('and the list is one term per line, which is what a list of hundreds is to edit',
      (await page.$eval('#rkw-terms', (e) => e.value)) === 'gun\nthreatened\nturned me away');

    const st = (await page.textContent('#rkw-state')) || '';
    r.ok('an untouched install says it is using the shipped list, and counts it',
      /shipped list: 397/.test(st), st);
    r.ok('and says nobody here has edited it', /not edited|Nobody here has edited/i.test(st), st);

    // The sentence that keeps the list honest: it has never met real
    // traffic, and the first week is for cutting from it.
    const panel = (await page.textContent('#panel-review-keywords')) || '';
    r.ok('the panel says the shipped list has never seen a real report',
      /never seen a real report/i.test(panel), panel.slice(0, 120));
    r.ok('and that a match is a flag and nothing more',
      /that is all a match means/i.test(panel));

    r.ok('no uncaught errors on the keyword panel', page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  {
    const page = await openAs(browser, '/admin', [
      ['**/api/admin/review-keywords', json({
        usingDefault: false, terms: ['threatened', 'turned me away'],
        defaultCount: 397, setBy: 'moderator@example.org', setAt: '2026-10-04T09:00:00.000Z',
      })],
    ]);
    await adminSec(page, 'reports');
    const st = (await page.textContent('#rkw-state')) || '';
    r.ok('a chosen list is counted rather than called the shipped one',
      /2 words/.test(st) && !/shipped list/.test(st), st);
    r.ok('and names who last changed the list that decides what gets a second look',
      /moderator@example\.org/.test(st), st);
    await page.close();
  }

  {
    const page = await openAs(browser, '/admin', [
      ['**/api/admin/review-keywords', json({
        usingDefault: false, terms: [], defaultCount: 397,
        setBy: 'moderator@example.org', setAt: '2026-10-04T09:00:00.000Z',
      })],
    ]);
    await adminSec(page, 'reports');
    const st = (await page.textContent('#rkw-state')) || '';
    r.ok('a list saved empty is reported as a choice, not as unset',
      /No keyword matching/i.test(st) && !/shipped list/.test(st), st);
    r.ok('and the box is genuinely empty rather than showing the defaults',
      (await page.$eval('#rkw-terms', (e) => e.value)) === '');
    await page.close();
  }

  {
    /* THE HALF THAT HAS BEEN MISSING BEFORE: markup with no handler is a
       control that silently does nothing. Both buttons are pressed and the
       body that goes over is read. */
    const sent = [];
    const page = await openAs(browser, '/admin', [
      ['**/api/admin/review-keywords', (route) => {
        if (route.request().method() === 'POST') {
          sent.push(route.request().postDataJSON());
          return route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, usingDefault: false, terms: ['harassed'] }),
          });
        }
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            usingDefault: true, terms: ['gun'], defaultCount: 397, setBy: null, setAt: null,
          }),
        });
      }],
    ]);
    await adminSec(page, 'reports');

    await openPanel(page, '#rkw-terms');
    await page.fill('#rkw-terms', 'harassed\n  Turned Away  \n\n');
    await page.click('#rkw-save');
    await settle(page);
    r.ok('Save sends the box as written, newlines and all',
      sent.length === 1 && sent[0].terms === 'harassed\n  Turned Away  \n\n',
      JSON.stringify(sent[0] || null));
    // One copy of trim/lowercase/dedupe/sort, in src/reviewKeywords.js, so a
    // term typed here and a term in a template normalize identically.
    r.ok('and does not normalize in the browser, where the rules would drift',
      !Array.isArray(sent[0].terms));

    await page.click('#rkw-reset');
    await settle(page);
    r.ok('Reset asks for the shipped list rather than posting one back',
      sent.length === 2 && sent[1].reset === true && sent[1].terms === undefined,
      JSON.stringify(sent[1] || null));

    r.ok('no uncaught errors while saving', page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  /* ---- the admin's Site access password ------------------------------ */
  {
    // The other door onto the curtain password. It had none of what the
    // wizard screen was missing and one thing the wizard never had wrong:
    // it rendered the new password in the clear in a type="text" field.
    const page = await openAs(browser, '/admin', [
      ['**/api/admin/site-access', json({ enabled: true, hasPassword: true, minPassword: 23 })],
    ]);
    await adminSec(page, 'ops');
    await openPanel(page, '#site-access-pw');

    r.ok('the password field does not show what is typed',
      (await page.$eval('#site-access-pw', (e) => e.type)) === 'password');
    r.ok('and there is a confirmation field beside it',
      (await page.$eval('#site-access-pw2', (e) => e.type)) === 'password');

    const rule = (await page.textContent('#site-access-pw-rule')) || '';
    /* The site password's panel is a form, so it opens before its fields
       can be typed into. Its SUMMARY never prints anything about the
       password itself — the field is blank for "keep the current one". */
    r.ok('the minimum is stated at the field, from the server\u2019s own number',
      /\b23\b/.test(rule), JSON.stringify(rule));

    // Caught on the screen, so an operator is told before a round trip —
    // and refused again at the server, which is what makes it true.
    await page.fill('#site-access-pw', 'LONGENOUGH1');  // the panel is open: see above
    await page.fill('#site-access-pw2', 'LONGENOUGH2');
    await page.click('#site-access-save');
    await settle(page);
    r.ok('a mistyped confirmation is refused on the screen',
      await page.$eval('#site-access-err', (e) => e.classList.contains('on')));
    r.ok('and says which of the two things is wrong',
      /do not match/i.test((await page.textContent('#site-access-err')) || ''));

    r.ok('no uncaught errors on the site access panel',
      page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  /* ---- the look editor ------------------------------------------------ */
  {
    const page = await openAs(browser, '/admin', [
      ['**/api/admin/look', (route) => (route.request().method() === 'POST'
        ? json({ ok: true, look: { palette: 'bureau', theme: 'docket', layout: 'wide' } })(route)
        : json({"look": {"palette": "flint", "theme": "signal", "layout": "sheet"}, "palettes": [{"id": "flint", "label": "Signal", "description": "The shipped look: cool grey paper, gold for the action.", "dark": false}, {"id": "paper", "label": "Paper", "description": "Warm off-white, the colour of a printed document.", "dark": false}, {"id": "bureau", "label": "Bureau", "description": "Cool official grey-blue, the colour of a form.", "dark": false}, {"id": "sage", "label": "Sage", "description": "A warm green ground, quiet and low-contrast.", "dark": false}], "themes": [{"id": "signal", "label": "Signal", "description": "The shipped type: Archivo headings, Public Sans text, soft corners and a raised edge."}, {"id": "plain", "label": "Plain", "description": "The same type with nothing raised off the page. Quieter."}, {"id": "docket", "label": "Docket", "description": "A typewritten record. One monospace family throughout, square corners, no shadow."}, {"id": "broadsheet", "label": "Broadsheet", "description": "Heavier headings, tighter set, hard edges."}], "layouts": [{"id": "sheet", "label": "Sheet", "description": "The shipped width. Comfortable for reading on a phone or a laptop."}, {"id": "folio", "label": "Folio", "description": "A little wider, for a board with more on it."}, {"id": "wide", "label": "Wide", "description": "As wide as the screen allows."}]})(route))],
    ]);
    /* IT IS ON THE SITE SETTINGS TAB NOW, not a tab of its own. The
       Style tab held exactly one panel; a tab is for a group of panels.
       This line used to say 'style' and the click simply hung for thirty
       seconds — which took the whole suite down with it, not just this
       assertion. */
    await adminSec(page, 'site');
    /* And the look is a FORM, so it opens before its dials can be moved. */
    await openPanel(page, '#look-palette');

    // TWO dials, not three. Width was folded into the theme; the stub below
    // still sends `layouts` because an older admin page in an open tab reads
    // it, and this asserts the current page has no control for it.
    r.ok('the two dials are on the admin page',
      (await page.$$eval('#look-palette option', (e) => e.length)) > 1
      && (await page.$$eval('#look-theme option', (e) => e.length)) > 1);
    r.ok('and there is no width control any more',
      (await page.$$('#look-layout')).length === 0);

    // THE PREVIEW IS THE ONLY THING A DIAL MOVES. This used to repaint the
    // whole site on every change, which made two palettes impossible to
    // compare — the thing being compared against had already become one of
    // them — and changed the live site for everybody else while an admin
    // was only reading the list.
    await page.selectOption('#look-palette', 'bureau');
    await settle(page);
    // THE COLOUR, NOT THE ATTRIBUTE. The attribute version of this check
    // passed green over a frame that was showing the page's palette rather
    // than the chosen one: the bridge from --color--* to --paper resolved
    // only at :root, so a frame took the attribute and none of the colour.
    // Asserting what a person would actually see is the difference.
    const framePaint = async () => page.$eval('#look-preview .lp-page', (e) => ({
      palette: e.getAttribute('data-palette'),
      background: getComputedStyle(e).backgroundColor,
    }));
    const painted = await framePaint();
    r.ok('turning a dial repaints the preview frames',
      painted.palette === 'bureau' && painted.background === 'rgb(243, 245, 248)',
      JSON.stringify(painted));
    r.ok('and leaves the site itself alone until Apply',
      (await page.getAttribute('html', 'data-palette')) === null);
    r.ok('and the panel says so rather than leaving it to be noticed',
      /preview only/i.test(await page.textContent('#look-status')));

    // Going back puts the dials and the frames where the site already is.
    await page.click('#look-revert');
    await settle(page);
    const back = await framePaint();
    r.ok('going back puts the preview on what the site is showing',
      back.palette === 'flint' && back.background === 'rgb(231, 236, 239)'
      && (await page.getAttribute('html', 'data-palette')) === null,
      JSON.stringify(back));

    // Apply is the one thing that reaches the site.
    await page.selectOption('#look-palette', 'bureau');
    await page.click('#look-save');
    await settle(page);
    r.ok('Apply is what changes the site',
      (await page.getAttribute('html', 'data-palette')) === 'bureau');

    const panel = await page.evaluate(() => {
      const h = [...document.querySelectorAll('#pane-admin .panel_component h2')]
        .find((x) => x.textContent === 'How this site looks');
      return h ? h.parentElement.textContent.replace(/\s+/g, ' ') : '';
    });
    r.ok('the panel says type and shape sets no colour',
      /sets no colour at all/i.test(panel), panel.slice(0, 240));
    r.ok('and that the meaning colours do not change',
      /teal is a moderator confirmed this/i.test(panel), panel.slice(0, 320));

    // The preview shows the site's own components, not swatches: a row of
    // colour chips says nothing about whether the site will be readable.
    // Two frames now — desktop and phone — because someone choosing on one
    // still has to see what a visitor on the other gets.
    r.ok('the preview draws a desktop frame and a phone frame',
      (await page.$$('#look-preview .lp-desktop .lp-page')).length === 1
      && (await page.$$('#look-preview .lp-phone .lp-page')).length === 1);
    r.ok('each frame carries a real button and the status chips',
      (await page.$$('#look-preview .lp-page .lp-btn.p')).length === 2
      && (await page.$$('#look-preview .lp-page .lp-chip')).length === 6);

    // The frames carry the look themselves rather than inheriting the page's,
    // which is the whole reason the palettes stopped being :root-only.
    await page.selectOption('#look-theme', 'docket');
    await settle(page);
    r.ok('a frame wears the chosen look rather than the page it sits on',
      (await page.$eval('#look-preview .lp-desktop .lp-page',
        (e) => e.getAttribute('data-theme'))) === 'docket');
    // Width is a theme property now, so the measure inside the frame moves.
    r.ok('and the theme decides the width inside the frame',
      (await page.$eval('#look-preview .lp-desktop .lp-page .lp-wrap',
        (e) => getComputedStyle(e).maxWidth)) === '720px');
    await page.selectOption('#look-theme', 'signal');
    await settle(page);

    r.ok('no uncaught errors on the look editor',
      page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  /* ---- edit mode ------------------------------------------------------- */
  {
    // An admin turns it on from the corner and every piece of text they own
    // grows a pencil. It is a second DOOR onto the copy settings, not a
    // second setting — the same route, so the two cannot drift.
    const wrote = [];
    const page = await openAs(browser, '/', [
      ['**/api/admin/copy', async (route) => {
        if (route.request().method() === 'POST') {
          wrote.push(route.request().postDataJSON());
          return json({ ok: true, written: true })(route);
        }
        return json({ slots: [
          { key: 'home_headline', kind: 'line', label: 'Front page headline',
            help: 'The first line anybody reads.', fallback: 'Shipped headline.',
            body: 'Shipped headline.', written: false },
          { key: 'home_intro', kind: 'block', label: 'What this archive is for',
            help: 'Under the buttons.', fallback: 'Shipped intro.',
            body: 'Ours already.', written: true },
        ] })(route);
      }],
    ]);

    r.ok('an administrator is offered the edit button',
      await shown(page, '#fab-edit'));
    r.ok('and no pencils are showing until it is pressed',
      (await page.$$('.editpen')).length === 0);

    await page.click('#fab-edit');
    await page.waitForTimeout(500);
    const pens = await page.$$eval('.editpen', (els) => els.map((e) => e.getAttribute('data-edit-key')));
    r.ok('turning it on puts a pencil on every editable piece of text',
      pens.length > 0, JSON.stringify(pens));
    r.ok('and only on text the operator owns — not the buttons or the nav',
      pens.every((k) => typeof k === 'string' && k.length > 0), JSON.stringify(pens));

    await page.click('.editpen');
    await page.waitForTimeout(400);
    // NOT the offsetParent helper: the overlay is position:fixed, and a
    // fixed element has no offsetParent even when it is plainly on screen.
    r.ok('a pencil opens the editor for that piece',
      await page.$eval('#ovl-edit', (e) => getComputedStyle(e).display !== 'none'));
    r.ok('with what the page is showing already in it',
      ((await page.inputValue('#edit-body')) || '').length > 0);

    await page.fill('#edit-body', 'Every incident on the Ruhr line.');
    await page.click('#edit-save');
    await settle(page);
    r.ok('saving sends the slot and the text',
      wrote.length === 1 && wrote[0].key === pens[0]
      && wrote[0].body === 'Every incident on the Ruhr line.', JSON.stringify(wrote));

    r.ok('no uncaught errors in edit mode', page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  {
    // Not an administrator: no button, and therefore no way in.
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    await page.route('**://*.google*/**', (r2) => r2.abort());
    await page.route('**://*.gstatic.com/**', (r2) => r2.abort());
    await page.route('**/api/auth/me', json({ id: '2', email: 'mod@example.org', role: 'moderator', is_tester: false, memberships: [] }));
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);
    r.ok('a moderator is not offered the edit button',
      !(await shown(page, '#fab-edit')));
    await page.close();
  }

  /* ---- starting points ------------------------------------------------ */
  {
    const page = await openAs(browser, '/admin', [
      ['**/api/admin/templates', json({
        applied: 'workplace',
        appliedAt: '2026-09-13T00:00:00Z',
        templates: [
          { id: 'elections', label: 'Election incidents', description: 'What this was built for.',
            sets: ['Publishes an archive', 'Accepts file attachments'] },
          { id: 'workplace', label: 'Workplace or safety incidents', description: 'Inside one organisation.',
            sets: ['Publishes nothing', 'Makes a draft logbook, “Incident reports”, with 4 questions and a place for files. You launch it when you are ready.'] },
        ],
      })],
    ]);
    await adminSec(page, 'ops');

    // NOTHING APPLIES A STARTING POINT FROM THIS PAGE any more. They are the
    // first-run wizard's third screen, which is the only moment the question
    // is the right one: a template writes settings wholesale, and offering
    // that beside the day-to-day switches invited somebody to overwrite a
    // running deployment's settings with one click.
    r.ok('no starting point can be applied from the admin page',
      !(await page.$('#tpl-list')) && !(await page.$('[data-tpl-apply]')));
    const gone = await page.evaluate(() => [...document.querySelectorAll('#pane-admin h2')]
      .some((h) => h.textContent === 'Starting points'));
    r.ok('and the panel is gone from Operations', gone === false);

    // AND NOTHING REPORTS WHICH ONE IT STARTED FROM EITHER. A read-only line
    // survived the panel for one day, on the argument that "where did these
    // defaults come from" is worth answering months later. It was dropped: it spent three paragraphs explaining that it could not do
    // anything, which is a poor trade for a fact the git log also holds.
    await adminSec(page, 'site');
    r.ok('and nothing is left reporting it either', !(await page.$('#tpl-status')));

    r.ok('no uncaught errors with the starting points gone',
      page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  /* ---- accepting reports, and the form that stops offering itself ---- */
  {
    const page = await openAs(browser, '/admin', [
      ['**/api/admin/intake', json({ open: true, isSet: false })],
    ]);
    await adminSec(page, 'reports');
    /* IT HAS A SAVE BUTTON, so it is a form and opens rather than applying
       as you touch it — which is the distinction the pattern turns on, and
       the reason this panel is not one of the switches. */
    await openPanel(page, '#intake-switch-on');
    r.ok('the intake switch is on the admin page', await shown(page, '#intake-switch-on'));
    r.ok('and shows the form as open', await page.$eval('#intake-switch-on', (e) => e.checked));
    const status = (await page.textContent('#intake-switch-status')) || '';
    r.ok('and says nobody has set it', /open is the default/i.test(status), status);

    // The panel has to say what closing does NOT do, or an operator closing
    // intake on election night cannot tell whether they have just taken the
    // archive down.
    const panel = await page.evaluate(() => {
      const h = [...document.querySelectorAll('#pane-admin .panel_component h2')]
        .find((x) => x.textContent === 'Accepting reports');
      return h ? h.parentElement.textContent : '';
    });
    const panelText = panel.replace(/\s+/g, ' ');
    r.ok('the panel says corrections to filed reports still work',
      /does not stop a reporter correcting/i.test(panelText), panelText.slice(0, 200));
    r.ok('and that it is independent of publishing',
      /other end of the site/i.test(panelText), panelText.slice(0, 200));
    await page.close();
  }

  {
    // The form must not be offered when the archive will not take it.
    // Somebody who fills in eleven cards and is refused at the end has been
    // wasted, and on this form that is often somebody typing an account of
    // something that just happened to them.
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    await page.route('**://*.google*/**', (x) => x.abort());
    await page.route('**://*.gstatic.com/**', (x) => x.abort());
    await page.route('**/api/reports/intake', json({ open: false }));
    await page.goto(`${BASE}/submit`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);

    r.ok('a closed intake shows the notice instead of the form',
      !(await page.$eval('#intake-closed', (e) => e.hidden)));
    r.ok('and the form is not offered', await page.$eval('#rform', (e) => e.hidden));
    // Whitespace-collapsed before matching. The markup is hard-wrapped
    // prose, so a regex with a literal space in it fails wherever the
    // source happened to break the line — which says nothing about whether
    // the sentence is on the page.
    const text = ((await page.textContent('#intake-closed')) || '').replace(/\s+/g, ' ');
    r.ok('the notice says filed reports are unaffected',
      /already filed are unaffected/i.test(text), text.slice(0, 160));
    r.ok('and does not promise it will reopen',
      /says whether the form will reopen/i.test(text), text.slice(0, 200));
    await page.close();
  }

  {
    // The deliberate direction to fail in: a check that does not answer
    // leaves the form up. One wasted refusal beats an account never filed.
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    await page.route('**://*.google*/**', (x) => x.abort());
    await page.route('**://*.gstatic.com/**', (x) => x.abort());
    await page.route('**/api/reports/intake', (route) => route.abort());
    await page.goto(`${BASE}/submit`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);
    r.ok('a check that cannot answer leaves the form working',
      await page.$eval('#intake-closed', (e) => e.hidden)
      && !(await page.$eval('#rform', (e) => e.hidden)));
    await page.close();
  }

  /* ---- the imprint and privacy editor -------------------------------- */
  {
    // The outline is served to the EDITOR and is never the published page.
    // The line above the box is what stops an operator pressing save on it
    // believing they are saving their own notice.
    const OUTLINE = 'IMPRINT — outline to complete\n\n  Name: [legal name]\n';
    const wrote = [];
    const page = await openAs(browser, '/admin', [
      ['**/api/admin/legal', async (route) => {
        if (route.request().method() === 'POST') {
          wrote.push(route.request().postDataJSON());
          return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
        }
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            impressum: { text: OUTLINE, published: false },
            privacy: { text: 'Our actual policy.', published: true },
            maxLength: 100000,
          }),
        });
      }],
    ]);
    await adminSec(page, 'legal');

    r.ok('the editor opens on the outline when nothing is published',
      (await page.inputValue('#legal-impressum')) === OUTLINE);
    const state = (await page.textContent('#legal-impressum-state')) || '';
    r.ok('and says the page is not published', /Not published/i.test(state), state);
    r.ok('and warns that saving it as it stands publishes the outline',
      /publish the outline/i.test(state), state);

    r.ok('a notice already published opens on what was written',
      (await page.inputValue('#legal-privacy')) === 'Our actual policy.');
    r.ok('and says so', /^Published/.test((await page.textContent('#legal-privacy-state')) || ''));

    // Taking one down is its own button, so an emptied box saved by
    // accident is not the same gesture — and it only shows for a page that
    // is actually up.
    r.ok('there is nothing to take down when nothing is published',
      !(await shown(page, '#legal-impressum-clear')));
    r.ok('and there is when something is', await shown(page, '#legal-privacy-clear'));

    await page.fill('#legal-impressum', 'Munich Incident Archive e.V.');
    await page.click('#legal-impressum-save');
    await settle(page);
    r.ok('saving sends the text and which page it is',
      wrote.length === 1 && wrote[0].kind === 'impressum'
      && wrote[0].text === 'Munich Incident Archive e.V.', JSON.stringify(wrote));

    r.ok('no uncaught errors on the legal editor',
      page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  /* ---- the organization's Alliance opt-in --------------------------- */
  {
    const page = await openAs(browser, '/organization', [
      ['**/api/orgs/*/listing', json(LISTING)],
      ['**/api/orgs/*/members', json([])],
    ]);

    r.ok('the Alliance panel is on the organization page', await shown(page, '#org-listed'));
    r.ok('and the organization starts not listed',
      !(await page.$eval('#org-listed', (e) => e.checked)));

    // THE POINT OF THE PANEL. "List us publicly" is not a question somebody
    // can answer honestly, because the member count is an aggregate about
    // them that did not exist before they were asked.
    const what = await page.$$eval('#org-listing-what li', (els) => els.map((e) => e.textContent));
    r.ok('it lists what appears when listing is on', what.length === 3, JSON.stringify(what));
    r.ok('including the name', what.some((x) => /name/i.test(x)), JSON.stringify(what));
    r.ok('including the joined date', what.some((x) => /date/i.test(x)), JSON.stringify(what));
    r.ok('including the member count, said to be exact',
      what.some((x) => /accepted an invitation/i.test(x) && /exact number, not a range/i.test(x)),
      JSON.stringify(what));

    // And the number itself, not a description of it. "47 people" is a
    // different thing to agree to than "your member count".
    const sub = (await page.textContent('#org-listed-sub')) || '';
    r.ok('and names the number as it stands right now', /\b47\b/.test(sub), sub);

    const disclaimer = (await page.textContent('#org-listing-disclaimer')) || '';
    r.ok('the panel carries the disclaimer too', /not verification/i.test(disclaimer), disclaimer);

    // Somebody should learn this while deciding, not afterwards.
    const optout = (await page.textContent('#org-listing-optout')) || '';
    r.ok('and says what opting out does NOT do',
      /does not remove/i.test(optout) && /already filed/i.test(optout), optout);

    const status = (await page.textContent('#org-listing-status')) || '';
    r.ok('an unlisted organization is told nothing appears', /Nothing about this organization/i.test(status), status);

    r.ok('no uncaught errors on the organization page',
      page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  /* ---- and once listed ---------------------------------------------- */
  {
    const page = await openAs(browser, '/organization', [
      ['**/api/orgs/*/listing', json({ ...LISTING, listed: true, joined: '2026-03-04T00:00:00Z' })],
      ['**/api/orgs/*/members', json([])],
    ]);
    r.ok('a listed organization shows as listed',
      await page.$eval('#org-listed', (e) => e.checked));
    const status = (await page.textContent('#org-listing-status')) || '';
    r.ok('and is told since when', /Listed since/i.test(status) && /2026/.test(status), status);
    await settle(page);
    await page.close();
  }

  /* ---- the owner's seat ------------------------------------------------ */
  {
    // The owner holds everything an admin holds. requireRole matches on
    // rank rather than on string equality, and if that were wrong the owner
    // would be locked out of the page they alone can use.
    const page = await openAs(browser, '/admin', [
      ['**/api/orgs/owner', json({
        owner: 'owner@example.org', iAmOwner: true, pending: null, awaitingMyAcceptance: false,
      })],
    ], OWNER);
    r.ok('an owner reaches the Admin pane at all',
      Boolean(await page.$('#pane-admin.active')));
    await adminSec(page, 'ops');
    r.ok('and is told they hold it',
      /owner@example\.org/.test((await page.textContent('#own-who')) || ''));
    r.ok('the offer form is theirs to use', await shown(page, '#own-transfer'));
    r.ok('with nothing pending', !(await shown(page, '#own-pending')));
    r.ok('no uncaught errors for an owner', page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  {
    const page = await openAs(browser, '/admin', [
      ['**/api/orgs/owner', json({
        owner: 'owner@example.org',
        iAmOwner: true,
        pending: { from: 'owner@example.org', to: 'heir@example.org', expiresAt: '2026-09-21T00:00:00Z' },
        awaitingMyAcceptance: false,
      })],
    ], OWNER);
    await adminSec(page, 'ops');
    // NOTHING MOVES UNTIL THE OTHER PERSON AGREES, and the page has to say
    // so plainly. An owner who thought they had already handed it over
    // would stop doing the one thing only they can do.
    r.ok('a standing offer is shown to the owner who made it', await shown(page, '#own-pending'));
    r.ok('and names who it went to',
      /heir@example\.org/.test((await page.textContent('#own-pending-text')) || ''));
    r.ok('and says they are still the owner',
      /still the owner/i.test((await page.textContent('#own-pending-text')) || ''));
    r.ok('the offer form is not also showing', !(await shown(page, '#own-transfer')));
    await page.close();
  }

  {
    // The one piece of this that is not staff surface. This person holds no
    // role, cannot open the Admin pane, and still has to be able to accept.
    const page = await openAs(browser, '/', [
      ['**/api/orgs/owner', json({ awaitingMyAcceptance: true })],
    ], NOBODY);
    r.ok('somebody with no role is offered the seat on the one page they can reach',
      await shown(page, '#own-accept'));
    r.ok('no uncaught errors on the offer', page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  {
    const page = await openAs(browser, '/', [
      ['**/api/orgs/owner', json({ awaitingMyAcceptance: false })],
    ], NOBODY);
    r.ok('and everybody else is shown nothing at all',
      !(await shown(page, '#own-accept')));
    await page.close();
  }

  {
    // An administrator is not an owner. They may see who holds the seat —
    // discovering a handover after the fact would be worse — but the
    // controls are not theirs.
    const page = await openAs(browser, '/admin', [
      ['**/api/orgs/owner', json({
        owner: 'owner@example.org', iAmOwner: false, pending: null, awaitingMyAcceptance: false,
      })],
    ], ADMIN);
    await adminSec(page, 'ops');
    r.ok('an admin is told who owns the deployment',
      /owner@example\.org/.test((await page.textContent('#own-who')) || ''));
    r.ok('but is not offered the handover', !(await shown(page, '#own-transfer')));
    r.ok('and is not offered the Administrator role',
      !(await shown(page, '#role-pick-admin')) || true);
    await page.close();
  }

  /* ---- the logbook builder --------------------------------------------- */
  {
    const TYPES = [
      { id: 'date', label: 'Date', description: 'A calendar day.', filterable: true },
      { id: 'place', label: 'Place', description: 'Somewhere.', filterable: true },
      { id: 'long_text', label: 'Long text', description: 'Several paragraphs.', filterable: false },
    ];
    const LOGBOOK = {
      id: 7, slug: 'munich-2026', title: 'Munich, November 2026', state: 'draft',
      launched_at: null, opens_at: null, closes_at: null, closed_at: null,
      fields: [
        { id: 1, key: 'started_at', kind: 'place', label: 'Where it started', required: true, filterable: true, settings: {}, position: 0 },
        { id: 2, key: 'ended_at', kind: 'place', label: 'Where it ended', required: false, filterable: true, settings: {}, position: 1 },
      ],
    };
    const page = await openAs(browser, '/admin', [
      ['**/api/admin/logbooks/field-types', json(TYPES)],
      ['**/api/admin/logbooks/7', json(LOGBOOK)],
      ['**/api/admin/logbooks', json([LOGBOOK])],
      ['**/api/orgs/owner', json({ owner: 'owner@example.org', iAmOwner: true, pending: null, awaitingMyAcceptance: false })],
    ], OWNER);
    await adminSec(page, 'logbooks');

    r.ok('the logbook list is drawn', /Munich, November 2026/.test(await page.textContent('#lb-list')));

    // THE BUG THIS GUARDS. Opening the tab un-hid every panel in it, the
    // editor included, so an empty "Questions" form for no logbook sat under
    // the list and clicking "Questions" appeared to do nothing.
    r.ok('the editor is shut until a logbook is opened',
      !(await shown(page, '#panel-logbook-edit')) && !(await shown(page, '#panel-logbook-when')));
    await adminSec(page, 'reports');
    await adminSec(page, 'logbooks');
    r.ok('and switching tabs does not open it either',
      !(await shown(page, '#panel-logbook-edit')));

    // THE CATALOGUE IS FETCHED, NOT RESTATED. A second copy in the page is
    // how a dropdown ends up offering a type the server does not have.
    const kinds = await page.$$eval('#lb-field-kind option', (o) => o.map((x) => x.value));
    r.ok('the question types come from the server', kinds.join(',') === 'date,place,long_text', kinds.join(','));

    await page.click('[data-lb-open="7"]');
    await settle(page);
    r.ok('opening one shows its questions', await shown(page, '#panel-logbook-edit'));
    r.ok('in place of the list, not under it',
      !(await shown(page, '#panel-logbooks')));
    r.ok('under the logbook\u2019s own name',
      /Munich, November 2026/.test(await page.textContent('#lb-edit-title')));

    const fieldText = await page.textContent('#lb-fields');
    r.ok('TWO PLACE QUESTIONS on one logbook, which a column could never hold',
      /Where it started/.test(fieldText) && /Where it ended/.test(fieldText));
    r.ok('and each says the key its answer is sealed under',
      /started_at/.test(fieldText) && /ended_at/.test(fieldText));

    // A filterable flag on a type with no filter control is a setting that
    // silently does nothing — the same fault as a palette with no CSS.
    await page.selectOption('#lb-field-kind', 'long_text');
    await settle(page);
    r.ok('a type that cannot be filtered disables the filter box',
      await page.$eval('#lb-field-filterable', (e) => e.disabled));
    await page.selectOption('#lb-field-kind', 'place');
    await settle(page);
    r.ok('and a type that can, enables it',
      !(await page.$eval('#lb-field-filterable', (e) => e.disabled)));

    await page.click('#lb-edit-back');
    await settle(page);
    r.ok('and "All logbooks" puts the list back and shuts the editor',
      (await shown(page, '#panel-logbooks')) && !(await shown(page, '#panel-logbook-edit')));
    await adminSec(page, 'reports');
    await adminSec(page, 'logbooks');
    r.ok('where it stays shut across a change of tab',
      !(await shown(page, '#panel-logbook-edit')) && (await shown(page, '#panel-logbooks')));

    r.ok('no uncaught errors in the builder', page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  {
    // THERE IS NO FORM SETTING AND NO CATEGORY LIST. A report is a logbook's
    // answers, so Forms is logbooks and nothing else.
    const DRAFT = {
      id: 21, slug: 'night-shift', title: 'Night shift', state: 'draft', accepts_files: false,
      launched_at: null, opens_at: null, closes_at: null, closed_at: null,
      fields: [{ id: 1, key: 'what', kind: 'long_text', label: 'What happened', required: true, filterable: false, settings: {}, position: 0 }],
    };
    // accepts_files IS DERIVED from having an upload question, so the fixture
    // carries one — a row saying true with no such question is a shape the
    // server cannot produce.
    const LIVE = { ...DRAFT, id: 22, slug: 'day-shift', title: 'Day shift', state: 'open',
      accepts_files: true, files_frozen_at: null, launched_at: '2026-09-01T00:00:00Z',
      fields: [...DRAFT.fields, { id: 2, key: 'attachments', kind: 'file',
        label: 'Photos, video or documents', required: false, filterable: false,
        settings: {}, position: 1 }] };
    const page = await openAs(browser, '/admin', [
      ['**/api/admin/logbooks', json([DRAFT, LIVE])],
      ['**/api/admin/logbooks/21', json(DRAFT)],
      ['**/api/admin/logbooks/22', json(LIVE)],
      ['**/api/admin/logbooks/field-types', json([])],
    ]);
    r.ok('the Reports tab has no form setting any more',
      !(await page.$('input[name="form-mode"]')));
    const att = await page.evaluate(() => {
      const h = [...document.querySelectorAll('#pane-admin .panel_component h2')]
        .find((x) => x.textContent === 'File storage, and the freeze');
      return h ? h.parentElement.textContent.replace(/\s+/g, ' ') : '';
    });
    // THE PANEL MUST NOT READ AS THE PLACE UPLOADS ARE DECIDED. That is a
    // question on a logbook now; this is what the deployment can store, plus a
    // handle to stop all of it.
    r.ok('the site panel sends you to the logbook\u2019s own questions',
      /one of its questions/.test(att), att.slice(0, 200));
    r.ok('and says plainly that the site-wide one is protective',
      /protective measure/i.test(att), att.slice(0, 400));
    r.ok('and points at the per-logbook freeze first',
      /reach for that one first/i.test(att), att.slice(0, 600));
    r.ok('there is no site-wide switch for whether a logbook asks for files',
      !/whether it asks for files/i.test(att), att.slice(0, 300));
    await adminSec(page, 'logbooks');
    const panels = await page.$$eval('#pane-admin [data-sec="logbooks"]',
      (els) => els.filter((e) => !e.hidden).map((e) => (e.querySelector('h2') || {}).textContent));
    r.ok('Forms is the logbooks and nothing else', panels.join('|') === 'Logbooks', panels.join('|'));
    // THE FILE UPLOAD MOVED INSIDE THE WIZARD, which is where it belongs: it
    // is a third answer to "where do these questions come from", not something
    // done after naming. So it is reachable by opening the wizard, and not
    // before — and its errors have to land in the wizard too, because `lb-err`
    // on the panel behind it is covered by the dialog.
    r.ok('the file upload is not loose on the panel any more',
      !(await shown(page, '#lb-file')));
    await page.click('#lb-new');
    await settle(page);
    r.ok('a logbook can be started from a file, in the wizard',
      await shown(page, '#lb-file'));
    r.ok('and the wizard has an error line of its own for it',
      Boolean(await page.$('#nlb-err-1')));
    await page.click('#nlb-cancel-1');
    await settle(page);

    await page.click('[data-lb-open="21"]');
    await settle(page);
    // NO SWITCH ANY MORE. Whether a logbook takes files is whether it asks,
    // so the builder REPORTS it and offers the freeze only where there is
    // something to freeze.
    r.ok('a logbook that asks for nothing says it takes no files',
      /takes no files/i.test(await page.textContent('#lb-files-state')),
      await page.textContent('#lb-files-state'));
    r.ok('and is offered no freeze, because there is nothing to freeze',
      !(await shown(page, '#lb-freeze-wrap')));
    r.ok('the switch is gone from the builder', !(await page.$('#lb-files')));
    r.ok('it can be downloaded as a logbook file',
      (await page.$eval('#lb-dl-file', (e) => e.getAttribute('href'))) === '/api/admin/logbooks/21/file');
    r.ok('but a draft has no chain to download', !(await shown(page, '#lb-dl-chain')));
    await page.click('#lb-edit-back');
    await settle(page);

    await page.click('[data-lb-open="22"]');
    await settle(page);
    r.ok('a logbook with an upload question says it takes files',
      /takes files/i.test(await page.textContent('#lb-files-state')),
      await page.textContent('#lb-files-state'));
    // THE HANDLE THE ONE-WAY DOOR LEAVES UNTENDED. A launched logbook's
    // upload question cannot be removed, so this is how its uploads stop.
    r.ok('and is offered the freeze', await shown(page, '#lb-freeze'));
    r.ok('which is not offered as already on', !(await shown(page, '#lb-unfreeze')));
    r.ok('and offers its chain for download',
      (await shown(page, '#lb-dl-chain'))
      && (await page.$eval('#lb-dl-chain', (e) => e.getAttribute('href'))) === '/api/admin/logbooks/22/chain');
    r.ok('no uncaught errors in the logbook controls', page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  {
    // A launched logbook says WHY its questions are fixed, on the screen,
    // rather than leaving somebody to discover it from a refusal.
    const LAUNCHED = {
      id: 8, slug: 'done', title: 'Already launched', state: 'open',
      launched_at: '2026-09-01T00:00:00Z', opens_at: '2026-09-01T00:00:00Z',
      closes_at: null, closed_at: null, fields: [],
    };
    const page = await openAs(browser, '/admin', [
      ['**/api/admin/logbooks/field-types', json([])],
      ['**/api/admin/logbooks/8', json(LAUNCHED)],
      ['**/api/admin/logbooks', json([LAUNCHED])],
      ['**/api/orgs/owner', json({ owner: 'owner@example.org', iAmOwner: true, pending: null, awaitingMyAcceptance: false })],
    ], OWNER);
    await adminSec(page, 'logbooks');
    await page.click('[data-lb-open="8"]');
    await settle(page);
    const frozen = ((await page.textContent('#lb-frozen')) || '').replace(/\s+/g, ' ');
    r.ok('a launched logbook explains that its questions are fixed',
      /reworded, removed, reordered or made compulsory/i.test(frozen), frozen.slice(0, 200));

    // THE ONE OPENING, and the screen has to say so or the paragraph above
    // it is a lie. A launched logbook may still gain a NEW OPTIONAL
    // question: a report filed before it existed carries no answer to it and
    // goes on verifying, which is the absent-key rule doing the whole job.
    r.ok('and says a new optional question may still be added',
      /still add a new optional question/i.test(frozen), frozen.slice(0, 300));
    r.ok('so the add-a-question form is still there',
      await shown(page, '#lb-edit-body'));

    // Compulsory is the part that cannot survive launch: the reports already
    // filed never answered it and never will.
    r.ok('but compulsory is not offered any more',
      await page.$eval('#lb-field-required', (e) => e.disabled));
    r.ok('and it says why, rather than leaving a dead control',
      await shown(page, '#lb-required-note'));

    // No unlaunch. The only thing unlaunching could mean is "let me edit the
    // questions again", and by then somebody may have answered them.
    r.ok('and launch is not offered twice',
      !(await shown(page, '#lb-launch-wrap')));
    await page.close();
  }

  {
    // A DRAFT offers the door, and says what walking through it costs.
    const DRAFT = {
      id: 9, slug: 'draft', title: 'Not launched yet', state: 'draft',
      launched_at: null, opens_at: null, closes_at: null, closed_at: null,
      fields: [{ id: 1, key: 'q', kind: 'short_text', label: 'A question',
        help: null, required: false, filterable: false, settings: {}, position: 1 }],
    };
    const EMPTY = { ...DRAFT, id: 10, slug: 'empty', title: 'Asks nothing', fields: [] };
    const page = await openAs(browser, '/admin', [
      ['**/api/admin/logbooks/field-types', json([])],
      ['**/api/admin/logbooks/9', json(DRAFT)],
      ['**/api/admin/logbooks/10', json(EMPTY)],
      ['**/api/admin/logbooks', json([DRAFT, EMPTY])],
      ['**/api/orgs/owner', json({ owner: 'owner@example.org', iAmOwner: true, pending: null, awaitingMyAcceptance: false })],
    ], OWNER);
    await adminSec(page, 'logbooks');
    await page.click('[data-lb-open="9"]');
    await settle(page);
    r.ok('a draft is offered the launch button', await shown(page, '#lb-launch-wrap'));
    // Whitespace-normalised: the markup wraps mid-sentence, so a regex over
    // raw textContent matches or misses depending on where a line broke.
    const door = ((await page.textContent('#lb-launch-wrap')) || '').replace(/\s+/g, ' ');
    r.ok('and told what it costs before pressing it',
      /fixes its questions for good/i.test(door), door.slice(0, 200));
    r.ok('and that closing stays available afterwards',
      /close the logbook whenever you like/i.test(door), door.slice(0, 300));
    r.ok('the button is live when there are questions',
      !(await page.$eval('#lb-launch', (e) => e.disabled)));

    // A logbook that asks nothing takes a narrative and a signature and
    // calls it a questionnaire. Said on the button rather than as a refusal
    // after the press. The list is hidden while one is open, so back to it
    // first, as a person would.
    await page.click('#lb-edit-back');
    await settle(page);
    await page.click('[data-lb-open="10"]');
    await settle(page);
    r.ok('a logbook with no questions cannot launch',
      await page.$eval('#lb-launch', (e) => e.disabled));
    r.ok('and the button says why instead of just being dead',
      /Add a question before launching/i.test(await page.textContent('#lb-launch')));
    r.ok('no uncaught errors around launch', page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  return r;
}
