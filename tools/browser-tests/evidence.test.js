/**
 * The page a reporter answers an evidence request on.
 *
 * WHY IT NEEDS ITS OWN SUITE. It is the only page in this application that
 * a member of the public reaches with NO SIGN-IN, holding nothing but a
 * string from a mail — so what it shows and what it refuses to show is the
 * whole security story, and none of it is visible from the server tests.
 * src/routes/evidence.js is the door; this is what the door looks like.
 *
 * The endpoint is stubbed, for the same reason logbook.test.js stubs its
 * own: pointing this at a real request would make it pass or fail on
 * whatever happens to be in whichever database it is aimed at.
 */
import { BASE, Report } from './lib.js';

const json = (body, status = 200) => (route) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body),
});

const OPEN = {
  ok: true,
  message: 'Could you send the thirty seconds of the queue you mentioned? '
    + 'It would help us place the time.',
  askedAt: '2026-10-02T09:00:00.000Z',
  expiresAt: '2026-10-16T09:00:00.000Z',
  publicRef: 'RL-2026-ABCD',
  logbookTitle: 'Election incidents',
  uploads: true,
  maxFiles: 1,
  maxTotalBytes: 314572800,
  draftToken: 'a'.repeat(48),
};

const TOKEN = 'b'.repeat(48);

async function open(browser, body, status = 200) {
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**://*.google*/**', (r) => r.abort());
  await page.route('**://*.gstatic.com/**', (r) => r.abort());
  // Signed in to NOTHING. The whole point of the page is that it works
  // without an account, so this must not quietly be an authenticated test.
  await page.route('**/api/auth/me', json({ error: 'Not signed in' }, 401));
  await page.route(`**/api/evidence/${TOKEN}`, json(body, status));
  await page.goto(`${BASE}/evidence/${TOKEN}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  page.errors = errors;
  return page;
}

export default async function run(browser) {
  const r = new Report('answering a request for evidence');

  {
    const page = await open(browser, OPEN);
    const text = (await page.textContent('#pane-evidence')) || '';

    r.ok('the page opens from the link alone, with nobody signed in',
      Boolean(await page.$('#pane-evidence.active')));

    /* THE MODERATOR'S OWN WORDS, set apart from the site's. Set apart
       because somebody else is writing to the reporter and it must not
       read as the archive's own text. */
    r.ok('it shows what was asked for, in the words it was asked in',
      /thirty seconds of the queue/.test(text), text.slice(0, 160));
    r.ok('and sets those words apart from the page\'s own',
      Boolean(await page.$('#evidence-box .enote')));

    /* THE SENTENCE THAT MAKES THE WHOLE FEATURE HONEST. A mail asking a
       member of the public for photographs has to say, where they land,
       that they do not have to send anything. */
    r.ok('IT SAYS THEY DO NOT HAVE TO SEND ANYTHING',
      /do not have to send anything/i.test(text), text.slice(0, 200));
    r.ok('and how to stop being asked at all',
      /switching off/i.test(text) && /own page/i.test(text));

    // One file is a deliberate setting, so it is said in words rather than
    // as "1 files".
    r.ok('a one-file limit is said in words', /One file\./.test(text), text);
    r.ok('and it says the files are stripped before anybody sees them',
      /strips the location/.test(text));

    // NO REPORT TEXT. A guessed token must not become a way to read
    // somebody's account, and the page cannot show what it was never sent.
    r.ok('the page shows no answers from the report',
      !/turned the queue away|What happened/i.test(text));

    r.ok('there is a file picker and a Send button', Boolean(await page.$('#ev-file'))
      && Boolean(await page.$('#ev-send')));
    r.ok('and Send is disabled until something has finished uploading',
      await page.$eval('#ev-send', (e) => e.disabled),
      'a Send that fires with nothing staged is a button that fails');

    r.ok('no script errors', page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  {
    /* A CLOSED LINK. Several different refusals collapse into one sentence
       on purpose: "expired", "already used" and "withdrawn" are all just
       "no longer open" to somebody holding a stale mail, and telling them
       apart would let anybody with a guessed token learn that a report
       exists and something about its state. */
    const page = await open(browser, {
      error: 'This link is no longer open. If you still have something to send, '
        + 'the people reviewing your report can send you a new one.',
    }, 410);
    const text = (await page.textContent('#pane-evidence')) || '';
    r.ok('a closed link says so plainly', /no longer open/.test(text), text.slice(0, 140));
    r.ok('and says what to do about it', /can send you a new one/.test(text));
    r.ok('and offers no upload box at all', !(await page.$('#ev-file')),
      'a box that cannot work is worse than no box');
    r.ok('closed link: no script errors', page.errors.length === 0, page.errors.join(' | '));
    await page.close();
  }

  {
    /* The reporter's own switch, said plainly rather than collapsed —
       because it is theirs to turn back on, and "no longer open" would be
       misleading about something they control. */
    const page = await open(browser, {
      error: 'You have switched off being asked for evidence, so this link no longer '
        + 'works. You can switch it back on from your own page, and then ask for a new link.',
    }, 410);
    const text = (await page.textContent('#pane-evidence')) || '';
    r.ok('a withdrawn permission is explained, not collapsed',
      /switched off being asked/.test(text), text.slice(0, 160));
    r.ok('and says they can switch it back on', /switch it back on/.test(text));
    await page.close();
  }

  {
    // Storage off: no upload box, and the page says why rather than
    // offering one that fails.
    const page = await open(browser, { ...OPEN, uploads: false });
    const text = (await page.textContent('#pane-evidence')) || '';
    r.ok('with storage off, the page says so instead of offering a box',
      /not accepting files/.test(text) && !(await page.$('#ev-file')), text.slice(0, 160));
    r.ok('and still shows what was asked', /thirty seconds/.test(text));
    await page.close();
  }

  {
    // Several files allowed reads as "up to N" rather than "One file."
    const page = await open(browser, { ...OPEN, maxFiles: 4 });
    const text = (await page.textContent('#pane-evidence')) || '';
    r.ok('a several-file limit is said as a number', /Up to 4 files\./.test(text), text);
    await page.close();
  }

  return r;
}
