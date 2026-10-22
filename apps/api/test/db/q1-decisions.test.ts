/**
 * The owner's decisions 1 to 5 (docs/decisions.md), each where the server
 * enforces it.
 *
 *   1. Verifying a report that is not public: its fingerprints, never its text.
 *   2. /api/v1 is behind the site password.
 *   3. The lock screen: the site's name and the operator's paragraph, carried
 *      by the call in front of the password, and nothing else.
 *   4. The evidence-request link passes the password on its token.
 *   5. With the archive off, the confirmation page is never told "public".
 *
 * Decisions 2 to 4 need the password ON, which is the whole site's, so this
 * file sets a real one and lifts it after (files take turns: vitest.config.ts).
 */
import type { FieldDefinition } from '@reportlog/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequest, cancelRequest } from '../../src/evidence/requests.ts';
import { sealContact } from '../../src/filing/contactKeys.ts';
import { DECIDES_ITSELF_PREFIXES, IN_FRONT } from '../../src/identity/gate.ts';
import { setOutsideAccess } from '../../src/identity/doors.ts';
import { hashPassword } from '../../src/identity/secrets.ts';
import { setPermission } from '../../src/permissions/log.ts';
import { validateCopy } from '../../src/site/copy.ts';
import { setDevMode } from '../../src/site/devMode.ts';
import { readSettings, writeCopy, writeSettings } from '../../src/site/settings.ts';
import type { FilingHarness } from './filing-helpers.ts';
import { RING, confirm, look, send, spine, tokenFor } from './filing-helpers.ts';
import { QUESTIONS, launchedLogbook } from './helpers.ts';
import { address, as, cookieFrom, liftCurtain, seat, signIn } from './identity-helpers.ts';
import {
  approve,
  correctThread,
  fileThread,
  moderationHarness,
  resetModerationSettings,
  staff,
} from './moderation-helpers.ts';
import { paintedLook } from '../../src/site/look.ts';

const Q: FieldDefinition[] = [
  { key: 'what', kind: 'long_text', label: 'What happened?', required: true },
];
const PASSWORD = 'q1-decisions-password';

let h: FilingHarness;

const get = (url: string, cookies: Record<string, string> = {}) =>
  h.app.inject({ method: 'GET', url, cookies });
const isLocked = (res: { statusCode: number; body: string }) =>
  res.statusCode === 401 && res.body.includes('"locked"');

async function archive(on: boolean | null) {
  await h.db
    .updateTable('moderation_settings')
    .set({ public_archive_enabled: on })
    .where('id', '=', true)
    .execute();
}

async function lockSite() {
  await h.db
    .updateTable('site_access')
    .set({ enabled: true, password_hash: await hashPassword(PASSWORD) })
    .where('id', '=', true)
    .execute();
}

async function unlockCookie(): Promise<Record<string, string>> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/site-access/unlock',
    payload: { password: PASSWORD },
  });
  return { site_access: cookieFrom(res, 'site_access') ?? '' };
}

beforeAll(async () => {
  h = await moderationHarness();
  await resetModerationSettings(h.db);
  await liftCurtain(h.db);
});
afterAll(async () => {
  await liftCurtain(h.db);
  await resetModerationSettings(h.db);
  await setDevMode(h.db, null);
  await writeCopy(h.db, 'lock_intro', null);
  await writeSettings(h.db, { site_name: null });
  await h.close();
});

// ── 1 ───────────────────────────────────────────────────────────────────

describe('1. verifying a report that is not public', () => {
  const WORDS = 'Words nobody has published, only filed.';
  let lb: { id: number; slug: string };

  beforeAll(async () => {
    lb = await launchedLogbook(h.db, Q);
  });

  const verify = async (ref: string, cookies: Record<string, string> = {}) => {
    const res = await get(`/api/reports/${ref}/verify`, cookies);
    expect(res.statusCode).toBe(200);
    return { text: res.body, json: res.json<Record<string, unknown>>() };
  };

  it('answers its fingerprints, link and position, and nothing it says', async () => {
    const t = await fileThread(h.db, lb, Q, { what: WORDS });
    const v = await verify(t.publicRef);
    expect(v.json).toMatchObject({
      public_ref: t.publicRef,
      content: { ok: true },
      link: { ok: true },
      position: { ok: true },
    });
    // Absent, not null.
    expect('hashed_fields' in v.json).toBe(false);
    expect('canonical_json' in v.json).toBe(false);
    expect(v.text).not.toContain(WORDS);
  });

  it('a published report answers in full: the text and the bytes that were hashed', async () => {
    const t = await fileThread(h.db, lb, Q, { what: 'A published account.' });
    await approve(h.db, t.threadId);
    const v = await verify(t.publicRef);
    expect(v.json.canonical_json).toContain('A published account.');
    expect(v.json.hashed_fields).toMatchObject({ answers: { what: 'A published account.' } });
  });

  it('approved but filed without permission to publish: fingerprints only', async () => {
    const t = await fileThread(h.db, lb, Q, { what: WORDS }, { may_publish: false });
    await approve(h.db, t.threadId);
    expect((await verify(t.publicRef)).text).not.toContain(WORDS);
  });

  it('published, but with the archive switched off: fingerprints only', async () => {
    const t = await fileThread(h.db, lb, Q, { what: 'Published while the archive was on.' });
    await approve(h.db, t.threadId);
    await archive(false);
    try {
      const v = await verify(t.publicRef);
      expect('canonical_json' in v.json).toBe(false);
      expect(v.text).not.toContain('Published while the archive was on.');
    } finally {
      await archive(null);
    }
  });

  it('a version a correction replaced is not the published one: fingerprints only', async () => {
    const t = await fileThread(h.db, lb, Q, { what: 'The first wording, since corrected.' });
    const c = await correctThread(h.db, lb, Q, t, { what: 'The corrected wording.' });
    await approve(h.db, t.threadId);
    expect((await verify(c.publicRef)).text).toContain('The corrected wording.');
    expect((await verify(t.publicRef)).text).not.toContain('The first wording');
  });

  it('a moderator, who reads it in the queue anyway, gets it whole; a signed-in nobody does not', async () => {
    const t = await fileThread(h.db, lb, Q, { what: WORDS });
    const mod = await staff(h, 'q1-verify-mod', 'moderator');
    const res = await mod.call({ method: 'GET', url: `/api/reports/${t.publicRef}/verify` });
    expect(res.body).toContain(WORDS);
    const nobody = await staff(h, 'q1-verify-user', 'user');
    const plain = await nobody.call({ method: 'GET', url: `/api/reports/${t.publicRef}/verify` });
    expect(plain.statusCode).toBe(200);
    expect(plain.body).not.toContain(WORDS);
  });
});

// ── 5 ───────────────────────────────────────────────────────────────────

describe('5. the confirmation page while the archive is off', () => {
  let lb: { id: number; slug: string };
  let token = '';
  let threadId = '';

  beforeAll(async () => {
    lb = await launchedLogbook(h.db, Q);
    const email = address('q1-confirm');
    const sent = await send(h, { ...spine(email), logbook: lb.slug, answers: { what: 'Mine.' } });
    expect(sent.status).toBe(200);
    token = tokenFor(h.mailer, email) ?? '';
    const done = await confirm(h, token);
    const ref = done.body.confirmation.public_ref ?? '';
    const row = await h.db
      .selectFrom('reports')
      .select('thread_id')
      .where('public_ref', '=', ref)
      .executeTakeFirstOrThrow();
    threadId = row.thread_id;
  });

  it('with the archive on, an approved report is public, and nothing says the archive is closed', async () => {
    await approve(h.db, threadId);
    const c = (await look(h, token)).body.confirmation as Record<string, unknown>;
    expect(c.state).toBe('public');
    expect('archive_closed' in c).toBe(false);
  });

  it('with the archive off, the same report is received, and the page is told why', async () => {
    await archive(false);
    try {
      const c = (await look(h, token)).body.confirmation as Record<string, unknown>;
      expect(c.state).toBe('received');
      expect(c.archive_closed).toBe(true);
      expect(JSON.stringify(c)).not.toContain('public"');
    } finally {
      await archive(null);
    }
  });
});

// ── 2, 3, 4: with the password on ───────────────────────────────────────

describe('with the site password on', () => {
  let evidenceToken = '';
  let closedToken = '';
  let adminSession = '';
  let doorSlug = '';

  // The next file expects no logbook open outside.
  afterAll(async () => {
    await setOutsideAccess(h.db, doorSlug, 'closed');
  });

  beforeAll(async () => {
    // Signed in before the password goes on: signing in is behind it too.
    const adminEmail = address('q1-lock-admin');
    await seat(h.db, adminEmail, 'admin');
    adminSession = await signIn(h, adminEmail);

    // A logbook open outside, so a door exists: /api/v1 must still not pass.
    const lb = await launchedLogbook(h.db, Q);
    doorSlug = lb.slug;
    await setOutsideAccess(h.db, lb.slug, 'door');

    // Two evidence requests, one live and one withdrawn.
    const evLb = await launchedLogbook(h.db, QUESTIONS);
    for (const which of ['open', 'closed'] as const) {
      const t = await fileThread(h.db, evLb, QUESTIONS, {
        what: `Evidence, ${which}.`,
        has: 'yes',
        of: 'a photo',
      });
      await h.db.transaction().execute((trx) =>
        sealContact(trx, RING, {
          threadId: t.threadId,
          email: address(`q1-ev-${which}`),
          filedBy: 'reporter',
        }),
      );
      await setPermission(h.db, {
        threadId: t.threadId,
        permission: 'evidence_request',
        granted: true,
      });
      const out = await createRequest(h.db, t.threadId, {
        message: 'Could you send the photo you mentioned?',
        by: 'mod@example.org',
      });
      if (!out.ok) throw new Error(out.reason);
      if (which === 'open') evidenceToken = out.token;
      else {
        closedToken = out.token;
        await cancelRequest(h.db, t.threadId, { by: 'mod@example.org' });
      }
    }
    await lockSite();
  });

  describe('2. /api/v1 is behind it', () => {
    it('names no /api/v1 route in front of the password, nor lets one decide for itself', () => {
      expect(IN_FRONT.filter((k) => k.split(' ')[1]?.startsWith('/api/v1'))).toEqual([]);
      expect(DECIDES_ITSELF_PREFIXES.filter((p) => p.startsWith('/api/v1'))).toEqual([]);
    });

    it('refuses every /api/v1 read as locked, even with a logbook open outside', async () => {
      for (const url of ['/api/v1', '/api/v1/stats', '/api/v1/consent-texts']) {
        const res = await get(url);
        expect({ url, locked: isLocked(res) }).toEqual({ url, locked: true });
      }
    });

    it('answers them with the password', async () => {
      const past = await unlockCookie();
      for (const url of ['/api/v1', '/api/v1/stats']) {
        expect({ url, status: (await get(url, past)).statusCode }).toEqual({ url, status: 200 });
      }
    });
  });

  describe('3. the lock screen', () => {
    it('brings the shipped name and no paragraph while nothing is written', async () => {
      const res = await get('/api/site-access/status');
      expect(res.json()).toEqual({
        locked: true,
        site: { name_parts: [{ text: 'ReportLog', mark: '' }], plain_name: 'ReportLog' },
        dev_mode_until: null,
        look: paintedLook(await readSettings(h.db)),
      });
    });

    it('wears the site’s look (decision 60, amending 3): colours and type, nothing more', async () => {
      const before = await readSettings(h.db);
      await writeSettings(h.db, { palette: 'midnight', theme: 'docket' });
      try {
        const body = (await get('/api/site-access/status')).json<Record<string, unknown>>();
        expect(body.look).toEqual({
          palette: 'midnight',
          theme: 'docket',
          panel_head: 'rule',
          texture: 'none',
        });
      } finally {
        await writeSettings(h.db, { palette: before.palette, theme: before.theme });
      }
    });

    it('brings the operator’s name and paragraph as written, and nothing else', async () => {
      await writeSettings(h.db, { site_name: 'Harbour Watch' });
      const intro = 'Run by the harbour residents.\nAsk at the office for the password.';
      expect(validateCopy('lock_intro', intro).ok).toBe(true);
      // No figures in front of the password: they count what it protects.
      expect(validateCopy('lock_intro', 'We hold {{ [reports] }} reports.')).toMatchObject({
        ok: false,
      });
      expect(validateCopy('how_intro', 'We hold {{ [reports] }} reports.').ok).toBe(true);
      await writeCopy(h.db, 'lock_intro', intro);
      const body = (await get('/api/site-access/status')).json<Record<string, unknown>>();
      expect(Object.keys(body).sort()).toEqual(['dev_mode_until', 'locked', 'look', 'site']);
      expect(body.site).toEqual({
        name_parts: [{ text: 'Harbour Watch', mark: '' }],
        plain_name: 'Harbour Watch',
        intro,
      });
    });

    it('is readable without anything behind the gate: the site’s settings stay locked', async () => {
      expect(isLocked(await get('/api/site'))).toBe(true);
    });

    it('carries the development notice’s end, locked or not, and the site only while locked', async () => {
      const dev = await setDevMode(h.db, 2);
      expect((await get('/api/site-access/status')).json()).toMatchObject({
        dev_mode_until: dev.until,
      });
      const past = await get('/api/site-access/status', await unlockCookie());
      expect(past.json()).toEqual({ locked: false, dev_mode_until: dev.until });
      await setDevMode(h.db, null);
    });

    it('lets an administrator write the paragraph through the settings', async () => {
      const res = await as(
        h,
        adminSession,
        (await unlockCookie()).site_access,
      )({
        method: 'PUT',
        url: '/api/admin/site/copy/lock_intro',
        payload: { body: 'Written in the settings.' },
      });
      expect(res.statusCode).toBe(200);
      const slot = res
        .json<{ copy: { key: string; body: string; written: boolean; optional: boolean }[] }>()
        .copy.find((c) => c.key === 'lock_intro');
      expect(slot).toMatchObject({
        body: 'Written in the settings.',
        written: true,
        optional: true,
      });
    });
  });

  describe('4. the evidence-request link', () => {
    it('opens on its token without the password', async () => {
      const res = await get(`/api/evidence/${evidenceToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ message: 'Could you send the photo you mentioned?' });
      // Every call the page makes gets past the gate; what each then says is the route's own.
      for (const [method, url] of [
        ['GET', `/api/evidence/${evidenceToken}/files`],
        ['POST', `/api/evidence/${evidenceToken}/files`],
        ['POST', `/api/evidence/${evidenceToken}/send`],
        ['DELETE', `/api/evidence/${evidenceToken}/files/${'0'.repeat(48)}`],
        ['PUT', `/api/evidence/${evidenceToken}/files/${'0'.repeat(48)}`],
      ] as const) {
        const r = await h.app.inject({
          method,
          url,
          ...(method === 'POST' ? { payload: {} } : {}),
        });
        expect({ method, url, locked: isLocked(r) }).toEqual({ method, url, locked: false });
      }
    });

    it('a withdrawn request passes the gate and is refused by its own route, in its words', async () => {
      const res = await get(`/api/evidence/${closedToken}`);
      expect(res.statusCode).toBe(410);
    });

    it('a token that names no request gets the password screen, like anything else', async () => {
      expect(isLocked(await get(`/api/evidence/${'a'.repeat(48)}`))).toBe(true);
      expect(isLocked(await get('/api/evidence/not-a-token'))).toBe(true);
    });

    it('the moderator’s side of it stays behind the password', async () => {
      expect(
        isLocked(await get('/api/moderate/evidence/00000000-0000-0000-0000-000000000000')),
      ).toBe(true);
    });
  });
});
