/**
 * Rotating CONTACT_KEY against real encrypted rows: reporters' reports, a
 * coordinator's filing, a report filed during the two-key window, and an
 * erased report whose key is gone and must stay gone.
 *
 * The design is in docs/status/C2-filing.md.
 */
import { cardFor } from '@reportlog/seal';
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emailDigest, keyringFrom, openContact } from '../../src/filing/contactKeys.ts';
import { rotateContactKey } from '../../src/filing/rotateContactKey.ts';
import { fingerprint } from '../../src/jobs/contact-key.ts';
import { loadLinkKeys, matchKey, rewrapLinkSecret } from '../../src/links/keys.ts';
import { launchedLogbook } from './helpers.ts';
import { CONTACT_KEY, fileThroughRoutes, filingHarness, threadOf } from './filing-helpers.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { address, as, seat, signIn } from './identity-helpers.ts';

const OLD = CONTACT_KEY;
const NEW = randomBytes(32).toString('base64');
const OLD_RING = keyringFrom(OLD);
const NEW_RING = keyringFrom(NEW);
const WINDOW_RING = keyringFrom(NEW, OLD);

let before: FilingHarness; // the site as it ran on the old key
let lb: { id: number; slug: string };
const REPORTER = address('rotating');
const ERASER = address('erased');
const COORD = address('rot-coord');
const threads: Record<string, string> = {};

type Snapshot = Map<string, { dek: string; hmac: string | null; contact: string }>;
async function snapshot(h: FilingHarness): Promise<Snapshot> {
  const rows = await h.db
    .selectFrom('report_contacts as c')
    .leftJoin('contact_keys as k', 'k.thread_id', 'c.thread_id')
    .select(['c.thread_id', 'k.dek_wrapped', 'k.email_hmac', 'c.contact_enc'])
    .execute();
  return new Map(
    rows.map((r) => [
      r.thread_id,
      {
        dek: r.dek_wrapped ? r.dek_wrapped.toString('hex') : '',
        hmac: r.email_hmac,
        contact: r.contact_enc.toString('hex'),
      },
    ]),
  );
}

beforeAll(async () => {
  before = await filingHarness({ contactKey: OLD });
  lb = await launchedLogbook(before.db, [
    { key: 'what', kind: 'long_text', label: 'What happened?', required: true },
  ]);
  threads.reporter = await threadOf(
    before.db,
    await fileThroughRoutes(before, lb.slug, { what: 'One.' }, REPORTER),
  );
  threads.reporter2 = await threadOf(
    before.db,
    await fileThroughRoutes(before, lb.slug, { what: 'Two.' }, REPORTER),
  );
  // An erased report: filed, then its contact details erased by its reporter.
  threads.erased = await threadOf(
    before.db,
    await fileThroughRoutes(before, lb.slug, { what: 'Gone.' }, ERASER),
  );
  const eraser = as(before, await signIn(before, ERASER));
  const erased = await eraser({
    method: 'POST',
    url: `/api/mine/reports/${threads.erased}/erase`,
    payload: { confirm: true },
  });
  expect(erased.statusCode).toBe(200);
  // A coordinator's filing: an address with no digest.
  const uid = await seat(before.db, COORD, 'user');
  const org = await before.db
    .insertInto('organizations')
    .values({
      name: `Rotation Org ${String(process.pid)}-${String(Date.now() % 1e6)}`,
      verified_by: 'x',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await before.db
    .insertInto('organization_memberships')
    .values({ organization_id: org.id, user_id: uid, role: 'coordinator' })
    .execute();
  const coord = as(before, await signIn(before, COORD));
  const batch = (
    await coord({
      method: 'POST',
      url: '/api/intake/batches',
      payload: { organization_id: org.id },
    })
  ).json<{ id: number }>().id;
  await coord({
    method: 'POST',
    url: `/api/intake/batches/${String(batch)}/drafts`,
    payload: {
      logbook: lb.slug,
      answers: { what: 'On paper.' },
      intake_method: 'paper',
      may_publish: false,
      may_publish_digest: cardFor('coordinator').digest,
    },
  });
  const filed = (
    await coord({
      method: 'POST',
      url: `/api/intake/batches/${String(batch)}/submit`,
      payload: { attested: true },
    })
  ).json<{ filed: { public_ref: string }[] }>();
  threads.coordinator = await threadOf(before.db, filed.filed[0]?.public_ref ?? '');
});
afterAll(async () => {
  // Every file shares this database and the test key: rotate back, so the
  // files after this one find every row under the key they hold. (It is
  // also a second rotation, the other way.)
  await rotateContactKey(before.db, { current: OLD, previous: NEW });
  await before.close();
});

describe('the guard on contact_keys', () => {
  it('still refuses an UPDATE outside a rotation', async () => {
    await expect(
      before.db
        .updateTable('contact_keys')
        .set({ dek_wrapped: Buffer.from('nope') })
        .where('thread_id', '=', threads.reporter ?? '')
        .execute(),
    ).rejects.toThrow(/never changed/);
  });

  it('inside a rotation, refuses giving a coordinator’s filing a digest, or moving a key', async () => {
    for (const attempt of [
      // A digest where there was none: it would put a coordinator's filing in somebody's "My reports".
      sql`UPDATE contact_keys SET email_hmac = ${'a'.repeat(64)} WHERE thread_id = ${threads.coordinator}`,
      // Taking a reporter's digest away.
      sql`UPDATE contact_keys SET email_hmac = NULL WHERE thread_id = ${threads.reporter}`,
      // Moving a key to another thread.
      sql`UPDATE contact_keys SET thread_id = ${threads.erased} WHERE thread_id = ${threads.reporter}`,
    ]) {
      await expect(
        before.db.transaction().execute(async (trx) => {
          await trx
            .insertInto('contact_key_rotations')
            .values({ from_fingerprint: 'a'.repeat(64), to_fingerprint: 'b'.repeat(64) })
            .execute();
          await attempt.execute(trx);
        }),
      ).rejects.toThrow();
    }
  });
});

describe('during the two-key window, before the rotation runs', () => {
  let windowed: FilingHarness;
  beforeAll(async () => {
    windowed = await filingHarness({ contactKey: NEW, previousContactKey: OLD });
  });
  afterAll(async () => {
    await windowed.close();
  });

  it('a reporter still finds their reports, filed under the old key', async () => {
    const me = as(windowed, await signIn(windowed, REPORTER));
    const list = (await me({ method: 'GET', url: '/api/mine/reports' })).json<{
      reports: unknown[];
    }>();
    expect(list.reports).toHaveLength(2);
  });

  it('old rows read under either key, and a new filing is wrapped under the new one', async () => {
    expect((await openContact(windowed.db, WINDOW_RING, threads.reporter ?? ''))?.email).toBe(
      REPORTER,
    );
    threads.during = await threadOf(
      windowed.db,
      await fileThroughRoutes(windowed, lb.slug, { what: 'During.' }, REPORTER),
    );
    expect((await openContact(windowed.db, NEW_RING, threads.during))?.email).toBe(REPORTER);
    await expect(openContact(windowed.db, OLD_RING, threads.during)).rejects.toThrow();
  });
});

describe('the rotation', () => {
  let was: Snapshot;
  // The test database is shared by every file, so other files' threads are
  // here too, all under the old key. Counts are relative to what is here.
  let live: number;
  let linkMatch = '';
  beforeAll(async () => {
    was = await snapshot(before);
    live = [...was.values()].filter((r) => r.dek).length;
    // The tip links' secret (links/keys.ts), made under the old key, so the
    // rotation has it to move: one more row re-wrapped.
    linkMatch = matchKey(await loadLinkKeys(before.db, OLD), 'https://rotation.example/');
  });
  // Shared database: later files open the link secret under the old key.
  afterAll(async () => {
    await rewrapLinkSecret(before.db, OLD, NEW);
  });

  it('refuses a previous key that does not open the rows, and changes nothing', async () => {
    const wrong = randomBytes(32).toString('base64');
    await expect(rotateContactKey(before.db, { current: NEW, previous: wrong })).rejects.toThrow(
      /neither/i,
    );
    expect(await snapshot(before)).toEqual(was);
    expect(await before.db.selectFrom('contact_key_rotations').select('id').execute()).toEqual([]);
  });

  it('re-wraps every live key in one go, and leaves the one already on the new key', async () => {
    const out = await rotateContactKey(before.db, { current: NEW, previous: OLD });
    // Everything but the window's filing, which was already on the new key,
    // and the link secret.
    expect(out).toEqual({ rewrapped: live - 1 + 1, already_current: 1 });
    // The link keys open under the new key alone, and match as before.
    expect(matchKey(await loadLinkKeys(before.db, NEW), 'https://rotation.example/')).toBe(
      linkMatch,
    );
    expect(live - 1).toBeGreaterThanOrEqual(3);
    const now = await snapshot(before);
    for (const t of [threads.reporter, threads.reporter2, threads.coordinator]) {
      expect(now.get(t ?? '')?.dek).not.toBe(was.get(t ?? '')?.dek);
    }
    expect(now.get(threads.during ?? '')?.dek).toBe(was.get(threads.during ?? '')?.dek);
  });

  it('the addresses read under the new key alone, and no longer under the old one', async () => {
    for (const t of [threads.reporter, threads.reporter2]) {
      expect((await openContact(before.db, NEW_RING, t ?? ''))?.email).toBe(REPORTER);
      await expect(openContact(before.db, OLD_RING, t ?? '')).rejects.toThrow();
    }
    expect(await openContact(before.db, NEW_RING, threads.coordinator ?? '')).toMatchObject({
      filed_by: 'coordinator',
      email: COORD,
    });
  });

  it('THE ERASED REPORT STAYS ERASED: no key came back, and its ciphertext is untouched', async () => {
    const key = await before.db
      .selectFrom('contact_keys')
      .select('thread_id')
      .where('thread_id', '=', threads.erased ?? '')
      .executeTakeFirst();
    expect(key).toBeUndefined();
    expect(await openContact(before.db, NEW_RING, threads.erased ?? '')).toMatchObject({
      erased: true,
      email: null,
    });
    // The ciphertext of every row, erased or not, is never touched.
    const now = await snapshot(before);
    for (const [t, row] of was) expect(now.get(t)?.contact).toBe(row.contact);
  });

  it('re-computes the digests, so "My reports" works on the new key alone', async () => {
    const now = await snapshot(before);
    expect(now.get(threads.reporter ?? '')?.hmac).toBe(emailDigest(NEW_RING, REPORTER));
    expect(now.get(threads.coordinator ?? '')?.hmac).toBeNull();
    const after = await filingHarness({ contactKey: NEW });
    try {
      const me = as(after, await signIn(after, REPORTER));
      const list = (await me({ method: 'GET', url: '/api/mine/reports' })).json<{
        reports: unknown[];
      }>();
      expect(list.reports).toHaveLength(3);
      const coord = as(after, await signIn(after, COORD));
      expect(
        (await coord({ method: 'GET', url: '/api/mine/reports' })).json<{ reports: unknown[] }>()
          .reports,
      ).toEqual([]);
    } finally {
      await after.close();
    }
  });

  it('is on the record, with fingerprints and never the keys, and the record cannot change', async () => {
    const rows = await before.db
      .selectFrom('contact_key_rotations')
      .selectAll()
      .where('to_fingerprint', '=', fingerprint(NEW))
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      from_fingerprint: fingerprint(OLD),
      to_fingerprint: fingerprint(NEW),
      rewrapped: live - 1 + 1,
    });
    expect(JSON.stringify(rows)).not.toContain(NEW);
    await expect(
      before.db.updateTable('contact_key_rotations').set({ rewrapped: 0 }).execute(),
    ).rejects.toThrow();
  });

  it('run again, finds nothing left to do', async () => {
    const out = await rotateContactKey(before.db, { current: NEW, previous: OLD });
    expect(out).toEqual({ rewrapped: 0, already_current: live });
  });

  it('refuses to "rotate" to the key it already has', async () => {
    await expect(rotateContactKey(before.db, { current: NEW, previous: NEW })).rejects.toThrow(
      /same/i,
    );
  });
});
