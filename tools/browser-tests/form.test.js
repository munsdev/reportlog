/**
 * The report form: what choosing an answer does, what it must not do, and
 * the accessibility of every card along the way.
 *
 * Every report is filed through a logbook, so the form is a logbook's
 * questions plus the spine every report has — the publication answer, an
 * address, consent. The logbook here is a fixture; see lib.js.
 */
import {
  Report, openForm, card, next, pick, settle, axeOn, answerCard,
  FIXTURE_LOGBOOK, SECOND_LOGBOOK,
} from './lib.js';

export default async function run(browser) {
  const r = new Report('form');
  const posted = [];
  const page = await openForm(browser, { posted });
  const seen = new Set();
  const a11y = [];

  const scan = async () => {
    const id = await card(page);
    if (seen.has(id)) return;
    seen.add(id);
    for (const v of await axeOn(page, '.card.on')) a11y.push(`${id}: ${v}`);
  };

  await scan();
  await next(page);
  await scan();

  // ONE OPEN LOGBOOK IS SIMPLY USED. The chooser is a question only when
  // there is something to choose between.
  r.ok('with one logbook open, there is no "what are you reporting" card',
    await card(page) === 'lbf-role', await card(page));

  // Choosing an answer selects it and nothing else. This is the rule the
  // whole form is built around: the card you are looking at never changes
  // under you, and you move on when you say so.
  const before = await card(page);
  await pick(page, 'A voter');
  r.ok('choosing does not advance the card', await card(page) === before);
  r.ok('the chosen option carries a tick, not just a colour',
    (await page.evaluate(() => {
      const i = document.querySelector('.card.on .pick input:checked');
      return getComputedStyle(i.nextElementSibling, '::after').content;
    })).includes('✓'));
  r.ok('the tick sits on the left, like every other box on the form',
    await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('.picktile'), '::after');
      return parseFloat(s.left) < 40;
    }));

  // An error nobody is told about is an error nobody can fix.
  r.ok('the error box is a live region',
    await page.$eval('#carderr', (e) => e.getAttribute('role')) === 'alert');
  await next(page);
  await scan();
  await next(page);
  r.ok('an unanswered required question refuses to advance, and says why',
    Boolean((await page.$eval('#carderr', (e) => e.textContent)).trim())
    && await card(page) === 'lbf-state');
  await pick(page, 'Ohio');
  await next(page);
  await scan();
  r.ok('moving on moves the reading position to the new card',
    await page.evaluate(() => document.activeElement === document.querySelector('.card.on')));

  r.ok('a date question is a date control', await page.$eval('.card.on input', (e) => e.type) === 'date');
  await page.fill('.card.on input[type=date]', '2026-11-03');
  await next(page); await scan();

  // A multiple choice: real checkboxes, any number of them.
  r.ok('a choose-any question is real checkboxes',
    await page.$eval('.card.on .ticks input', (e) => e.type) === 'checkbox');
  r.ok('with their boxes on the left too',
    await page.evaluate(() => {
      const l = document.querySelector('.card.on .ticks label');
      return l.querySelector('input').getBoundingClientRect().left
        - l.getBoundingClientRect().left < 24;
    }));
  r.ok('no send button anywhere in the middle of the form',
    (await page.$$eval('#rform button', (bs) => bs.filter((b) =>
      /send report/i.test(b.textContent) && b.offsetParent !== null).length)) === 0);
  for (const i of [0, 1, 2, 3, 4]) await page.check(`.card.on .ticks label:nth-child(${i + 1}) input`);
  r.ok('several things can have gone wrong at one place',
    (await page.$$eval('.card.on .ticks input:checked', (a) => a.length)) === 5);
  await next(page); await scan();

  // An optional question says so, and can be walked past.
  r.ok('an optional question says it is optional',
    /Optional/.test(await page.$eval('.card.on', (e) => e.innerText)));
  await next(page);
  r.ok('and walking past it is allowed', await card(page) === 'lbf-account', await card(page));
  await scan();
  await page.fill('.card.on textarea', 'Five separate things went wrong here over the morning.');
  await next(page); await settle(page); await scan();

  // The publication question sits between the last question and the
  // review. Deliberately optional: this walks past it without choosing,
  // which is the path that has to record "no".
  r.ok('the publication question is asked before the review',
    await card(page) === 'publish', await card(page));
  const publishCard = await page.$eval('.card.on', (e) => e.innerText);
  r.ok('and it says publication is permanent', /permanent/i.test(publishCard), publishCard.slice(0, 80));
  r.ok('and that filing works either way', /either way/i.test(publishCard));
  r.ok('and it never calls itself consent', !/consent/i.test(publishCard));
  r.ok('and neither option is preselected',
    await page.$$eval('.card.on input[type="radio"]', (rs) => rs.every((x) => !x.checked)));

  await next(page); await settle(page); await scan();

  r.ok('the review reached', await card(page) === 'send', await card(page));
  const summary = await page.$eval('.card.on', (e) => e.innerText);
  r.ok('the review lists every question under its own words',
    FIXTURE_LOGBOOK.fields.every((f) => summary.toUpperCase().includes(f.label.toUpperCase())), summary.slice(0, 300));
  r.ok('and every choice ticked', ['Long lines', 'Equipment failure', 'Observer expelled',
    'Late opening', 'Untrained staff'].every((t) => summary.includes(t)));
  r.ok('and an optional question left alone as a dash, not "Not answered"',
    !/Not answered/.test(summary));
  r.ok('and states the publication answer rather than leaving it blank',
    /No, keep it out of the public archive/.test(summary));
  r.ok('and asks nothing the old built-in form asked',
    !/Reporting as|Saw it yourself|What you saw/.test(summary));

  const sendControls = await page.$$eval('#rform button', (bs) => bs
    .filter((b) => /send report/i.test(b.textContent) && b.offsetParent !== null)
    .map((b) => b.id || b.className));
  r.ok('the last card offers exactly one Send report control',
    sendControls.length === 1 && sendControls[0] === 'card-next', sendControls.join(', '));

  // The Change links go to the question they name, and come back.
  await page.click('.rrow[data-step="lbf-role"]');
  await settle(page);
  r.ok('Change goes to the question it names', await card(page) === 'lbf-role');
  await pick(page, 'An observer');
  await next(page);
  r.ok('and answering it returns you to the review', await card(page) === 'send', await card(page));
  r.ok('which now shows the new answer',
    /An observer/.test(await page.$eval('.card.on', (e) => e.innerText)));

  await page.click('.rrow[data-step="publish"]');
  await settle(page);
  await pick(page, 'Yes, it may be published');
  await next(page);
  r.ok('the publication answer can be changed from the review too',
    /Yes, it may be published/.test(await page.$eval('.card.on', (e) => e.innerText)));

  // All the way through.
  await page.fill('#rEmail', 'browser-tests@example.org');
  await page.check('#consent');
  await next(page);
  await page.waitForTimeout(500);
  const body = posted[0] || {};
  r.ok('the report is sent to the logbook it was filed through', body.logbook === FIXTURE_LOGBOOK.slug,
    JSON.stringify(body).slice(0, 200));
  r.ok('with its answers under their keys',
    body.answers?.role === 'An observer' && body.answers?.state === 'Ohio'
    && body.answers?.when === '2026-11-03' && body.answers?.what?.length === 5
    && /Five separate things/.test(body.answers?.account || ''), JSON.stringify(body.answers));
  r.ok('and the optional question left out rather than sent empty', !('stopped' in (body.answers || {})));
  r.ok('and the spine: address, consent, publication answer and its wording',
    body.email === 'browser-tests@example.org' && body.consent === true
    && body.may_publish === true && /^[a-f0-9]{64}$/.test(body.may_publish_digest || ''));
  r.ok('and none of the retired built-in keys',
    ['narrative', 'states', 'categories', 'incident_date', 'observer_status', 'severity']
      .every((k) => !(k in body)), Object.keys(body).join(','));

  // The form does not survive its own submission.
  const after = await page.evaluate(() => {
    const vis = (el) => Boolean(el && el.getBoundingClientRect().height > 0);
    return {
      receipt: vis(document.getElementById('receipt')),
      cards: vis(document.querySelector('#rcards')),
      nav: vis(document.querySelector('.cardnav')),
      email: (document.getElementById('receipt-email') || {}).textContent || '',
    };
  });
  r.ok('the confirmation replaces the form', after.receipt && !after.cards && !after.nav,
    JSON.stringify(after));
  r.ok('and says which address it went to', after.email === 'browser-tests@example.org', after.email);

  await page.click('#receipt-again');
  await page.waitForTimeout(400);
  const again = await page.evaluate(() => ({
    receipt: Boolean(document.getElementById('receipt').getBoundingClientRect().height),
    cards: Boolean(document.querySelector('#rcards').getBoundingClientRect().height),
    email: document.getElementById('rEmail').value,
  }));
  r.ok('filing another report gives a blank form back',
    !again.receipt && again.cards && again.email === '', JSON.stringify(again));

  r.note(`cards seen: ${[...seen].join(', ')}`);
  a11y.forEach((v) => r.ok(`axe: ${v}`, false));
  if (!a11y.length) r.ok('no WCAG A/AA violations on any card', true);
  r.ok('no uncaught page errors', page.pageErrors.length === 0, page.pageErrors.join('; '));
  await page.close();

  /* ---- two logbooks: the chooser ------------------------------------- */
  {
    const p = await openForm(browser, { logbooks: [FIXTURE_LOGBOOK, SECOND_LOGBOOK] });
    await next(p);
    r.ok('with two logbooks open, the first question is which', await card(p) === 'logbook');
    const tiles = await p.$$eval('.card.on .picktile b', (bs) => bs.map((b) => b.textContent));
    r.ok('and it offers exactly the open ones, with no general form beside them',
      tiles.join('|') === `${FIXTURE_LOGBOOK.title}|${SECOND_LOGBOOK.title}`, tiles.join('|'));
    await next(p);
    r.ok('it cannot be skipped', await card(p) === 'logbook');
    await pick(p, SECOND_LOGBOOK.title);
    await next(p);
    r.ok('choosing one asks that logbook’s questions', await card(p) === 'lbf-note', await card(p));
    await p.click('#card-back'); await settle(p);
    await pick(p, FIXTURE_LOGBOOK.title);
    await p.waitForTimeout(300);
    await next(p);
    r.ok('choosing again swaps the questions over', await card(p) === 'lbf-role', await card(p));
    r.ok('no uncaught page errors with a chooser', p.pageErrors.length === 0, p.pageErrors.join('; '));
    await p.close();
  }

  /* ---- no logbook open: no form -------------------------------------- */
  {
    const p = await openForm(browser, { logbooks: [] });
    const shown = await p.evaluate(() => ({
      notice: !document.getElementById('intake-closed').hidden,
      form: !document.getElementById('rform').hidden,
      why: document.getElementById('intake-closed-why').textContent,
    }));
    r.ok('with no logbook open, the form is replaced by a notice', shown.notice && !shown.form,
      JSON.stringify(shown));
    r.ok('which says nothing is open, not that somebody closed the site',
      /Nothing is open for reports/.test(shown.why), shown.why);
    await p.close();
  }
  return r;
}
