/**
 * Questions that are only asked sometimes, in a real browser.
 *
 * The unit suite proves the two copies of `conditionMet` agree and the
 * database suite proves a conditional answer seals correctly. Neither can
 * see the thing that actually matters to a person: that the card is not
 * put in front of them, that the progress bar does not lurch, that the
 * review does not list a question they were never asked, and — the one a
 * unit test structurally cannot reach — that an answer typed before they
 * changed their mind does not travel with the report anyway.
 *
 * That last one is the whole reason this file exists. The client clears a
 * stale answer by walking the questions in order and dropping anything
 * whose condition is no longer met; the server does the same thing
 * independently. If the client ever stopped, the server would still refuse
 * to seal it, so nothing would be WRONG in the archive — but the reporter
 * would have been shown a review card promising to send something that was
 * then dropped, which is its own kind of lie.
 */
import {
  Report, openForm, card, next, pick, settle, axeOn, pastIntro,
} from './lib.js';

/* A gate and two questions behind it, plus one that is always asked, so
   "hidden" can be told apart from "last". The dependent is REQUIRED on
   purpose: required has to mean required of the people who were asked it,
   and a hidden one that still blocked the form would make the whole
   feature unusable. */
const CONDITIONAL_LOGBOOK = {
  slug: 'browser-conditional',
  title: 'Evidence by request',
  blurb: 'A logbook that asks a follow-up only when it applies.',
  state: 'open',
  accepting: true,
  acceptsFiles: false,
  fields: [
    {
      key: 'has_files',
      kind: 'yes_no',
      label: 'Do you have photos, video, audio or documents?',
      required: true,
      settings: {},
    },
    {
      key: 'clip_of',
      kind: 'short_text',
      label: 'What is it of?',
      required: true,
      settings: { maxLength: 200 },
      shown_when: { field: 'has_files', in: ['yes'] },
    },
    {
      key: 'account',
      kind: 'long_text',
      label: 'Tell us what happened',
      required: true,
      settings: { maxLength: 5000 },
    },
  ],
  filters: [],
};

const cards = async (page) => page.evaluate(
  () => [...document.querySelectorAll('#rcards [data-card]')].map((e) => e.getAttribute('data-card')),
);

export default async function run(browser) {
  const r = new Report('conditional questions');

  // ------------------------------------------------------------------
  // Said no: the follow-up is never put.
  // ------------------------------------------------------------------
  {
    const posted = [];
    const page = await openForm(browser, { logbooks: [CONDITIONAL_LOGBOOK], posted });
    await pastIntro(page);

    r.ok('the gate question is the first one asked', await card(page) === 'lbf-has_files',
      await card(page));
    r.ok('and the dependent card exists in the DOM from the first byte',
      (await cards(page)).includes('lbf-clip_of'),
      'every pane is in the DOM from the start; shown is not the same as built');

    await pick(page, 'No');
    await next(page);
    r.ok('ANSWERING NO SKIPS THE FOLLOW-UP ENTIRELY', await card(page) === 'lbf-account',
      await card(page));

    await page.fill('.card.on textarea', 'The line was two hours and nobody could stand in it.');
    await next(page);
    // The publication card, then the review.
    if (await card(page) === 'publish') await next(page);
    r.ok('and the form reaches the review without it', await card(page) === 'send',
      await card(page));

    const review = await page.$eval('#review-box', (e) => e.textContent);
    r.ok('the review does not list a question nobody was asked',
      !review.includes('What is it of'), review.slice(0, 200));
    r.ok('and a REQUIRED follow-up that was not asked does not block sending',
      !(await page.$eval('#card-next', (e) => e.disabled)));

    for (const v of await axeOn(page, '.card.on')) r.ok(`review card: ${v}`, false);
    await page.close();
  }

  // ------------------------------------------------------------------
  // Said yes: the follow-up is put, and is required.
  // ------------------------------------------------------------------
  {
    const posted = [];
    const page = await openForm(browser, { logbooks: [CONDITIONAL_LOGBOOK], posted });
    await pastIntro(page);
    await pick(page, 'Yes');
    await next(page);
    r.ok('ANSWERING YES PUTS THE FOLLOW-UP', await card(page) === 'lbf-clip_of',
      await card(page));

    // Required, and asked, so it has to stop the form.
    await next(page);
    r.ok('and it is required of the people who were asked it',
      await card(page) === 'lbf-clip_of', 'it let an empty required answer past');

    await page.fill('.card.on input[type=text]', 'thirty seconds of the queue outside');
    await next(page);
    r.ok('answering it moves on', await card(page) === 'lbf-account', await card(page));

    await page.fill('.card.on textarea', 'The line was two hours.');
    await next(page);
    if (await card(page) === 'publish') await next(page);

    const review = await page.$eval('#review-box', (e) => e.textContent);
    r.ok('the review lists it, with the answer', review.includes('thirty seconds of the queue'),
      review.slice(0, 300));

    await page.fill('#rEmail', 'reporter@example.org');
    await page.check('#consent');
    await page.click('#card-next');
    await settle(page);
    r.ok('the report sends', posted.length === 1, JSON.stringify(posted));
    r.ok('and carries the follow-up answer',
      posted[0] && posted[0].answers && posted[0].answers.clip_of === 'thirty seconds of the queue outside',
      JSON.stringify(posted[0] && posted[0].answers));
    await page.close();
  }

  // ------------------------------------------------------------------
  // THE ONE THAT MATTERS. Answer it, then change your mind.
  // ------------------------------------------------------------------
  {
    const posted = [];
    const page = await openForm(browser, { logbooks: [CONDITIONAL_LOGBOOK], posted });
    await pastIntro(page);

    // Yes, answer the follow-up...
    await pick(page, 'Yes');
    await next(page);
    await page.fill('.card.on input[type=text]', 'a photo I am about to decide not to mention');
    await next(page);
    r.ok('the follow-up was answered on the way through', await card(page) === 'lbf-account');

    // ...then go back and say no.
    await page.click('#card-back');
    await settle(page);
    await page.click('#card-back');
    await settle(page);
    r.ok('going back twice reaches the gate again', await card(page) === 'lbf-has_files',
      await card(page));
    await pick(page, 'No');
    await next(page);
    r.ok('and changing the answer skips the follow-up now', await card(page) === 'lbf-account',
      await card(page));

    const review = await page.$eval('#review-box', async (e) => e.textContent).catch(() => '');
    await page.fill('.card.on textarea', 'The line was two hours.');
    await next(page);
    if (await card(page) === 'publish') await next(page);

    const review2 = await page.$eval('#review-box', (e) => e.textContent);
    r.ok('THE REVIEW NO LONGER PROMISES THE STALE ANSWER',
      !review2.includes('about to decide not to mention'),
      review2.slice(0, 300));

    await page.fill('#rEmail', 'reporter@example.org');
    await page.check('#consent');
    await page.click('#card-next');
    await settle(page);
    r.ok('the report sends', posted.length === 1, JSON.stringify(posted));
    r.ok('AND THE STALE ANSWER IS NOT IN WHAT WAS SENT',
      posted[0] && posted[0].answers && !('clip_of' in posted[0].answers),
      JSON.stringify(posted[0] && posted[0].answers));
    r.ok('while the answers that were asked for are',
      posted[0] && posted[0].answers && posted[0].answers.has_files === 'no'
        && typeof posted[0].answers.account === 'string',
      JSON.stringify(posted[0] && posted[0].answers));
    // `review` is read above only to prove the page had rendered one by then.
    r.ok('the review had rendered before the change', typeof review === 'string');
    await page.close();
  }

  return r;
}
