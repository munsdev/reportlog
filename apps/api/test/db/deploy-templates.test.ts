/**
 * Applying a deployment template, against a real database and the real app.
 * The site half of legacy/scripts/template-selftest.mjs (B ported the
 * logbook half in templates.test.ts).
 *
 * The claim the feature rests on: APPLYING A TEMPLATE WRITES ORDINARY
 * SETTINGS, ADDS AT MOST ONE DRAFT LOGBOOK, AND THEN HAS NO FURTHER EFFECT,
 * and it does not disturb a logbook or a report already there. So this files
 * a report into a launched logbook first, applies templates over the top,
 * and checks that the logbook and the report are exactly as they were.
 *
 * Every switch is read back through the module that owns it, not from its
 * column, so the test is of what the site will actually do.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storedPublicArchive } from '../../src/board/publication.ts';
import { verifyReport } from '../../src/chain/verify.ts';
import { recordCardTexts } from '../../src/consent/cards.ts';
import { siteLayer } from '../../src/files/limits.ts';
import { storedIntakeSwitch } from '../../src/filing/intakeSwitch.ts';
import * as L from '../../src/logbooks/logbooks.ts';
import { templateLogbook } from '../../src/logbooks/templates.ts';
import { readCopy, readSettings } from '../../src/site/settings.ts';
import {
  TEMPLATES,
  applyTemplate,
  applyTemplateDefinition,
  templateById,
} from '../../src/site/templates.ts';
import { fileReport, uniqueSlug } from './helpers.ts';
import { addStoredQuestion } from '../support/stored-questions.ts';
import { address, as, harness, seat, signIn } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';

let h: Harness;
const ADMIN = address('templates-admin');
const BY = 'templates-test@example.org';

const verifies = (v: Awaited<ReturnType<typeof verifyReport>>) =>
  v?.content.ok === true && v.link.ok && v.position.ok;

/** What the site will do, read through each owner's own module. */
async function switches() {
  return {
    publicArchive: await storedPublicArchive(h.db),
    attachments: (await siteLayer(h.db)).enabled,
    intake: await storedIntakeSwitch(h.db),
  };
}
const copyOf = async () =>
  Object.fromEntries((await readCopy(h.db)).map((r) => [r.key, r.body])) as Record<string, string>;
const record = () =>
  h.db
    .selectFrom('site_settings')
    .select(['template_applied', 'template_applied_at'])
    .where('id', '=', true)
    .executeTakeFirstOrThrow();

let own: { id: number; slug: string };
let ownBefore: string;
let filedRef: string;
// Put back afterwards, so the files after this one find the site as it was.
let saved: {
  settings: Awaited<ReturnType<typeof readSettings>>;
  copy: { key: string; body: string }[];
  switches: Awaited<ReturnType<typeof switches>>;
};

beforeAll(async () => {
  h = await harness();
  await recordCardTexts(h.db);
  saved = {
    settings: await readSettings(h.db),
    copy: await readCopy(h.db),
    switches: await switches(),
  };
  // Starting where a fresh deployment starts: nobody has chosen anything.
  await h.db.deleteFrom('site_copy').execute();

  const lb = await L.createLogbook(h.db, { title: 'Ours, first', slug: uniqueSlug('tpl-own') });
  await addStoredQuestion(h.db, lb.id, { kind: 'long_text', label: 'What happened', key: 'what' });
  await L.launch(h.db, lb.id);
  own = lb;
  const questions = L.toDefinitions(await L.fieldsFor(h.db, lb.id));
  const r = await fileReport(
    h.db,
    lb,
    { what: 'Filed before any template was applied.' },
    { questions },
  );
  filedRef = r.row.public_ref;
  ownBefore = JSON.stringify(await L.fieldsFor(h.db, own.id));
});

afterAll(async () => {
  const { settings, copy, switches: s } = saved;
  await h.db
    .updateTable('site_settings')
    .set({
      site_name: settings.site_name,
      palette: settings.palette,
      theme: settings.theme,
      template_applied: null,
      template_applied_at: null,
    })
    .where('id', '=', true)
    .execute();
  await h.db.deleteFrom('site_copy').execute();
  if (copy.length) await h.db.insertInto('site_copy').values(copy).execute();
  await h.db
    .updateTable('moderation_settings')
    .set({ public_archive_enabled: s.publicArchive })
    .execute();
  await h.db.updateTable('file_settings').set({ attachments_enabled: s.attachments }).execute();
  await h.db.updateTable('intake_settings').set({ intake_enabled: s.intake }).execute();
  await h.close();
});

describe('the report filed before any template', () => {
  it('verifies before anything is applied', async () => {
    expect(verifies(await verifyReport(h.db, filedRef))).toBe(true);
  });
});

describe('applying the general template', () => {
  let made: Awaited<ReturnType<typeof applyTemplate>>;

  it('applies', async () => {
    made = await applyTemplate(h.db, 'general', BY);
    expect(made.applied).toBe('general');
  });

  it('makes the logbook its file describes, AS A DRAFT, with every question in order', async () => {
    const file = templateLogbook('general');
    expect(made.logbook?.slug).toBe(file.slug);
    const lb = await L.logbookBySlug(h.db, file.slug ?? '');
    // Launching is never done on anybody's behalf.
    expect(lb?.state).toBe('draft');
    expect(lb?.asks_for_files).toBe(true);
    const qs = await L.fieldsFor(h.db, made.logbook?.id ?? 0);
    // The file says it takes files, which becomes an upload question at the end.
    expect(qs.map((q) => q.key)).toEqual([...file.questions.map((q) => q.key), 'attachments']);
  });

  it('sets the switches it names, each where its own screen would', async () => {
    expect(await switches()).toEqual({ publicArchive: false, attachments: true, intake: true });
    // Recorded as set by somebody, the way each screen records it.
    const by = await h.db
      .selectFrom('moderation_settings')
      .select('public_archive_set_by')
      .executeTakeFirstOrThrow();
    expect(by.public_archive_set_by).toBe(BY);
  });

  it('writes the page text it carries', async () => {
    expect((await copyOf()).home_intro).toMatch(/^File a report\./);
  });

  it('records which template was applied, and when, for the record only', async () => {
    const r = await record();
    expect(r.template_applied).toBe('general');
    expect(r.template_applied_at).not.toBeNull();
  });

  it('leaves an ordinary logbook behind: it gains a written question like any other', async () => {
    const id = made.logbook?.id ?? 0;
    await addStoredQuestion(h.db, id, {
      kind: 'long_text',
      label: 'Anything else, in your own words?',
    });
    expect((await L.fieldsFor(h.db, id)).at(-1)?.kind).toBe('long_text');
  });
});

describe('applying it again', () => {
  it('makes a SECOND draft rather than touching the first, which may be launched by now', async () => {
    const again = await applyTemplate(h.db, 'general', BY);
    expect(again.logbook?.slug).toBe(`${templateLogbook('general').slug ?? ''}-2`);
  });
});

describe('what a template must never touch', () => {
  it('leaves a logbook that was already there exactly as it was, still launched', async () => {
    expect(JSON.stringify(await L.fieldsFor(h.db, own.id))).toBe(ownBefore);
    expect((await L.logbookById(h.db, own.id))?.state).not.toBe('draft');
  });

  it('and the report filed at the start STILL VERIFIES', async () => {
    expect(verifies(await verifyReport(h.db, filedRef))).toBe(true);
  });

  it('never writes the imprint or the privacy policy', async () => {
    await h.db
      .updateTable('site_settings')
      .set({ impressum_text: 'Our own imprint.', privacy_text: 'Our own policy.' })
      .where('id', '=', true)
      .execute();
    for (const t of TEMPLATES) await applyTemplate(h.db, t.id, BY);
    const s = await readSettings(h.db);
    expect([s.impressum_text, s.privacy_text]).toEqual(['Our own imprint.', 'Our own policy.']);
    await h.db
      .updateTable('site_settings')
      .set({
        impressum_text: saved.settings.impressum_text,
        privacy_text: saved.settings.privacy_text,
      })
      .where('id', '=', true)
      .execute();
  });

  it('and no shipped template sets the look or the name', async () => {
    // A starting point answers what kind of archive this is, not what it
    // looks like; and the wizard asks the name first. The keys exist, which
    // is exactly why this is checked and not assumed.
    for (const t of TEMPLATES) {
      expect(Object.keys(t.settings), t.id).not.toContain('palette');
      expect(Object.keys(t.settings), t.id).not.toContain('theme');
      expect(Object.keys(t.settings), t.id).not.toContain('siteName');
    }
    await h.db
      .updateTable('site_settings')
      .set({ site_name: 'Kept By Hand', palette: 'midnight', theme: 'plain' })
      .where('id', '=', true)
      .execute();
    await applyTemplate(h.db, 'workplace', BY);
    const s = await readSettings(h.db);
    expect([s.site_name, s.palette, s.theme]).toEqual(['Kept By Hand', 'midnight', 'plain']);
  });
});

describe('starting from nothing', () => {
  it('clears every piece of page text, makes no logbook, and leaves the name', async () => {
    await applyTemplate(h.db, 'workplace', BY);
    expect(Object.keys(await copyOf()).length).toBeGreaterThan(0);
    const before = (await L.listLogbooks(h.db)).length;
    const out = await applyTemplate(h.db, 'blank', BY);
    expect(out).toEqual({ applied: 'blank' });
    expect(await copyOf()).toEqual({});
    expect((await L.listLogbooks(h.db)).length).toBe(before);
    expect((await readSettings(h.db)).site_name).toBe('Kept By Hand');
    expect(await switches()).toEqual({ publicArchive: false, attachments: false, intake: true });
  });
});

describe('a template that is refused', () => {
  it('an unknown one, rather than partly applied', async () => {
    await expect(applyTemplate(h.db, 'no_such_template', BY)).rejects.toMatchObject({
      status: 404,
    });
    expect(templateById('workplace')).not.toBeNull();
  });

  it('one with a value its owner would refuse, before a row is written', async () => {
    const before = { record: await record(), switches: await switches() };
    await expect(
      applyTemplateDefinition(
        h.db,
        {
          id: 'mine',
          label: 'Mine',
          description: '',
          settings: { publicArchive: true, palette: 'no-such-palette' },
        },
        BY,
      ),
    ).rejects.toMatchObject({ status: 400, message: /palette/ });
    expect({ record: await record(), switches: await switches() }).toEqual(before);
  });

  it('page text with a number that would not work, as the wording screen refuses it', async () => {
    await expect(
      applyTemplateDefinition(
        h.db,
        {
          id: 'mine',
          label: 'Mine',
          description: '',
          settings: { copy: { home_intro: 'We hold {{ no_such_figure }} reports.' } },
        },
        BY,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect((await copyOf()).home_intro).toBeUndefined();
  });

  it('ALL OR NOTHING: one that fails at its very last write leaves nothing written', async () => {
    // The record's CHECK refuses this id, and the record is the last thing
    // written: every setting and the draft logbook before it must go too.
    const before = {
      record: await record(),
      switches: await switches(),
      copy: await copyOf(),
      logbooks: (await L.listLogbooks(h.db)).length,
      name: (await readSettings(h.db)).site_name,
    };
    await expect(
      applyTemplateDefinition(
        h.db,
        {
          id: 'Not A Valid Id',
          label: 'Broken at the end',
          description: '',
          settings: {
            siteName: 'Half Applied',
            publicArchive: true,
            attachments: true,
            intake: false,
            copy: { home_intro: 'Written, then taken back.' },
            logbook: 'workplace',
          },
        },
        BY,
      ),
    ).rejects.toThrow();
    expect({
      record: await record(),
      switches: await switches(),
      copy: await copyOf(),
      logbooks: (await L.listLogbooks(h.db)).length,
      name: (await readSettings(h.db)).site_name,
    }).toEqual(before);
  });
});

describe('over HTTP', () => {
  let session = '';
  beforeAll(async () => {
    await seat(h.db, ADMIN, 'admin');
    session = await signIn(h, ADMIN);
  });

  it('lists every template with what it would change, and what was applied last', async () => {
    const res = await as(h, session)({ method: 'GET', url: '/api/admin/templates' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      templates: { id: string; sets: string[] }[];
      applied: { id: string } | null;
    }>();
    expect(body.templates.map((t) => t.id)).toEqual(TEMPLATES.map((t) => t.id));
    expect(body.applied?.id).toBe('blank');
    const general = body.templates.find((t) => t.id === 'general');
    expect(general?.sets).toContain('Takes files with reports');
    expect(general?.sets.some((l) => l.includes('and a place for files'))).toBe(true);
    const choices = body.templates.find((t) => t.id === 'voting-log');
    expect(choices?.sets).toContain('Takes no files');
    expect(choices?.sets.some((l) => l.includes('all of them choices and no files'))).toBe(true);
  });

  it('applies one, and says which draft it made', async () => {
    const res = await as(
      h,
      session,
    )({
      method: 'POST',
      url: '/api/admin/templates',
      payload: { template: 'workplace' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      applied: 'workplace',
      logbook: { title: 'Incident reports' },
    });
  });

  it('refuses an unknown one with a sentence', async () => {
    const res = await as(
      h,
      session,
    )({
      method: 'POST',
      url: '/api/admin/templates',
      payload: { template: 'nope' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: 'no_such_template', message: 'There is no such template.' },
    });
  });

  it('is an administrator’s: nobody signed out, nobody without the role', async () => {
    const stranger = await h.app.inject({
      method: 'POST',
      url: '/api/admin/templates',
      payload: { template: 'blank' },
    });
    expect(stranger.statusCode).toBe(401);
    const plain = address('templates-nobody');
    const res = await as(
      h,
      await signIn(h, plain),
    )({
      method: 'POST',
      url: '/api/admin/templates',
      payload: { template: 'blank' },
    });
    expect(res.statusCode).toBe(403);
    expect((await record()).template_applied).toBe('workplace');
  });
});
