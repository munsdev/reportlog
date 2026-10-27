/**
 * A small world to test against: the logbooks, lists, reports, tips and
 * people a real deployment holds, filled with MARKER strings so a test can
 * tell whether any of what a reporter typed came back out where it should not.
 *
 * Two tests build on it:
 *   test/db/public-sweep.test.ts   seeds it into the shared database and asks
 *                                  every public route for the markers;
 *   test/db/upgrade.test.ts        its rows were written once, on the
 *                                  database as it was before the free-text
 *                                  work (test/db/upgrade-fixture.build.ts),
 *                                  and are replayed from test/upgrade/.
 *
 * TO ADD A CASE, add the thing here (a report of a new kind, a list with a
 * new question) and give it a marker in MARKERS. The sweep picks it up from
 * there. For the upgrade fixture, see the header of upgrade-fixture.build.ts:
 * it says how to write the rows again.
 *
 * Nothing here knows what a later migration adds. It files through the same
 * routes and helpers the other tests use, so a code change that needs a new
 * table is a change to those, not to this.
 */
import type { FieldDefinition } from '@reportlog/fields';
import { recordCardTexts } from '../../src/consent/cards.ts';
import type { Database } from '../../src/db/database.ts';
import { fileEntry } from '../../src/lists/entries.ts';
import { createFromParsed, createFromTemplate } from '../../src/lists/manage.ts';
import { parseListTemplate } from '../../src/lists/templates.ts';
import { DEFAULT_LIST_SETTINGS } from '../../src/lists/retention.ts';
import * as L from '../../src/logbooks/logbooks.ts';
import { setCountsOnly } from '../../src/moderation/switches.ts';
import { createFromStartingPoint } from '../../src/logbooks/templates.ts';
import { loadLinkKeys } from '../../src/links/keys.ts';
import { checkGroup, commentGroup } from '../../src/links/checks.ts';
import { threadOf, tokenFor } from '../db/filing-helpers.ts';
import type { FilingHarness } from '../db/filing-helpers.ts';
import { CONTACT_KEY, fileOnArrival, send, spine } from '../db/filing-helpers.ts';
import { seat } from '../db/identity-helpers.ts';
import { approve, correctThread, fileThread } from '../db/moderation-helpers.ts';

/**
 * Everything a reporter or a tipster typed, and everything a public page must
 * never repeat. ONE LIST. A new kind of text or link (a private text answer, a
 * report link, a redacted copy) is a new entry here and nothing else.
 *
 * `value` is what was typed. A marker is searched for exactly as typed and
 * in the forms a page could carry it in (see `forms` in public-sweep.test.ts).
 */
export interface Marker {
  /** What kind of thing it is, for the failure message. */
  kind: string;
  value: string;
  /**
   * Set ONLY for a value that is on a public page today, by an old rule that
   * the new work is meant to end. The reason is the text. The sweep lets it
   * through and then requires that it still is, so the day the page stops
   * showing it the flag has to come off (and that is the good news).
   */
  publicToday?: string;
}

export const MARKERS = {
  answerShort: { kind: 'a short text answer', value: 'zqmark short answer 4471' },
  answerLong: { kind: 'a long text answer', value: 'zqmark long answer about the queue 9120' },
  answerEmail: { kind: 'an email typed as an answer', value: 'zqmark-answer@marker.test' },
  answerUrl: { kind: 'a link typed as an answer', value: 'https://zqmark-answer.marker.test/page' },
  correctedLong: {
    kind: 'a corrected text answer',
    value: 'zqmark corrected answer 5532',
  },
  reportContact: { kind: 'a reporter contact address', value: 'zqmark-reporter@marker.test' },
  waitingContact: { kind: 'a waiting reporter address', value: 'zqmark-waiting@marker.test' },
  tipLink: { kind: 'a tip link', value: 'https://zqmark-tip.marker.test/post/77' },
  tipLink2: { kind: 'a second tip link', value: 'https://zqmark-tip2.marker.test/post/78' },
  tipDescription: { kind: 'a tip description', value: 'zqmark tip description 3381' },
  tipContact: { kind: 'a tipster address', value: 'zqmark-tipster@marker.test' },
  electionLink: { kind: 'an election tip link', value: 'https://zqmark-election.marker.test/e/1' },
  electionContact: { kind: 'an election tipster address', value: 'zqmark-etip@marker.test' },
  volunteerName: { kind: 'a volunteer name', value: 'zqmark Volunteer Name 6604' },
  volunteerNote: { kind: 'a volunteer note', value: 'zqmark volunteer note 8815' },
  volunteerContact: { kind: 'a volunteer address', value: 'zqmark-volunteer@marker.test' },
  journalistContact: { kind: 'a journalist address', value: 'zqmark-journalist@marker.test' },
  moderatorContact: { kind: 'a moderator address', value: 'zqmark-moderator@marker.test' },
  // A logbook that publishes its reports one by one and has a typed question:
  // the answer is on the board and the verify page today (decision 42 never
  // said otherwise). Spec D17 says it must not be unless the logbook turns
  // it on. Not closed yet, so named here rather than hidden.
  listedShort: {
    kind: 'a short text answer in a logbook that lists its reports',
    value: 'zqmark listed short answer 7742',
    publicToday: 'D17 is not built: a listed logbook shows typed answers',
  },
  listedLong: {
    kind: 'a long text answer in a logbook that lists its reports',
    value: 'zqmark listed long answer 1963',
    publicToday: 'D17 is not built: a listed logbook shows typed answers',
  },
  tipComment: { kind: 'a moderator comment on a link', value: 'zqmark moderator comment 2290' },
} as const satisfies Record<string, Marker>;

/** A general logbook with one question of each kind a person types into. */
export const TYPED_QUESTIONS: FieldDefinition[] = [
  { key: 'what', kind: 'long_text', label: 'What happened?', required: true },
  { key: 'headline', kind: 'short_text', label: 'In a few words' },
  { key: 'reply_to', kind: 'email', label: 'Another address' },
  { key: 'page', kind: 'url', label: 'A page about it' },
  { key: 'size', kind: 'choice_one', label: 'How big?', settings: { options: ['small', 'large'] } },
];

const VOLUNTEERS = {
  reportlog_list: 1,
  slug: 'volunteers',
  title: 'Volunteer',
  blurb: 'Offer to help.',
  email: 'required',
  fields: [
    { key: 'name', kind: 'short_text', label: 'Your name', required: true, retention: 'transient' },
    {
      key: 'role',
      kind: 'choice_one',
      label: 'How would you like to help?',
      required: true,
      retention: 'durable',
      settings: { options: ['Checking links', 'Translating', 'Something else'] },
    },
    { key: 'note', kind: 'long_text', label: 'Anything else', retention: 'transient' },
  ],
};

export interface World {
  slugs: {
    voting: string;
    general: string;
    listed: string;
    tips: string;
    election: string;
    volunteers: string;
  };
  /** Public references by what became of the report. */
  refs: {
    votingPublished: string;
    votingProblem: string;
    votingWithdrawn: string;
    published: string;
    corrected: string;
    correctedFirst: string;
    withdrawn: string;
    listedPublished: string;
    unreviewed: string;
    declined: string;
    confirmedByRoute: string;
  };
  /** The report that has been sent and is waiting for its link to be followed. */
  waiting: { email: string; token: string };
  people: { journalist: string; moderator: string };
}

const VOTING_FINE = {
  outcome: 'fine',
  method: 'election_day',
  state: 'AZ',
  county: '04013',
  date: '2026-11-03',
  hour: 9,
  role: 'voter',
  wait: 'under_30',
};
const VOTING_PROBLEM = {
  outcome: 'problem',
  method: 'mail',
  state: 'LA',
  county: '22071',
  date: '2026-10-28',
  problems: ['arrived_late', 'rejected'],
  voted: 'no',
};

export interface SeedOptions {
  /** Prefixed to every slug, so a shared database can hold several worlds. */
  stem: string;
}

/**
 * Fill a database. `h.app` must be built over `h.db` with a CONTACT_KEY (the
 * filing harness does). Slugs are `${stem}-voting` and so on.
 */
export async function seedWorld(
  h: Pick<FilingHarness, 'db' | 'app' | 'mailer'>,
  { stem }: SeedOptions,
): Promise<World> {
  const { db } = h;
  const M = MARKERS;
  await recordCardTexts(db);
  const keys = await loadLinkKeys(db, CONTACT_KEY);
  const slugs = {
    voting: `${stem}-voting`,
    general: `${stem}-general`,
    listed: `${stem}-listed`,
    tips: `${stem}-tips`,
    election: `${stem}-election`,
    volunteers: `${stem}-volunteers`,
  };

  // ── the voting logbook, from its starting point ────────────────────────
  const voting = await createFromStartingPoint(db, {
    starting_point: 'how-voting-went',
    title: 'Log how voting went',
    slug: slugs.voting,
  });
  await L.launch(db, voting.id);
  const votingPublished = await fileOnArrival(asHarness(h), slugs.voting, VOTING_FINE);
  const votingProblem = await fileOnArrival(asHarness(h), slugs.voting, VOTING_PROBLEM);
  const votingWithdrawn = await fileOnArrival(asHarness(h), slugs.voting, {
    ...VOTING_FINE,
    hour: 14,
  });
  await approve(db, await threadOf(db, votingPublished));
  await approve(db, await threadOf(db, votingWithdrawn));
  await withdraw(db, await threadOf(db, votingWithdrawn));

  // ── a general logbook with every kind of typed question ────────────────
  // Set to publish as counts only, the way the live logbook is: its reports
  // are counted and shown nowhere one by one (board/published.ts).
  const general = await launchedLogbookNamed(db, slugs.general);
  await setCountsOnly(db, general, true, 'demo-admin@example.test');
  const answers = (what: string, extra: Record<string, unknown> = {}) => ({
    what,
    headline: M.answerShort.value,
    reply_to: M.answerEmail.value,
    page: M.answerUrl.value,
    size: 'large',
    ...extra,
  });
  const fresh = (what: string) => fileThread(db, general, TYPED_QUESTIONS, answers(what));

  const published = await fresh(M.answerLong.value);
  await approve(db, published.threadId);

  const first = await fresh('first wording of a report');
  const second = await correctThread(
    db,
    general,
    TYPED_QUESTIONS,
    first,
    answers(M.correctedLong.value),
  );
  await approve(db, first.threadId);

  const withdrawn = await fresh('a report the person took back');
  await approve(db, withdrawn.threadId);
  await withdraw(db, withdrawn.threadId);

  const unreviewed = await fresh('not looked at yet');
  const declined = await fresh('turned down');
  await db
    .updateTable('report_heads')
    .set({ moderation_status: 'invalid' })
    .where('thread_id', '=', declined.threadId)
    .execute();

  // A second one that does list its reports, and holds typed answers (see
  // `publicToday` above).
  const listed = await launchedLogbookNamed(db, slugs.listed);
  const listedPublished = await fileThread(db, listed, TYPED_QUESTIONS, {
    what: MARKERS.listedLong.value,
    headline: MARKERS.listedShort.value,
  });
  await approve(db, listedPublished.threadId);

  // Through the routes, with an address: sent, confirmed, then approved.
  const confirmedEmail = M.reportContact.value;
  const sent = await send(asHarness(h), {
    ...spine(confirmedEmail),
    logbook: slugs.general,
    answers: answers('sent with an address and confirmed'),
  });
  if (sent.status !== 200) throw new Error(`sending failed: ${JSON.stringify(sent.body)}`);
  const confirmToken = tokenFor(h.mailer, confirmedEmail);
  if (!confirmToken) throw new Error('no confirmation link was emailed');
  const done = await h.app.inject({ method: 'POST', url: `/api/reports/confirm/${confirmToken}` });
  const confirmedRef = done.json<{ confirmation: { public_ref?: string } }>().confirmation
    .public_ref;
  if (!confirmedRef) throw new Error(`confirming failed: ${done.body}`);
  await approve(db, await threadOf(db, confirmedRef));

  // And one that is sent and never confirmed: the link has not been followed.
  const waitingEmail = M.waitingContact.value;
  const wait = await send(asHarness(h), {
    ...spine(waitingEmail),
    logbook: slugs.general,
    answers: answers('sent and waiting for its link'),
  });
  if (wait.status !== 200) throw new Error(`sending failed: ${JSON.stringify(wait.body)}`);
  const waitingToken = tokenFor(h.mailer, waitingEmail);
  if (!waitingToken) throw new Error('no confirmation link was emailed');

  // ── lists: tips (a description and links), election tips, volunteers ───
  const tips = await createFromTemplate(db, 'tips', { slug: slugs.tips });
  const election = await createFromTemplate(db, 'election-tips', { slug: slugs.election });
  const volunteers = await createFromParsed(db, parseListTemplate(VOLUNTEERS), {
    slug: slugs.volunteers,
  });
  for (const l of [tips, election, volunteers]) {
    await db.updateTable('lists').set({ visibility: 'listed' }).where('id', '=', l.id).execute();
  }
  const file = (slug: string, input: Parameters<typeof fileEntry>[2]) =>
    fileEntry(db, slug, input, { settings: DEFAULT_LIST_SETTINGS, keys });
  await file(slugs.tips, {
    answers: {
      links: [M.tipLink.value, M.tipLink2.value],
      state: 'Not sure',
      category: 'Not sure',
      description: M.tipDescription.value,
    },
    email: M.tipContact.value,
  });
  await file(slugs.tips, {
    answers: { links: M.tipLink.value, state: 'Not sure', category: 'Not sure' },
  });
  await file(slugs.election, {
    answers: {
      links: M.electionLink.value,
      where: 'US-AZ-04013',
      day: '2026-11-03',
      category: 'Long lines or wait times',
    },
    email: M.electionContact.value,
  });
  await file(slugs.volunteers, {
    answers: { name: M.volunteerName.value, role: 'Checking links', note: M.volunteerNote.value },
    email: M.volunteerContact.value,
    emailConsent: true,
  });
  // A moderator has looked at one link and left a comment (links/checks.ts).
  const groups = await db.selectFrom('link_groups').select('id').orderBy('id').execute();
  const [checked, , lastGroup] = groups;
  if (checked) {
    await checkGroup(db, keys, checked.id, { outcome: 'checked', actor: M.moderatorContact.value });
    await commentGroup(db, checked.id, {
      body: M.tipComment.value,
      actor: M.moderatorContact.value,
    });
  }
  if (lastGroup)
    await checkGroup(db, keys, lastGroup.id, {
      outcome: 'withheld',
      actor: M.moderatorContact.value,
    });

  // ── people ──────────────────────────────────────────────────────────────
  await seat(db, M.moderatorContact.value, 'moderator');
  await seat(db, M.journalistContact.value, 'journalist');

  return {
    slugs,
    refs: {
      votingPublished,
      votingProblem,
      votingWithdrawn,
      published: published.publicRef,
      corrected: second.publicRef,
      correctedFirst: first.publicRef,
      withdrawn: withdrawn.publicRef,
      listedPublished: listedPublished.publicRef,
      unreviewed: unreviewed.publicRef,
      declined: declined.publicRef,
      confirmedByRoute: confirmedRef,
    },
    waiting: { email: waitingEmail, token: waitingToken },
    people: { journalist: M.journalistContact.value, moderator: M.moderatorContact.value },
  };
}

/** The filing helpers want a harness; they use db, app and mailer. */
function asHarness(h: Pick<FilingHarness, 'db' | 'app' | 'mailer'>): FilingHarness {
  return { ...h, logs: [], close: () => Promise.resolve() };
}

async function withdraw(db: Database, threadId: string): Promise<void> {
  await db
    .updateTable('report_heads')
    .set({ withdrawn: true })
    .where('thread_id', '=', threadId)
    .execute();
}

/** A launched logbook at a slug of our choosing (`launchedLogbook` picks its own). */
async function launchedLogbookNamed(db: Database, slug: string) {
  const lb = await db
    .insertInto('logbooks')
    .values({ slug, title: `Logbook ${slug}` })
    .returning(['id', 'slug'])
    .executeTakeFirstOrThrow();
  for (const [position, q] of TYPED_QUESTIONS.entries()) {
    await db
      .insertInto('logbook_fields')
      .values({
        logbook_id: lb.id,
        key: q.key,
        kind: q.kind,
        label: q.label,
        help: q.help ?? null,
        required: Boolean(q.required),
        shown_when: q.shown_when ? JSON.stringify(q.shown_when) : null,
        settings: JSON.stringify(q.settings ?? {}),
        position,
      })
      .execute();
  }
  await db
    .updateTable('logbooks')
    .set({ launched_at: new Date() })
    .where('id', '=', lb.id)
    .execute();
  return lb;
}
