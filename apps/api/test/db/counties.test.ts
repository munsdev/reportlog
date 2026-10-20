/**
 * A county answer (owner decision 44), filed for real: sealed into a logbook
 * report as one string, and kept in a list entry, which never reaches a seal
 * or a chain. The election tips template (decision 45) is the list.
 */
import { buildAnswers } from '@reportlog/fields';
import type { FieldDefinition } from '@reportlog/fields';
import type { ListForm } from '@reportlog/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileEntry } from '../../src/lists/entries.ts';
import { createFromTemplate } from '../../src/lists/manage.ts';
import { DEFAULT_LIST_SETTINGS } from '../../src/lists/retention.ts';
import type { LinkKeys } from '../../src/links/keys.ts';
import { fileReport, launchedLogbook, uniqueSlug } from './helpers.ts';
import { address, as, harness, liftCurtain } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';
import { LINK_CONTACT_KEY, linkKeys } from './links-helpers.ts';

const WHERE: FieldDefinition[] = [
  { key: 'where', kind: 'location', label: 'Where', settings: { scope: 'us', depth: 'county' } },
];

let h: Harness;
let keys: LinkKeys;
beforeAll(async () => {
  h = await harness({ CONTACT_KEY: LINK_CONTACT_KEY });
  keys = await linkKeys(h.db);
});
afterAll(async () => {
  await liftCurtain(h.db);
  await h.close();
});

describe('a county in a logbook', () => {
  it('is sealed as one string, and the chain takes it', async () => {
    const lb = await launchedLogbook(h.db, WHERE);
    const { row } = await fileReport(h.db, lb, { where: 'us-az-04013' }, { questions: WHERE });
    const stored = await h.db
      .selectFrom('reports')
      .select(['answers', 'chain_hash'])
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(stored.answers).toEqual({ where: 'US-AZ-04013' });
    // A state on its own is still an answer at county depth: "Not sure which county".
    await fileReport(h.db, lb, { where: 'US-AZ' }, { questions: WHERE });
  });

  it('refuses a county that is not in its state, before anything is written', () => {
    expect(buildAnswers(WHERE, { where: 'US-CA-04013' }).answers?.where).toBeUndefined();
  });
});

describe('a county in a list', () => {
  it('the form says county depth, and an entry keeps the code and the date', async () => {
    const list = await createFromTemplate(h.db, 'election-tips', { slug: uniqueSlug('etips') });
    await h.db
      .updateTable('lists')
      .set({ visibility: 'listed' })
      .where('id', '=', list.id)
      .execute();
    const form = await as(h)({ method: 'GET', url: `/api/lists/${list.slug}` });
    expect(form.statusCode, form.body).toBe(200);
    const where = form.json<ListForm>().fields.find((f) => f.key === 'where');
    expect(where).toMatchObject({ kind: 'location', depth: 'county' });
    // The state list only: the counties are bundled in the page.
    expect(where?.places?.some((p) => p.code === 'US-AZ')).toBe(true);
    expect(where?.places?.some((p) => p.code.length > 5)).toBe(false);

    await fileEntry(
      h.db,
      list.slug,
      {
        answers: {
          links: 'https://example.org/county-post',
          where: 'US-PR-72127',
          day: '2026-11-03',
          category: 'Not sure',
        },
        email: address('county-tip'),
      },
      { settings: DEFAULT_LIST_SETTINGS, keys },
    );
    const entry = await h.db
      .selectFrom('list_entries')
      .select('answers')
      .where('list_id', '=', list.id)
      .executeTakeFirstOrThrow();
    expect(entry.answers).toMatchObject({ where: 'US-PR-72127', day: '2026-11-03' });
  });
});
