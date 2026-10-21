/**
 * ElectionLog's logbook and tip list (docs/electionlog-questionnaires.md),
 * from the shipped presets, filed for real through the routes:
 *
 *   the site starting point makes the draft logbook and the hidden tip list,
 *     with uploads off and the public archive on;
 *   every path through the logbook files and verifies: in person fine, in
 *     person with a problem, by mail with a problem, from overseas with a
 *     problem;
 *   the server refuses what §01 says it refuses: a hidden answer, a code from
 *     another method's list, a county outside its state, an unknown key;
 *   after launch a label may be reworded and a code may not, by the module
 *     and by the database; a report keeps the form version it was asked;
 *   the tip list refuses a type without a link, a link without a type, more
 *     than three rows and any other field, keeps each link's type on its own
 *     row, and asks for no email.
 */
import { withoutWording } from '@reportlog/fields';
import type { FieldSettings } from '@reportlog/fields';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storedPublicArchive } from '../../src/board/publication.ts';
import { verifyReport } from '../../src/chain/verify.ts';
import { recordCardTexts } from '../../src/consent/cards.ts';
import { siteLayer } from '../../src/files/limits.ts';
import { fileEntry } from '../../src/lists/entries.ts';
import { ListRefusal } from '../../src/lists/refusals.ts';
import { DEFAULT_LIST_SETTINGS } from '../../src/lists/retention.ts';
import { checkedLinks, linksForEntries } from '../../src/links/reads.ts';
import type { LinkKeys } from '../../src/links/keys.ts';
import * as L from '../../src/logbooks/logbooks.ts';
import { createFromStartingPoint } from '../../src/logbooks/templates.ts';
import { applyTemplateDefinition, templateById } from '../../src/site/templates.ts';
import type { Template } from '../../src/site/templates.ts';
import { filingHarness, fileThroughRoutes, send, spine } from './filing-helpers.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { uniqueSlug } from './helpers.ts';
import { address } from './identity-helpers.ts';
import { linkKeys } from './links-helpers.ts';

let h: FilingHarness;
let keys: LinkKeys;
let slug: string;
let logbookId: number;

beforeAll(async () => {
  h = await filingHarness();
  await recordCardTexts(h.db);
  keys = await linkKeys(h.db);
  const made = await createFromStartingPoint(h.db, {
    starting_point: 'electionlog',
    title: 'Log how voting went',
    slug: uniqueSlug('electionlog'),
  });
  await L.launch(h.db, made.id);
  slug = made.slug;
  logbookId = made.id;
});
afterAll(async () => {
  await h.close();
});

const IN_PERSON_FINE = {
  outcome: 'fine',
  method: 'election_day',
  state: 'AZ',
  county: '04013',
  date: '2026-11-03',
  hour: 9,
  role: 'voter',
  wait: 'under_30',
};

const verifies = async (ref: string) => {
  const v = await verifyReport(h.db, ref);
  return v?.content.ok === true && v.link.ok && v.position.ok;
};

const answersOf = async (ref: string) =>
  (
    await h.db
      .selectFrom('reports')
      .select('answers')
      .where('public_ref', '=', ref)
      .executeTakeFirstOrThrow()
  ).answers;

describe('the site starting point', () => {
  it('makes the draft logbook and the hidden tip list, uploads off, archive on', async () => {
    const before = {
      archive: await storedPublicArchive(h.db),
      files: (await siteLayer(h.db)).enabled,
    };
    const shipped = templateById('electionlog') as Template;
    // The shipped one names /list/tips; another test file may hold that
    // address, so this applies the same settings at an address of its own.
    const listSlug = uniqueSlug('tips');
    const t: Template = {
      ...shipped,
      settings: { ...shipped.settings, list: { template: 'electionlog-tips', slug: listSlug } },
    };
    try {
      const out = await applyTemplateDefinition(h.db, t, 'electionlog-test@example.org');
      const lb = await L.logbookBySlug(h.db, out.logbook?.slug ?? '');
      expect(lb?.state).toBe('draft');
      expect(lb?.asks_for_files).toBe(false);
      const list = await h.db
        .selectFrom('lists')
        .select(['visibility', 'strict', 'title'])
        .where('slug', '=', listSlug)
        .executeTakeFirstOrThrow();
      expect(list).toEqual({ visibility: 'hidden', strict: true, title: 'Send a link' });
      expect(await storedPublicArchive(h.db)).toBe(true);
      expect((await siteLayer(h.db)).enabled).toBe(false);
      const q = await h.db
        .selectFrom('site_copy')
        .select('body')
        .where('key', '=', 'submit_question')
        .executeTakeFirst();
      expect(q?.body).toBe('What do you want to do?');
    } finally {
      await h.db
        .updateTable('moderation_settings')
        .set({ public_archive_enabled: before.archive })
        .execute();
      await h.db.updateTable('file_settings').set({ attachments_enabled: before.files }).execute();
      await h.db.deleteFrom('site_copy').where('key', '=', 'submit_question').execute();
    }
  });

  it('refuses the whole template when /list/tips is taken, writing nothing', async () => {
    const shipped = templateById('electionlog') as Template;
    const taken = uniqueSlug('taken');
    await h.db.insertInto('lists').values({ slug: taken, title: 'Taken' }).execute();
    const drafts = async () =>
      (await h.db.selectFrom('logbooks').select('id').where('launched_at', 'is', null).execute())
        .length;
    const n = await drafts();
    await expect(
      applyTemplateDefinition(
        h.db,
        {
          ...shipped,
          settings: { ...shipped.settings, list: { template: 'electionlog-tips', slug: taken } },
        },
        'electionlog-test@example.org',
      ),
    ).rejects.toThrow(/already uses that web address/);
    expect(await drafts()).toBe(n);
  });
});

describe('every path through the logbook', () => {
  it('in person, fine: no problem cards, sealed codes, verifies', async () => {
    const ref = await fileThroughRoutes(h, slug, IN_PERSON_FINE, address('el-ip-fine'));
    expect(await answersOf(ref)).toEqual(IN_PERSON_FINE);
    expect(await verifies(ref)).toBe(true);
  });

  it('in person, a problem, with the approximate hour ticked', async () => {
    const answers = {
      ...IN_PERSON_FINE,
      outcome: 'problem',
      method: 'early',
      hour: 0,
      hour_approx: true,
      role: 'poll_worker',
      wait: 'left',
      problems: ['other', 'turned_away', 'wrong_ballot'],
      voted: 'provisional',
    };
    const ref = await fileThroughRoutes(h, slug, answers, address('el-ip-problem'));
    // Sealed in the list's order, whatever order was sent.
    expect(await answersOf(ref)).toEqual({
      ...answers,
      problems: ['turned_away', 'wrong_ballot', 'other'],
    });
    expect(await verifies(ref)).toBe(true);
  });

  it('by mail, a problem: no hour, role or wait; the mail list', async () => {
    const answers = {
      outcome: 'problem',
      method: 'mail',
      state: 'LA',
      county: '22071',
      date: '2026-10-28',
      problems: ['arrived_late', 'rejected'],
      voted: 'no',
    };
    const ref = await fileThroughRoutes(h, slug, answers, address('el-mail'));
    expect(await answersOf(ref)).toEqual(answers);
    expect(await verifies(ref)).toBe(true);
  });

  it('from overseas, a problem: the overseas list, a territory county', async () => {
    const answers = {
      outcome: 'problem',
      method: 'overseas',
      state: 'GU',
      county: '66010',
      date: '2026-10-20',
      problems: ['fwab', 'other'],
      voted: 'prefer_not',
    };
    const ref = await fileThroughRoutes(h, slug, answers, address('el-overseas'));
    expect(await answersOf(ref)).toEqual(answers);
    expect(await verifies(ref)).toBe(true);
  });
});

describe('the server checks (§01)', () => {
  const refused = async (answers: Record<string, unknown>, stem: string) => {
    const r = await send(h, { ...spine(address(stem)), logbook: slug, answers });
    expect(r.status).toBe(400);
    return (r.body.error as { message: string }).message;
  };

  it('refuses a field sent when its "only if" does not hold', async () => {
    const mail = {
      outcome: 'fine',
      method: 'mail',
      state: 'AZ',
      county: '04013',
      date: '2026-11-03',
    };
    expect(await refused({ ...mail, hour: 9 }, 'el-hidden-hour')).toContain('is not asked (Hour)');
    expect(await refused({ ...mail, role: 'voter' }, 'el-hidden-role')).toContain('is not asked');
    expect(
      await refused({ ...IN_PERSON_FINE, problems: ['other'] }, 'el-hidden-problems'),
    ).toContain('is not asked');
    expect(await refused({ ...mail, hour_approx: true }, 'el-hidden-approx')).toContain(
      'is not asked',
    );
  });

  it('refuses a code from another method’s list, and provisional by mail', async () => {
    const mail = {
      outcome: 'problem',
      method: 'mail',
      state: 'AZ',
      county: '04013',
      date: '2026-11-03',
      voted: 'no',
    };
    expect(await refused({ ...mail, problems: ['police'] }, 'el-other-list')).toContain(
      'What went wrong? Tick everything that applies. must be one of the choices offered',
    );
    expect(
      await refused({ ...mail, problems: ['other'], voted: 'provisional' }, 'el-provisional'),
    ).toContain('Did you vote? must be one of the choices offered');
  });

  it('refuses a county outside its state, an hour of 24, a label for a code, an unknown key', async () => {
    expect(await refused({ ...IN_PERSON_FINE, state: 'NM' }, 'el-county')).toContain('County');
    expect(await refused({ ...IN_PERSON_FINE, hour: 24 }, 'el-hour')).toContain('Hour');
    expect(await refused({ ...IN_PERSON_FINE, outcome: 'It went fine' }, 'el-label')).toContain(
      'How did it go?',
    );
    expect(await refused({ ...IN_PERSON_FINE, note: 'hello' }, 'el-unknown')).toContain(
      'did not ask for (note)',
    );
    expect(await refused({ ...IN_PERSON_FINE, hour_approx: false }, 'el-approx-false')).toContain(
      'Approximate',
    );
  });

  it('needs the hour in person, and does not need it by mail', async () => {
    const { hour: _hour, ...noHour } = IN_PERSON_FINE;
    expect(await refused(noHour, 'el-no-hour')).toContain('Hour is needed');
  });
});

describe('after launch: wording may change, codes may not (ruling 48)', () => {
  const field = async (key: string) =>
    (await L.fieldsFor(h.db, logbookId)).find((f) => f.key === key) as L.Question & {
      settings: FieldSettings;
    };

  it('rewords a question and an option label, as a new form version; earlier reports keep theirs', async () => {
    const before = await fileThroughRoutes(h, slug, IN_PERSON_FINE, address('el-before-reword'));
    const formOf = async (ref: string) =>
      (
        await h.db
          .selectFrom('reports')
          .select('form_id')
          .where('public_ref', '=', ref)
          .executeTakeFirstOrThrow()
      ).form_id;
    const outcome = await field('outcome');
    const versions = async () =>
      (
        await h.db
          .selectFrom('logbook_forms')
          .select('id')
          .where('logbook_id', '=', logbookId)
          .execute()
      ).length;
    const n = await versions();
    const updated = await L.updateField(h.db, logbookId, outcome.id, {
      label: 'How did voting go?',
      settings: {
        options: [
          { code: 'fine', label: 'It went well' },
          { code: 'problem', label: 'Something went wrong' },
        ],
      },
    });
    expect(updated.label).toBe('How did voting go?');
    expect(await versions()).toBe(n + 1);
    const after = await fileThroughRoutes(h, slug, IN_PERSON_FINE, address('el-after-reword'));
    expect(await formOf(after)).not.toBe(await formOf(before));
    expect(await verifies(before)).toBe(true);
    expect(await verifies(after)).toBe(true);
  });

  it('seals the version the page showed when only its wording has changed since', async () => {
    const page = await h.app.inject({ method: 'GET', url: `/api/logbooks/${slug}` });
    const shown = page.json<{ form: string }>().form;
    const wait = await field('wait');
    await L.updateField(h.db, logbookId, wait.id, {
      settings: {
        options: (wait.settings.options ?? []).map((o) =>
          typeof o === 'string' ? o : o.code === 'not_sure' ? { ...o, label: 'I am not sure' } : o,
        ),
      },
    });
    const ref = await fileThroughRoutes(h, slug, IN_PERSON_FINE, address('el-shown'), {
      form: shown,
    });
    const row = await h.db
      .selectFrom('reports as r')
      .innerJoin('logbook_forms as f', 'f.id', 'r.form_id')
      .select('f.form_hash')
      .where('r.public_ref', '=', ref)
      .executeTakeFirstOrThrow();
    expect(row.form_hash).toBe(shown);
    expect(await verifies(ref)).toBe(true);
  });

  it('refuses a changed code, a removed option, required, a condition, through the module', async () => {
    const outcome = await field('outcome');
    for (const change of [
      {
        settings: {
          options: [
            { code: 'ok', label: 'It went well' },
            { code: 'problem', label: 'x' },
          ],
        },
      },
      { settings: { options: [{ code: 'fine', label: 'It went well' }] } },
      { required: false },
      { shown_when: { field: 'method', in: ['mail'] } },
    ]) {
      await expect(L.updateField(h.db, logbookId, outcome.id, change)).rejects.toMatchObject({
        code: expect.stringMatching(/^launched/) as unknown,
      });
    }
  });

  it('is held by the database: wording passes, anything else is refused', async () => {
    const problems = await field('problems');
    const id = problems.id;
    const set = (s: unknown) =>
      h.db
        .updateTable('logbook_fields')
        .set({ settings: JSON.stringify(s) })
        .where('id', '=', id)
        .execute();
    const sets = problems.settings.option_sets ?? [];
    // A label inside an option set, and the help: wording.
    const reworded = {
      ...problems.settings,
      option_sets: sets.map((s, i) =>
        i === 1
          ? {
              ...s,
              options: s.options.map((o) =>
                typeof o === 'string' ? o : { ...o, label: `${o.label}.` },
              ),
            }
          : s,
      ),
    };
    await expect(set(reworded)).resolves.toBeDefined();
    await expect(
      h.db.updateTable('logbook_fields').set({ help: 'Every one.' }).where('id', '=', id).execute(),
    ).resolves.toBeDefined();
    // A code inside a set, a set's condition, the order of a set, a key, a kind, required.
    const recoded = {
      ...reworded,
      option_sets: reworded.option_sets.map((s, i) =>
        i === 1
          ? {
              ...s,
              options: s.options.map((o) =>
                typeof o === 'string' ? o : { ...o, code: `${o.code}_x` },
              ),
            }
          : s,
      ),
    };
    await expect(set(recoded)).rejects.toThrow(/never changed, only reworded/);
    await expect(
      set({
        ...reworded,
        option_sets: reworded.option_sets.map((s, i) =>
          i === 1 ? { ...s, when: { field: 'method', in: ['overseas'] } } : s,
        ),
      }),
    ).rejects.toThrow(/never changed/);
    await expect(
      set({
        ...reworded,
        option_sets: reworded.option_sets.map((s, i) =>
          i === 1 ? { ...s, options: [...s.options].reverse() } : s,
        ),
      }),
    ).rejects.toThrow(/never changed/);
    for (const change of [
      { key: 'problems_2' },
      { kind: 'choice_one' },
      { required: false },
      { position: 99 },
    ]) {
      await expect(
        h.db.updateTable('logbook_fields').set(change).where('id', '=', id).execute(),
      ).rejects.toThrow(/never changed/);
    }
    await expect(h.db.deleteFrom('logbook_fields').where('id', '=', id).execute()).rejects.toThrow(
      /never removed/,
    );
  });

  it('agrees with withoutWording on what is wording', async () => {
    for (const q of await L.fieldsFor(h.db, logbookId)) {
      const { rows } = await sql<{
        s: unknown;
      }>`SELECT form_settings_without_wording(${JSON.stringify(q.settings)}::jsonb) AS s`.execute(
        h.db,
      );
      expect(rows[0]?.s).toEqual(withoutWording(q.settings as FieldSettings));
    }
  });
});

describe('the tip list (§04)', () => {
  let listSlug: string;
  beforeAll(async () => {
    listSlug = uniqueSlug('el-tips');
    const { createFromTemplate } = await import('../../src/lists/manage.ts');
    await createFromTemplate(h.db, 'electionlog-tips', { slug: listSlug });
  });
  const file = (links: unknown, extra: Record<string, unknown> = {}) =>
    fileEntry(
      h.db,
      listSlug,
      { answers: { links, ...extra } },
      { settings: DEFAULT_LIST_SETTINGS, keys },
    );
  const reason = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'filed';
    } catch (e) {
      if (e instanceof ListRefusal) return e.code;
      throw e;
    }
  };

  it('takes one to three rows, asks no email, keeps each link’s type on its own row', async () => {
    const out = await file([
      { url: 'https://example.org/el/video', type: 'video' },
      { url: '', type: '' },
      { url: 'https://example.org/el/notice', type: 'official' },
    ]);
    expect(out.email).toBeNull();
    expect(out.erasureToken).toBeNull();
    const links = await linksForEntries(h.db, keys, [out.id]);
    expect(links.map((l) => [l.url, l.link_type])).toEqual([
      ['https://example.org/el/video', 'video'],
      ['https://example.org/el/notice', 'official'],
    ]);
    // Nothing else is kept: the entry's answers hold no link and no type.
    const row = await h.db
      .selectFrom('list_entries')
      .select(['answers', 'erasable_answers', 'email_enc'])
      .where('id', '=', out.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ answers: {}, erasable_answers: null, email_enc: null });
  });

  it.each([
    ['a type without a link', [{ url: '', type: 'video' }], 'type-without-link'],
    ['a link without a type', [{ url: 'https://example.org/el/a', type: '' }], 'link-without-type'],
    [
      'a type not on the list',
      [{ url: 'https://example.org/el/b', type: 'meme' }],
      'not-an-option',
    ],
    [
      'more than three rows',
      [1, 2, 3, 4].map((i) => ({ url: `https://example.org/el/r${String(i)}`, type: 'post' })),
      'too-many-values',
    ],
    [
      'row 1 empty',
      [
        { url: '', type: '' },
        { url: 'https://example.org/el/c', type: 'post' },
      ],
      'missing-required',
    ],
    ['nothing at all', [], 'missing-required'],
    [
      'a row with another field',
      [{ url: 'https://example.org/el/d', type: 'post', note: 'x' }],
      'not-a-link-row',
    ],
  ])('refuses %s', async (_name, links, code) => {
    expect(await reason(file(links))).toBe(code);
  });

  it('refuses any other field: the list is strict', async () => {
    expect(
      await reason(file([{ url: 'https://example.org/el/e', type: 'post' }], { comment: 'hello' })),
    ).toBe('not-asked');
  });

  it('a lenient list still drops a stray key, as before', async () => {
    const { createFromTemplate } = await import('../../src/lists/manage.ts');
    const lenient = await createFromTemplate(h.db, 'tips', { slug: uniqueSlug('lenient') });
    const out = await fileEntry(
      h.db,
      lenient.slug,
      {
        answers: {
          links: 'https://example.org/el/lenient',
          state: 'Not sure',
          category: 'Not sure',
          stray: 'dropped',
        },
      },
      { settings: DEFAULT_LIST_SETTINGS, keys },
    );
    expect(out.answers).toEqual({ state: 'Not sure', category: 'Not sure' });
  });

  it('the desk shows the type beside the checked link, by its label', async () => {
    const out = await file([{ url: 'https://example.org/el/desk', type: 'livestream' }]);
    const [link] = await linksForEntries(h.db, keys, [out.id]);
    await h.db
      .updateTable('link_groups')
      .set({ outcome: 'checked', checked_at: new Date(), checked_by: 'mod@example.org' })
      .where('id', '=', link?.group_id ?? 0)
      .execute();
    const groups = await checkedLinks(h.db, keys, { groupIds: [link?.group_id ?? 0] });
    expect(groups[0]?.types).toEqual([
      { entry_id: out.id, field_key: 'links', type: 'livestream' },
    ]);
    const { deskLinkPage } = await import('../../src/journalists/desk.ts');
    const page = await deskLinkPage(h.db, keys, 'reader@example.org', 1);
    const shown = page.links.find((l) => l.url === 'https://example.org/el/desk');
    expect(shown?.context).toEqual([
      { question: 'Kind of link', answers: [{ answer: 'Livestream', tips: 1 }] },
    ]);
  });
});
