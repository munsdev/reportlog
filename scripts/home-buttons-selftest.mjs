/**
 * The front page's buttons, against a real database.
 *
 * The pure half is in the main suite — that the accent is a position, that
 * only a kind and a ref are stored. What needs a database is the part that
 * is about real logbooks and real lists appearing and disappearing, and in
 * particular the two rules that pull in opposite directions:
 *
 *   an entry naming something that is gone is SKIPPED;
 *   anything available and not named is APPENDED.
 *
 * THE SECOND ONE IS WHY THIS FILE EXISTS. Without it, arranging the front
 * page once quietly opts an operator out of every logbook they make
 * afterwards, and nothing anywhere says so — the kind of fault somebody
 * finds months later from a reporter asking where the form went. It cannot
 * be checked without creating a logbook after an arrangement was saved.
 *
 * And the tri-state: NULL is "nobody has arranged it" and gets the shipped
 * order; `[]` is an operator who removed every button and must get what
 * they asked for. Those are different answers and only a round-trip
 * through Postgres tells them apart, which is the same reason
 * attachment-settings-selftest.mjs exists.
 *
 *   npm run test:db
 */
import pg from 'pg';
import * as L from '../src/logbooks.js';
import {
  homeButtons, storedOrder, setHomeButtons, clearHomeButtons, availableButtons,
  HomeButtonRefusal, BUILTIN_REFS,
} from '../src/homeButtons.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass += 1; console.log('  ok   ' + n); }
  else { fail += 1; console.log('  FAIL ' + n + (x ? ' — ' + x : '')); }
};

const tag = `hb${Date.now().toString(36)}`;
await pool.query('INSERT INTO site_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING');
await clearHomeButtons();

/* A QUESTION BEFORE THE LAUNCH, because `launch` refuses a logbook that
   asks nothing — which is right, and which failed silently here until the
   first run of this script: `launch` answers `{ ok: false }` rather than
   throwing, so the logbook stayed a draft, never reached `openLogbooks`,
   and the failure presented as "the front page does not list my logbook". */
async function logbook(slug, title) {
  const out = await L.createLogbook({ title, slug, blurb: '' });
  const lb = out.ok ? out.logbook : await L.logbookBySlug(slug);
  const field = await L.addField(lb.id, {
    key: 'account', kind: 'long_text', label: 'What happened?', required: true,
  });
  if (!field.ok) throw new Error(`addField refused: ${field.reason}`);
  const launched = await L.launch(lb.id);
  if (!launched.ok) throw new Error(`launch refused: ${launched.reason}`);
  return lb;
}

const first = await logbook(`${tag}-one`, 'The first logbook');

console.log('\nan unarranged front page');

{
  const order = await storedOrder();
  ok('NULL is not an empty list, and means nobody has arranged it', order === null,
    JSON.stringify(order));

  const buttons = await homeButtons();
  ok('every open logbook is a button on it',
    buttons.some((b) => b.kind === 'logbook' && b.ref === first.slug),
    buttons.map((b) => b.ref).join(', '));
  ok('the board and the alert sign-up are on it too',
    buttons.some((b) => b.ref === 'board') && buttons.some((b) => b.ref === 'alerts'));
  ok('exactly one button is the accent, and it is the first',
    buttons.filter((b) => b.accent).length === 1 && buttons[0].accent === true);
  ok('and the generic Submit button is NOT there, because the logbooks are named',
    !buttons.some((b) => b.ref === 'submit'),
    buttons.map((b) => b.ref).join(', '));
}

console.log('\nthe order is the operator\'s, and so is the accent');

{
  await setHomeButtons([
    { kind: 'builtin', ref: 'board' },
    { kind: 'logbook', ref: first.slug },
  ]);
  const buttons = await homeButtons();
  ok('the first entry is the accent, whatever kind it is',
    buttons[0].ref === 'board' && buttons[0].accent === true,
    JSON.stringify(buttons.map((b) => [b.ref, b.accent])));
  ok('and nothing else is', buttons.filter((b) => b.accent).length === 1);
  ok('a removed built-in stays removed',
    !buttons.some((b) => b.ref === 'alerts'),
    buttons.map((b) => b.ref).join(', '));
}

console.log('\na logbook made AFTER the page was arranged');

{
  const later = await logbook(`${tag}-two`, 'Made afterwards');
  const buttons = await homeButtons();
  /* THE WHOLE POINT. A logbook that never reaches the front page is a form
     nobody can find, and the operator has no way to know that arranging
     the page once did that to them. */
  ok('is appended rather than left off the front page',
    buttons.some((b) => b.kind === 'logbook' && b.ref === later.slug),
    buttons.map((b) => b.ref).join(', '));
  ok('and goes after what was arranged, not in front of it',
    buttons[0].ref === 'board', buttons.map((b) => b.ref).join(', '));
  ok('and does not take the accent from the button the operator put first',
    buttons[0].accent === true && buttons.filter((b) => b.accent).length === 1);

  // A built-in is NOT appended. The asymmetry is deliberate: a logbook
  // appearing is the safe failure; a button the operator deleted coming
  // back is not.
  ok('a built-in the operator removed is still not put back',
    !buttons.some((b) => b.ref === 'alerts'));
}

console.log('\na logbook that closes');

{
  const gone = await logbook(`${tag}-three`, 'Closes again');
  await setHomeButtons([
    { kind: 'logbook', ref: gone.slug },
    { kind: 'logbook', ref: first.slug },
  ]);
  ok('is on the front page while it is open',
    (await homeButtons()).some((b) => b.ref === gone.slug));

  await L.setClosed(gone.id, true);
  const buttons = await homeButtons();
  ok('and drops off it when it closes, though the order still names it',
    !buttons.some((b) => b.ref === gone.slug),
    buttons.map((b) => b.ref).join(', '));
  ok('the accent moves to whatever is first now, rather than vanishing',
    buttons.length > 0 && buttons[0].accent === true
    && buttons.filter((b) => b.accent).length === 1);
  /* THE ORDER IS AN ORDER AND NOT A PERMISSION. The stored row still names
     the closed logbook — nothing rewrites an operator's arrangement behind
     their back — and reopening it would put the button back where they had
     put it. */
  ok('and the stored arrangement is left alone, so reopening restores its place',
    (await storedOrder()).some((e) => e.ref === gone.slug));
}

console.log('\nwhat a write refuses');

{
  const cases = [
    ['not a list', 'not-a-list', 'nope'],
    ['a button that does not exist', 'unknown-button',
      [{ kind: 'logbook', ref: 'no-such-logbook-anywhere' }]],
    ['a button listed twice', 'duplicate',
      [{ kind: 'builtin', ref: 'board' }, { kind: 'builtin', ref: 'board' }]],
    ['a kind that is not a kind', 'bad-entry', [{ kind: 'spaceship', ref: 'board' }]],
  ];
  for (const [what, reason, value] of cases) {
    let refused = null;
    try { await setHomeButtons(value); } catch (e) { refused = e; }
    ok(`${what} is refused, by name`,
      refused instanceof HomeButtonRefusal && refused.reason === reason,
      refused ? refused.reason : 'it was accepted');
  }

  /* REFUSED ON THE WAY IN RATHER THAN SKIPPED LATER. The read path skips an
     entry it cannot place, because a logbook can close after the page was
     arranged. The write path has the whole list in front of it, so an entry
     it cannot find is a panel sending something wrong — and storing it
     would mean an operator arranging a button that never appears. */
  ok('and a refused write changed nothing',
    (await storedOrder()).some((e) => e.ref === 'no-such-logbook-anywhere') === false);
}

console.log('\nan operator who removes every button');

{
  await setHomeButtons([]);
  const order = await storedOrder();
  ok('gets an empty list and not the shipped order',
    Array.isArray(order) && order.length === 0, JSON.stringify(order));
  const buttons = await homeButtons();
  /* The append rule still runs, so the logbooks come back — which is
     correct and worth saying out loud: "no buttons" cannot mean "no way to
     file", because a logbook with no front-page button is a form nobody can
     find. What an empty arrangement really removes is the built-ins. */
  ok('but the logbooks are still appended, so the page is never a dead end',
    buttons.some((b) => b.kind === 'logbook'), buttons.map((b) => b.ref).join(', '));
  ok('and the built-ins stay gone, which is what an empty list can remove',
    !buttons.some((b) => BUILTIN_REFS.includes(b.ref)),
    buttons.map((b) => b.ref).join(', '));
}

console.log('\nback to the shipped order');

{
  await clearHomeButtons();
  ok('is NULL again, not an empty list', (await storedOrder()) === null);
  const buttons = await homeButtons();
  ok('and the built-ins are back', buttons.some((b) => b.ref === 'board'));
}

console.log('\nwhat the panel is offered');

{
  const avail = await availableButtons();
  ok('every open logbook', avail.logbooks.some((b) => b.ref === first.slug));
  ok('the built-ins, including the generic Submit button an operator may want back',
    avail.builtins.some((b) => b.ref === 'submit'));
  ok('and a list is offered as a list, not as a logbook',
    avail.lists.every((b) => b.kind === 'list'));
  ok('a closed logbook is not offered',
    !avail.logbooks.some((b) => b.ref === `${tag}-three`));
}

await clearHomeButtons();
await pool.end();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
