/**
 * Two-factor login (plan E, decision E3; session PE1), against a real
 * database and the real app.
 *
 * Every other test file signs staff in through identity-helpers' `signIn`,
 * which marks the session as having proved a factor (a fixture). This file
 * is where that proof is earned: through the routes, with codes computed
 * from the secret the server shows, recovery codes it hands out, and a
 * software passkey (soft-authenticator.ts) that @simplewebauthn checks.
 */
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { capturingMailer } from '../../src/email/mailer.ts';
import {
  LOCK_MS,
  MAX_FAILURES,
  PENDING_SESSION_MS,
  SERVER_ACTOR,
  STAFF_SESSION_MS,
  STEP_UP_MS,
} from '../../src/identity/secondFactor.ts';
import { sha256Hex } from '../../src/identity/secrets.ts';
import { SESSION_TTL_MS } from '../../src/identity/sessions.ts';
import { base32Decode, totpAt } from '../../src/identity/totp.ts';
import { launchedLogbook } from './helpers.ts';
import {
  SITE,
  TWO_FACTOR_KEY,
  address,
  as,
  harness,
  seat,
  setUpTotp,
  signIn,
  signInByEmailOnly as signInByEmailOnlyFrom,
} from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';
import { softPasskey } from './soft-authenticator.ts';

let h: Harness;
beforeAll(async () => {
  h = await harness();
});
afterAll(async () => {
  await h.close();
});

// This file signs in far more often than one client may in an hour, so each
// sign-in comes from an address of its own (the limiter is not under test here).
let clients = 0;
const signInByEmailOnly = (hh: Harness, email: string) => {
  clients += 1;
  return signInByEmailOnlyFrom(
    hh,
    email,
    {},
    `10.9.${String(clients >> 8)}.${String(clients & 255)}`,
  );
};

const code = (secret: string, offsetMs = 0) => totpAt(base32Decode(secret), Date.now() + offsetMs);

type Call = ReturnType<typeof as>;
/**
 * Calls as one session, following it when the server replaces it: proving
 * the first factor gives a new token (secondFactor.ts, upgradeSession).
 */
type Live = Call & { token: () => string; use: (token: string) => void };
function live(token: string): Live {
  let current = token;
  const call = (async (opts: Parameters<Call>[0]) => {
    const res = await as(h, current)(opts);
    const next = res.cookies.find((c) => c.name === 'session_token')?.value;
    if (next) current = next;
    return res;
  }) as Live;
  call.token = () => current;
  call.use = (t) => {
    current = t;
  };
  return call;
}
const me = async (call: Call) =>
  (await call({ method: 'GET', url: '/api/auth/me' })).json<Record<string, unknown>>();
const verify = (call: Call, c: string) =>
  call({ method: 'POST', url: '/api/auth/second-factor/verify', payload: { code: c } });

/** A role holder with an authenticator app set up, and a fresh session that has proved nothing. */
async function enrolled(role: string) {
  const email = address(`2fa-${role}`);
  await seat(h.db, email, role);
  const first = await signInByEmailOnly(h, email);
  const { secret, recoveryCodes } = await setUpTotp(h, first);
  // As if set up a while ago: the step it was confirmed with is not "the
  // newest accepted", or the test's first code would be a replay of it.
  await h.db
    .updateTable('two_factor_totp')
    .set({ last_step: null })
    .where('user_id', '=', await userId(email))
    .execute();
  const session = await signInByEmailOnly(h, email);
  const call = live(session);
  return {
    email,
    secret,
    recoveryCodes,
    call,
    get session() {
      return call.token();
    },
  };
}

async function userId(email: string): Promise<number> {
  const row = await h.db
    .selectFrom('users')
    .select('id')
    .where('email', '=', email)
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Wait into the next 30-second step, so a new code exists that was never used. */
async function nextStep(): Promise<void> {
  const ms = 30_000 - (Date.now() % 30_000) + 50;
  await new Promise((r) => setTimeout(r, ms));
}

// ── who needs one ───────────────────────────────────────────────────────

/** A route behind each role, and what it answers somebody without the role. */
const BEHIND: Record<string, { method: 'GET' | 'POST'; url: string }> = {
  owner: { method: 'GET', url: '/api/owner/journalists' },
  admin: { method: 'GET', url: '/api/admin/site' },
  access_manager: { method: 'GET', url: '/api/access/people' },
  moderator: { method: 'GET', url: '/api/moderation/reports' },
  journalist: { method: 'GET', url: '/api/desk/links' },
};

describe('a role holder without a second factor reaches nothing behind the role', () => {
  for (const [role, behind] of Object.entries(BEHIND)) {
    it(`${role}: sent to set one up, and refused until they do`, async () => {
      const email = address(`nofactor-${role}`);
      await seat(h.db, email, role);
      const session = await signInByEmailOnly(h, email);
      const call = live(session);
      expect(await me(call)).toMatchObject({
        role: 'user',
        heldRole: role,
        secondFactor: 'set-up',
        grantsAccess: false,
      });
      const refused = await call(behind);
      expect([401, 403]).toContain(refused.statusCode);
      expect(refused.json<{ error: { code: string } }>().error.code).toBe('forbidden');

      call.use((await setUpTotp(h, session)).session);
      expect(await me(call)).toMatchObject({ role, secondFactor: 'done' });
      const after = await call(behind);
      // Past the role: whatever the route says now, it is not "your role may not".
      expect(after.json<{ error?: { message: string } }>().error?.message ?? '').not.toBe(
        'Your account is not allowed to do that.',
      );
    });
  }

  for (const orgRole of ['coordinator', 'manager'] as const) {
    it(`an organization's ${orgRole}: no membership until they prove one`, async () => {
      const email = address(`nofactor-${orgRole}`);
      const user = await h.db
        .insertInto('users')
        .values({ email })
        .returning('id')
        .executeTakeFirstOrThrow();
      const org = await h.db
        .insertInto('organizations')
        .values({ name: `Org ${email}`, verified_by: 'second-factor test' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await h.db
        .insertInto('organization_memberships')
        .values({ organization_id: org.id, user_id: user.id, role: orgRole })
        .execute();
      const session = await signInByEmailOnly(h, email);
      const call = live(session);
      expect(await me(call)).toMatchObject({
        role: 'user',
        memberships: [],
        secondFactor: 'set-up',
      });
      expect((await call({ method: 'GET', url: '/api/intake/organizations' })).statusCode).toBe(
        403,
      );
      expect(
        (await call({ method: 'GET', url: `/api/orgs/${String(org.id)}` })).statusCode,
      ).not.toBe(200);
      call.use((await setUpTotp(h, session)).session);
      expect((await me(call)).memberships).toHaveLength(1);
      expect((await call({ method: 'GET', url: '/api/intake/organizations' })).statusCode).toBe(
        200,
      );
    });
  }

  it('a role holder WITH a factor is asked to prove it, and is held at no role until then', async () => {
    const a = await enrolled('admin');
    expect(await me(a.call)).toMatchObject({ role: 'user', secondFactor: 'verify' });
    expect((await a.call(BEHIND.admin as never)).statusCode).toBe(403);
    // Setting up another factor is not a way round proving the one they have.
    expect(
      (await a.call({ method: 'POST', url: '/api/auth/second-factor/totp/begin' })).json(),
    ).toMatchObject({ error: { code: 'second_factor_required' } });
    expect((await verify(a.call, code(a.secret))).statusCode).toBe(200);
    expect(await me(a.call)).toMatchObject({ role: 'admin', secondFactor: 'done' });
  });

  it('a plain user and an alert subscriber are untouched: no second factor, a 24-hour session', async () => {
    const email = address('plain');
    const session = await signInByEmailOnly(h, email);
    expect(await me(live(session))).toMatchObject({ role: 'user', secondFactor: 'not-needed' });
    const row = await h.db
      .selectFrom('sessions')
      .select(['expires_at', 'created_at'])
      .where('token_hash', '=', sha256Hex(session))
      .executeTakeFirstOrThrow();
    const ttl = row.expires_at.getTime() - row.created_at.getTime();
    expect(Math.abs(ttl - SESSION_TTL_MS)).toBeLessThan(10_000);
    // Nothing to set up and nothing to prove.
    expect(
      (await live(session)({ method: 'POST', url: '/api/auth/second-factor/totp/begin' })).json(),
    ).toMatchObject({ error: { code: 'second_factor_not_needed' } });
  });

  it('a role granted mid-session is not usable until that session proves a factor', async () => {
    const email = address('promoted');
    const session = await signInByEmailOnly(h, email);
    await seat(h.db, email, 'moderator');
    expect(await me(live(session))).toMatchObject({ role: 'user', secondFactor: 'set-up' });
  });
});

describe('sessions', () => {
  const ttl = async (session: string) => {
    const row = await h.db
      .selectFrom('sessions')
      .select(['expires_at'])
      .where('token_hash', '=', sha256Hex(session))
      .executeTakeFirstOrThrow();
    return row.expires_at.getTime() - Date.now();
  };

  it('a role holder signs in to a short session, and proving the factor makes it 12 hours', async () => {
    const a = await enrolled('moderator');
    expect(Math.abs((await ttl(a.session)) - PENDING_SESSION_MS)).toBeLessThan(10_000);
    const res = await verify(a.call, code(a.secret));
    expect(res.statusCode).toBe(200);
    expect(Math.abs((await ttl(a.session)) - STAFF_SESSION_MS)).toBeLessThan(10_000);
    const cookie = res.cookies.find((c) => c.name === 'session_token');
    expect(cookie?.maxAge).toBe(STAFF_SESSION_MS / 1000);
  });

  it('proving the factor replaces the session: the cookie from before it signs in nobody', async () => {
    const a = await enrolled('admin');
    const before = a.session;
    expect((await verify(a.call, code(a.secret))).statusCode).toBe(200);
    expect(a.session).not.toBe(before);
    expect(await me(as(h, before))).toEqual({ signedIn: false });
    expect(await me(a.call)).toMatchObject({ role: 'admin', secondFactor: 'done' });
    // A step-up keeps the session it is in.
    await staleStepUp(a.session);
    const now = a.session;
    await nextStep();
    expect((await verify(a.call, code(a.secret))).statusCode).toBe(200);
    expect(a.session).toBe(now);
  }, 40_000);

  it('a proof older than 12 hours is no proof', async () => {
    const a = await enrolled('moderator');
    await verify(a.call, code(a.secret));
    await h.db
      .updateTable('sessions')
      .set({
        second_factor_at: new Date(Date.now() - STAFF_SESSION_MS - 1000),
        expires_at: new Date(Date.now() + 60_000),
      })
      .where('token_hash', '=', sha256Hex(a.session))
      .execute();
    expect(await me(a.call)).toMatchObject({ role: 'user', secondFactor: 'verify' });
  });
});

// ── the authenticator app ───────────────────────────────────────────────

describe('authenticator codes', () => {
  it('accepts a code one step either side of now, and not two', async () => {
    const a = await enrolled('moderator');
    expect((await verify(a.call, code(a.secret, -60_000))).statusCode).toBe(401);
    expect((await verify(a.call, code(a.secret, 60_000))).statusCode).toBe(401);
    expect((await verify(a.call, code(a.secret, -30_000))).statusCode).toBe(200);
    const b = await enrolled('moderator');
    expect((await verify(b.call, code(b.secret, 30_000))).statusCode).toBe(200);
  });

  it('accepts a code once: the same code again, in another session, is refused', async () => {
    const a = await enrolled('moderator');
    const c = code(a.secret);
    expect((await verify(a.call, c)).statusCode).toBe(200);
    const again = live(await signInByEmailOnly(h, a.email));
    expect((await verify(again, c)).json()).toMatchObject({ error: { code: 'bad_code' } });
    // Nor an older one than the newest accepted.
    expect((await verify(again, code(a.secret, -30_000))).statusCode).toBe(401);
  });

  it('two requests racing with one code: one wins', async () => {
    const a = await enrolled('moderator');
    const other = live(await signInByEmailOnly(h, a.email));
    const c = code(a.secret);
    const [x, y] = await Promise.all([verify(a.call, c), verify(other, c)]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 401]);
  });

  it(`locks after ${String(MAX_FAILURES)} wrong codes, even for the right one, and for a while only`, async () => {
    const a = await enrolled('admin');
    const right = code(a.secret);
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < MAX_FAILURES; i += 1) {
      expect((await verify(a.call, wrong)).statusCode).toBe(401);
    }
    const locked = await verify(a.call, right);
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ error: { code: 'second_factor_locked' } });
    // A new session is no way round it: the lock is the person's.
    expect((await verify(live(await signInByEmailOnly(h, a.email)), right)).statusCode).toBe(429);
    const status = await a.call({ method: 'GET', url: '/api/auth/second-factor' });
    const until = Date.parse(status.json<{ lockedUntil: string }>().lockedUntil);
    expect(Math.abs(until - (Date.now() + LOCK_MS))).toBeLessThan(10_000);
    // The time passes.
    await h.db
      .updateTable('two_factor_attempts')
      .set({ locked_until: new Date(Date.now() - 1) })
      .where('user_id', '=', await userId(a.email))
      .execute();
    expect((await verify(a.call, right)).statusCode).toBe(200);
  });

  it('guesses sent all at once cannot outrun the lock', async () => {
    const a = await enrolled('admin');
    const right = code(a.secret);
    const wrongs = ['000001', '000002', '000003', '000004', '000005', '000006', '000007'].filter(
      (w) => w !== right,
    );
    const answers = await Promise.all(wrongs.map((w) => verify(a.call, w)));
    expect(answers.filter((r) => r.statusCode === 401).length).toBeLessThanOrEqual(MAX_FAILURES);
    expect((await verify(a.call, right)).statusCode).toBe(429);
  });

  it('a new secret replaces the old only once a code from it is typed', async () => {
    const a = await enrolled('moderator');
    await verify(a.call, code(a.secret));
    const begun = await a.call({ method: 'POST', url: '/api/auth/second-factor/totp/begin' });
    expect(begun.statusCode).toBe(200);
    // Not confirmed: the old secret still signs in.
    await nextStep();
    const other = live(await signInByEmailOnly(h, a.email));
    expect((await verify(other, code(a.secret))).statusCode).toBe(200);
    const fresh = begun.json<{ secret: string; uri: string }>();
    expect(fresh.uri).toMatch(/^otpauth:\/\/totp\/reports\.example\.test:/);
    expect(fresh.uri).toContain(`secret=${fresh.secret}`);
    const confirmed = await a.call({
      method: 'POST',
      url: '/api/auth/second-factor/totp/confirm',
      payload: { code: code(fresh.secret) },
    });
    // Not the first factor: no new recovery codes.
    expect(confirmed.json()).toEqual({ recoveryCodes: null });
    await nextStep();
    const third = live(await signInByEmailOnly(h, a.email));
    expect((await verify(third, code(a.secret))).statusCode).toBe(401);
    expect((await verify(third, code(fresh.secret))).statusCode).toBe(200);
  }, 70_000);

  it('the secret is encrypted at rest, under TWO_FACTOR_KEY and for that person only', async () => {
    const a = await enrolled('moderator');
    const row = await h.db
      .selectFrom('two_factor_totp')
      .select('secret_enc')
      .where('user_id', '=', await userId(a.email))
      .executeTakeFirstOrThrow();
    const stored = Buffer.from(row.secret_enc ?? []);
    expect(stored.includes(base32Decode(a.secret))).toBe(false);
    expect(stored.toString('latin1')).not.toContain(a.secret);
    // Moved onto somebody else's row, it does not open.
    const b = await enrolled('moderator');
    await h.db
      .updateTable('two_factor_totp')
      .set({ secret_enc: stored })
      .where('user_id', '=', await userId(b.email))
      .execute();
    expect((await verify(b.call, code(a.secret))).statusCode).toBe(401);
  });

  it('without TWO_FACTOR_KEY an app cannot be set up, and says so', async () => {
    const mailer = capturingMailer();
    const app = await buildApp({
      config: { LOG_LEVEL: 'silent', SITE_ORIGIN: SITE },
      db: h.db,
      mailer,
    });
    try {
      const email = address('nokey');
      await seat(h.db, email, 'moderator');
      const session = await signInByEmailOnly({ ...h, app, mailer }, email);
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/second-factor/totp/begin',
        cookies: { session_token: session },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: { code: 'no_two_factor_key' } });
    } finally {
      await app.close();
    }
  });
});

// ── recovery codes ──────────────────────────────────────────────────────

describe('recovery codes', () => {
  it('ten, shown once when the first factor is set up, each good once', async () => {
    const a = await enrolled('moderator');
    expect(a.recoveryCodes).toHaveLength(10);
    expect(new Set(a.recoveryCodes).size).toBe(10);
    for (const c of a.recoveryCodes)
      expect(c).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const first = a.recoveryCodes[0] ?? '';
    // Typed as a person might: lower case, no hyphens.
    expect((await verify(a.call, first.toLowerCase().replace(/-/g, ''))).statusCode).toBe(200);
    const again = live(await signInByEmailOnly(h, a.email));
    expect((await verify(again, first)).statusCode).toBe(401);
    const status = await again({ method: 'GET', url: '/api/auth/second-factor' });
    expect(status.json()).toMatchObject({ recoveryLeft: 9 });
  });

  it('are stored only as hashes', async () => {
    const a = await enrolled('moderator');
    const rows = await h.db
      .selectFrom('two_factor_recovery_codes')
      .select('code_hash')
      .where('user_id', '=', await userId(a.email))
      .execute();
    expect(rows).toHaveLength(10);
    const stored = rows.map((r) => r.code_hash).join(' ');
    for (const c of a.recoveryCodes) {
      expect(stored).not.toContain(c);
      expect(stored).not.toContain(c.replace(/-/g, ''));
    }
  });

  it('made again only after a step-up, and the old ones stop working', async () => {
    const a = await enrolled('moderator');
    await verify(a.call, code(a.secret));
    await staleStepUp(a.session);
    const refused = await a.call({ method: 'POST', url: '/api/auth/second-factor/recovery-codes' });
    expect(refused.json()).toMatchObject({ error: { code: 'step_up_required' } });
    await nextStep();
    await verify(a.call, code(a.secret));
    const made = await a.call({ method: 'POST', url: '/api/auth/second-factor/recovery-codes' });
    const fresh = made.json<{ recoveryCodes: string[] }>().recoveryCodes;
    expect(fresh).toHaveLength(10);
    const other = live(await signInByEmailOnly(h, a.email));
    expect((await verify(other, a.recoveryCodes[1] ?? '')).statusCode).toBe(401);
    expect((await verify(other, fresh[0] ?? '')).statusCode).toBe(200);
  }, 70_000);
});

// ── passkeys ────────────────────────────────────────────────────────────

describe('passkeys', () => {
  const register = async (call: Call, key = softPasskey(), origin = SITE, name = 'Laptop') => {
    const options = (
      await call({ method: 'POST', url: '/api/auth/second-factor/passkeys/challenge' })
    ).json<{ challenge: string; rp: { id: string } }>();
    return call({
      method: 'POST',
      url: '/api/auth/second-factor/passkeys',
      payload: { name, response: key.register(options, origin) },
    });
  };
  const prove = async (call: Call, key: ReturnType<typeof softPasskey>, origin = SITE) => {
    const options = (
      await call({ method: 'POST', url: '/api/auth/second-factor/passkey/challenge' })
    ).json<{ challenge: string; rpId: string }>();
    return call({
      method: 'POST',
      url: '/api/auth/second-factor/passkey',
      payload: { response: key.sign(options, origin) },
    });
  };

  it('one set up as the first factor signs its person in, and gives the recovery codes', async () => {
    const email = address('passkey');
    await seat(h.db, email, 'moderator');
    const first = live(await signInByEmailOnly(h, email));
    const key = softPasskey();
    const options = (
      await first({ method: 'POST', url: '/api/auth/second-factor/passkeys/challenge' })
    ).json<{ rp: { id: string }; user: { name: string } }>();
    // The relying party is SITE_ORIGIN's host.
    expect(options.rp.id).toBe('reports.example.test');
    const res = await register(first, key);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ recoveryCodes: string[] }>().recoveryCodes).toHaveLength(10);
    expect(await me(first)).toMatchObject({ role: 'moderator', secondFactor: 'done' });

    const later = live(await signInByEmailOnly(h, email));
    expect(await me(later)).toMatchObject({ secondFactor: 'verify' });
    expect((await prove(later, key)).statusCode).toBe(200);
    expect(await me(later)).toMatchObject({ role: 'moderator', secondFactor: 'done' });
  });

  it('several per person, and either factor satisfies a check', async () => {
    const a = await enrolled('moderator');
    await verify(a.call, code(a.secret));
    await stepUpNow(a.session);
    const laptop = softPasskey();
    const phone = softPasskey();
    expect((await register(a.call, laptop, SITE, 'Laptop')).json()).toEqual({
      recoveryCodes: null,
    });
    expect((await register(a.call, phone, SITE, 'Phone')).statusCode).toBe(200);
    const status = await a.call({ method: 'GET', url: '/api/auth/second-factor' });
    expect(status.json<{ passkeys: { name: string }[] }>().passkeys.map((p) => p.name)).toEqual([
      'Laptop',
      'Phone',
    ]);
    for (const key of [laptop, phone]) {
      const s = live(await signInByEmailOnly(h, a.email));
      expect((await prove(s, key)).statusCode).toBe(200);
    }
    // And a passkey is a step-up too.
    await staleStepUp(a.session);
    expect((await prove(a.call, phone)).statusCode).toBe(200);
    expect((await me(a.call)).stepUpUntil).not.toBeNull();
  });

  it("somebody else's passkey proves nothing, however valid", async () => {
    const mine = await enrolled('moderator');
    const theirs = await enrolled('moderator');
    await verify(theirs.call, code(theirs.secret));
    await stepUpNow(theirs.session);
    const key = softPasskey();
    expect((await register(theirs.call, key)).statusCode).toBe(200);
    // Mine has no passkey: no challenge to answer.
    expect(
      (
        await mine.call({ method: 'POST', url: '/api/auth/second-factor/passkey/challenge' })
      ).json(),
    ).toMatchObject({ error: { code: 'no_passkey' } });
    // Give mine a passkey, then answer mine's challenge with theirs.
    await verify(mine.call, code(mine.secret));
    await stepUpNow(mine.session);
    expect((await register(mine.call, softPasskey())).statusCode).toBe(200);
    const s = live(await signInByEmailOnly(h, mine.email));
    expect((await prove(s, key)).statusCode).toBe(401);
    expect(await me(s)).toMatchObject({ secondFactor: 'verify' });
  });

  it('refuses another origin, a spent challenge, and a registration without a challenge', async () => {
    const email = address('passkey-origin');
    await seat(h.db, email, 'moderator');
    const first = live(await signInByEmailOnly(h, email));
    expect((await register(first, softPasskey(), 'https://evil.example')).statusCode).toBe(400);
    const key = softPasskey();
    expect((await register(first, key)).statusCode).toBe(200);
    const s = live(await signInByEmailOnly(h, email));
    const options = (
      await s({ method: 'POST', url: '/api/auth/second-factor/passkey/challenge' })
    ).json<{ challenge: string }>();
    const send = (call: Call, response: object) =>
      call({ method: 'POST', url: '/api/auth/second-factor/passkey', payload: { response } });
    expect((await send(s, key.sign(options, 'https://evil.example'))).statusCode).toBe(401);
    // The challenge was spent by the refused answer: the right answer to it fails too.
    expect((await send(s, key.sign(options, SITE))).statusCode).toBe(401);
    const fresh = (
      await s({ method: 'POST', url: '/api/auth/second-factor/passkey/challenge' })
    ).json<{ challenge: string }>();
    const answer = key.sign(fresh, SITE);
    expect((await send(s, answer)).statusCode).toBe(200);
    // Replayed in another session, which was issued no such challenge.
    const t = live(await signInByEmailOnly(h, email));
    await t({ method: 'POST', url: '/api/auth/second-factor/passkey/challenge' });
    expect((await send(t, answer)).statusCode).toBe(401);
  });

  it('the last factor cannot be removed; one of two can, after a step-up', async () => {
    const email = address('passkey-remove');
    await seat(h.db, email, 'moderator');
    const call = live(await signInByEmailOnly(h, email));
    expect((await register(call, softPasskey(), SITE, 'Only')).statusCode).toBe(200);
    const status = await call({ method: 'GET', url: '/api/auth/second-factor' });
    const only = status.json<{ passkeys: { id: number }[] }>().passkeys[0]?.id ?? 0;
    expect(
      (
        await call({ method: 'DELETE', url: `/api/auth/second-factor/passkeys/${String(only)}` })
      ).json(),
    ).toMatchObject({ error: { code: 'last_factor' } });
    expect((await register(call, softPasskey(), SITE, 'Second')).statusCode).toBe(200);
    expect(
      (await call({ method: 'DELETE', url: `/api/auth/second-factor/passkeys/${String(only)}` }))
        .statusCode,
    ).toBe(200);
  });
});

// ── step-up ─────────────────────────────────────────────────────────────

async function staleStepUp(session: string) {
  await h.db
    .updateTable('sessions')
    .set({ step_up_at: new Date(Date.now() - STEP_UP_MS - 1000) })
    .where('token_hash', '=', sha256Hex(session))
    .execute();
}
async function stepUpNow(session: string) {
  await h.db
    .updateTable('sessions')
    .set({ step_up_at: new Date() })
    .where('token_hash', '=', sha256Hex(session))
    .execute();
}

describe('step-up before each listed action', () => {
  let owner: { email: string; session: string; secret: string };
  let admin: { email: string; session: string };
  let moderator: { email: string; session: string };
  let slug: string;
  let orgId: number;

  beforeAll(async () => {
    const o = await enrolled('owner');
    await verify(o.call, code(o.secret));
    owner = { email: o.email, session: o.session, secret: o.secret };
    const aEmail = address('stepup-admin');
    await seat(h.db, aEmail, 'admin');
    admin = { email: aEmail, session: await signIn(h, aEmail) };
    const mEmail = address('stepup-mod');
    await seat(h.db, mEmail, 'moderator');
    moderator = { email: mEmail, session: await signIn(h, mEmail) };
    slug = (await launchedLogbook(h.db)).slug;
    const org = await h.db
      .insertInto('organizations')
      .values({ name: `Step-up org ${aEmail}`, verified_by: 'second-factor test' })
      .returning('id')
      .executeTakeFirstOrThrow();
    orgId = org.id;
  });

  const someone = () => address('stepup-subject');
  const LISTED: {
    what: string;
    who: () => { session: string };
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    url: () => string;
    payload?: () => object;
    /** Open to everybody signed in, asking a step-up only of role holders. */
    everybody?: true;
  }[] = [
    {
      what: "opening a reporter's email",
      who: () => moderator,
      method: 'POST',
      url: () => '/api/moderation/reports/00000000-0000-4000-8000-000000000000/contact',
      payload: () => ({ reason: 'checking' }),
    },
    {
      what: 'approving a journalist',
      who: () => owner,
      method: 'POST',
      url: () => '/api/owner/journalists/999999/approve',
    },
    {
      what: 'rejecting a journalist',
      who: () => owner,
      method: 'POST',
      url: () => '/api/owner/journalists/999999/reject',
    },
    {
      what: 'removing a journalist',
      who: () => owner,
      method: 'POST',
      url: () => '/api/owner/journalists/999999/revoke',
    },
    {
      what: 'granting a role',
      who: () => admin,
      method: 'POST',
      url: () => '/api/access/system-role',
      payload: () => ({ email: someone(), role: 'moderator' }),
    },
    {
      what: 'removing a role',
      who: () => admin,
      method: 'POST',
      url: () => '/api/access/system-role',
      payload: () => ({ email: someone(), role: 'user' }),
    },
    {
      what: 'making an organization, which names its first managers',
      who: () => admin,
      method: 'POST',
      url: () => '/api/orgs',
      payload: () => ({ name: `Org ${someone()}`, managerEmails: [someone()] }),
    },
    {
      what: 'adding somebody to an organization',
      who: () => admin,
      method: 'POST',
      url: () => `/api/orgs/${String(orgId)}/members`,
      payload: () => ({ email: someone(), role: 'coordinator' }),
    },
    {
      what: 'removing somebody from an organization',
      who: () => admin,
      method: 'DELETE',
      url: () => `/api/orgs/${String(orgId)}/members/${encodeURIComponent(someone())}`,
    },
    {
      what: 'inviting somebody into an organization',
      who: () => admin,
      method: 'POST',
      url: () => `/api/orgs/${String(orgId)}/invitations`,
      payload: () => ({ email: someone(), role: 'coordinator' }),
    },
    {
      what: 'approving an invitation',
      who: () => admin,
      method: 'POST',
      url: () => `/api/orgs/${String(orgId)}/invitations/${encodeURIComponent(someone())}/approve`,
    },
    {
      what: "handing the owner's seat on (the code)",
      who: () => owner,
      method: 'POST',
      url: () => '/api/access/owner/handover-code',
      payload: () => ({ email: someone() }),
    },
    {
      what: "handing the owner's seat on",
      who: () => owner,
      method: 'POST',
      url: () => '/api/access/owner/handover',
      payload: () => ({ email: someone(), code: '000000' }),
    },
    {
      what: "resetting somebody's second factor",
      who: () => owner,
      method: 'POST',
      url: () => '/api/access/second-factor/reset',
      payload: () => ({ email: someone() }),
    },
    {
      what: 'pausing intake',
      who: () => admin,
      method: 'PUT',
      url: () => '/api/admin/intake-switch',
      payload: () => ({ open: null }),
    },
    // Plan E's flood controls (PE3), before the agreements below: once a
    // moderator agreement is published, a moderator who has not accepted it
    // is refused before the step-up is asked.
    {
      what: 'bulk declining reports',
      who: () => moderator,
      method: 'POST',
      url: () => '/api/moderation/reports/bulk-decline',
      payload: () => ({
        thread_ids: ['00000000-0000-4000-8000-000000000000'],
        reason_code: 'duplicate',
      }),
    },
    {
      what: 'bulk declining tip links',
      who: () => moderator,
      method: 'POST',
      url: () => '/api/moderation/links/bulk-decline',
      payload: () => ({ from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' }),
    },
    {
      what: "pausing intake from the moderators' switch",
      who: () => moderator,
      method: 'POST',
      url: () => '/api/moderation/switches/pause',
      payload: () => ({ paused: false }),
    },
    {
      what: 'the puzzle switch',
      who: () => moderator,
      method: 'POST',
      url: () => '/api/moderation/switches/puzzle',
      payload: () => ({ level: 'normal' }),
    },
    {
      what: 'making a backup or an export',
      who: () => owner,
      method: 'POST',
      url: () => '/api/admin/copies',
      payload: () => ({ kind: 'backup' }),
    },
    {
      what: 'downloading a backup',
      who: () => owner,
      method: 'GET',
      url: () => '/api/admin/copies/backup/reportlog-nothing.dump',
    },
    {
      what: 'exporting the complete chain file',
      who: () => admin,
      method: 'GET',
      url: () => `/api/admin/chain/${slug}`,
    },
    {
      what: 'publishing the moderator agreement',
      who: () => admin,
      method: 'POST',
      url: () => '/api/admin/agreement/moderator',
      payload: () => ({}),
    },
    {
      what: 'publishing the journalist agreement',
      who: () => admin,
      method: 'POST',
      url: () => '/api/admin/agreement/journalist',
      payload: () => ({}),
    },
    // Look packs (stage 6): they change every public page. An empty zip is
    // refused for itself once the step-up is given; replacing is the same call.
    {
      what: 'installing or replacing a look pack',
      who: () => admin,
      method: 'POST',
      url: () => '/api/admin/looks',
      payload: () => ({ zip: '' }),
    },
    {
      what: 'removing a look pack',
      who: () => owner,
      method: 'DELETE',
      url: () => '/api/admin/looks/no-such-pack',
    },
    // A role holder deleting their own account (identity/account.ts). The
    // wrong address is refused for itself once the step-up is given, so the
    // moderator this file shares is never actually deleted.
    {
      what: 'deleting your own account, as a role holder',
      who: () => moderator,
      method: 'POST',
      url: () => '/api/auth/account/delete',
      payload: () => ({ email: someone() }),
      everybody: true,
    },
  ];

  for (const action of LISTED) {
    it(`${action.what}: refused without a step-up in the last 5 minutes`, async () => {
      const { session } = action.who();
      const call = live(session);
      const send = () =>
        call({
          method: action.method,
          url: action.url(),
          ...(action.payload ? { payload: action.payload() } : {}),
        });
      await staleStepUp(session);
      const refused = await send();
      expect(refused.statusCode, refused.body).toBe(403);
      expect(refused.json()).toMatchObject({ error: { code: 'step_up_required' } });
      // A fresh one gets past the step-up (the route may still say no for its own reasons).
      await stepUpNow(session);
      const after = await send();
      expect(after.body).not.toContain('step_up_required');
    });
  }

  it('the step-up itself: a code in a session that has proved its factor, good for 5 minutes', async () => {
    const call = live(owner.session);
    await staleStepUp(owner.session);
    expect((await me(call)).stepUpUntil).toBeNull();
    await nextStep();
    const res = await verify(call, code(owner.secret));
    expect(res.statusCode).toBe(200);
    const until = Date.parse(res.json<{ stepUpUntil: string }>().stepUpUntil);
    expect(Math.abs(until - (Date.now() + STEP_UP_MS))).toBeLessThan(10_000);
    const reset = {
      method: 'POST' as const,
      url: '/api/access/second-factor/reset',
      payload: { email: someone() },
    };
    expect((await call(reset)).body).not.toContain('step_up_required');
    // Five minutes and a second later, it has run out.
    await h.db
      .updateTable('sessions')
      .set({ step_up_at: new Date(Date.now() - STEP_UP_MS - 1000) })
      .where('token_hash', '=', sha256Hex(owner.session))
      .execute();
    expect((await call(reset)).json()).toMatchObject({ error: { code: 'step_up_required' } });
  }, 40_000);

  it('a person without the role is told that, not asked for a code', async () => {
    const plain = live(await signIn(h, address('stepup-plain')));
    for (const action of LISTED) {
      const res = await plain({
        method: action.method,
        url: action.url(),
        ...(action.payload ? { payload: action.payload() } : {}),
      });
      expect(res.body, action.what).not.toContain('step_up_required');
      // Somebody with no role may delete their own account: refused here
      // only because the address typed back is not theirs.
      if (action.everybody) expect(res.statusCode, action.what).toBe(400);
      else expect([401, 403], action.what).toContain(res.statusCode);
    }
  });

  it('ordinary moderation never asks again', async () => {
    await staleStepUp(moderator.session);
    const call = live(moderator.session);
    for (const url of ['/api/moderation/reports', '/api/moderation/rejection-reasons']) {
      expect((await call({ method: 'GET', url })).body, url).not.toContain('step_up_required');
    }
  });
});

// ── resets ──────────────────────────────────────────────────────────────

describe("resetting somebody's second factor", () => {
  it('the owner does, on the record: their factors go and they are signed out everywhere', async () => {
    const o = await enrolled('owner');
    await verify(o.call, code(o.secret));
    const a = await enrolled('admin');
    await verify(a.call, code(a.secret));
    const res = await o.call({
      method: 'POST',
      url: '/api/access/second-factor/reset',
      payload: { email: a.email },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await me(a.call)).toEqual({ signedIn: false });
    const id = await userId(a.email);
    for (const table of [
      'two_factor_totp',
      'two_factor_passkeys',
      'two_factor_recovery_codes',
      'sessions',
    ] as const) {
      const n = await h.db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('user_id', '=', id)
        .executeTakeFirstOrThrow();
      expect(Number(n.n), table).toBe(0);
    }
    const audit = await h.db
      .selectFrom('role_audit')
      .selectAll()
      .where('subject_email', '=', a.email)
      .where('axis', '=', 'second_factor')
      .execute();
    expect(audit).toMatchObject([
      { actor_email: o.email, action: 'revoke', detail: 'second factor reset, by the owner' },
    ]);
    // The record cannot be edited.
    await expect(
      sql`UPDATE role_audit SET detail = 'nothing' WHERE id = ${audit[0]?.id ?? 0}`.execute(h.db),
    ).rejects.toThrow();
    // Their next sign-in sets one up again.
    const back = live(await signInByEmailOnly(h, a.email));
    expect(await me(back)).toMatchObject({ role: 'user', secondFactor: 'set-up' });
  });

  it('nobody but the owner can', async () => {
    const target = await enrolled('moderator');
    for (const role of ['admin', 'access_manager', 'moderator', 'journalist', 'user']) {
      const email = address(`resetter-${role}`);
      await seat(h.db, email, role);
      const call = live(await signIn(h, email));
      const res = await call({
        method: 'POST',
        url: '/api/access/second-factor/reset',
        payload: { email: target.email },
      });
      expect(res.statusCode, role).toBe(403);
      expect(res.json(), role).toMatchObject({ error: { code: 'forbidden' } });
    }
    expect(
      await h.db
        .selectFrom('two_factor_totp')
        .select('user_id')
        .where('user_id', '=', await userId(target.email))
        .executeTakeFirst(),
    ).toBeDefined();
  });

  it("the owner's own is refused from the screen: only the server resets it", async () => {
    const o = await enrolled('owner');
    await verify(o.call, code(o.secret));
    const res = await o.call({
      method: 'POST',
      url: '/api/access/second-factor/reset',
      payload: { email: o.email },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'own_second_factor' } });
  });

  it('`reportlog reset-2fa <email>` on the server resets anybody, the owner included, on the record', async () => {
    const o = await enrolled('owner');
    await verify(o.call, code(o.secret));
    const api = fileURLToPath(new URL('../../', import.meta.url));
    const run = (arg: string) =>
      promisify(execFile)('node', ['src/identity/reset-two-factor.ts', arg], {
        cwd: api,
        env: { ...process.env, DATABASE_URL: inject('databaseUrl') },
      });
    const { stderr } = await run(o.email);
    expect(stderr).toContain('reset');
    expect(await me(o.call)).toEqual({ signedIn: false });
    const audit = await h.db
      .selectFrom('role_audit')
      .selectAll()
      .where('subject_email', '=', o.email)
      .where('axis', '=', 'second_factor')
      .execute();
    expect(audit).toMatchObject([
      { actor_email: SERVER_ACTOR, action: 'revoke', detail: 'second factor reset, on the server' },
    ]);
    const back = live(await signInByEmailOnly(h, o.email));
    expect(await me(back)).toMatchObject({ heldRole: 'owner', secondFactor: 'set-up' });
    // An address with no account, or none at all, is said plainly.
    await expect(run(address('nobody'))).rejects.toMatchObject({ code: 1 });
    await expect(run('not-an-address')).rejects.toMatchObject({ code: 64 });
  });
});

// ── what is never written down ──────────────────────────────────────────

describe('logs', () => {
  it('hold no code, secret, recovery code or address of the client', async () => {
    const lines: string[] = [];
    const mailer = capturingMailer();
    const app = await buildApp({
      config: { LOG_LEVEL: 'trace', SITE_ORIGIN: SITE, TWO_FACTOR_KEY },
      db: h.db,
      mailer,
      logStream: { write: (l: string) => lines.push(l) },
    });
    try {
      const hh = { ...h, app, mailer };
      const email = address('logs');
      await seat(h.db, email, 'admin');
      const s1 = await signInByEmailOnly(hh, email);
      const { secret, recoveryCodes } = await setUpTotp(hh, s1);
      const s2 = await signInByEmailOnly(hh, email);
      const typed = code(secret, 60_000); // wrong on purpose: refused, and still not logged
      await app.inject({
        method: 'POST',
        url: '/api/auth/second-factor/verify',
        payload: { code: typed },
        cookies: { session_token: s2 },
        remoteAddress: '203.0.113.9',
      });
      await app.inject({
        method: 'POST',
        url: '/api/auth/second-factor/verify',
        payload: { code: recoveryCodes[0] },
        cookies: { session_token: s2 },
        remoteAddress: '203.0.113.9',
      });
      const all = lines.join('\n');
      expect(all.length).toBeGreaterThan(0);
      for (const needle of [secret, typed, ...recoveryCodes, '203.0.113.9', s1, s2]) {
        expect(all).not.toContain(needle);
      }
    } finally {
      await app.close();
    }
  });
});
