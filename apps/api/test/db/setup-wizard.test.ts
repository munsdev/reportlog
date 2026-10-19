/**
 * The whole first-run wizard, end to end, against a real database and the
 * real app: the owner, then the name, the starting point, publishing, files
 * and the look, then the site password.
 *
 * The middle five steps have no routes of their own. Each writes through the
 * route its owner's settings screen uses (site, templates, moderation, files),
 * as the owner, who satisfies an administrator's guard. So what is tested
 * here is the wizard as the browser walks it, and the two things the wizard
 * must never allow:
 *
 * - it runs once: after the last step, every step of setup refuses;
 * - it cannot be reached in front of the site password, at any step, and
 *   the owner's seat comes from nowhere but its owner step.
 *
 * setup.test.ts covers the owner and password steps in detail (ported from
 * legacy setup-selftest); this file is the steps legacy's script left to
 * "G's and F's", and the journey through all of them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storedPublicArchive } from '../../src/board/publication.ts';
import { siteLayer } from '../../src/files/limits.ts';
import { writeSiteAccess } from '../../src/identity/siteAccess.ts';
import { readSettings } from '../../src/site/settings.ts';
import { address, codeFor, cookieFrom, harness, liftCurtain, roleOf } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';

let h: Harness;
const INSTALL_PW = 'INSTALLPW-W1';
const OWNER = address('owner-wizard');
let curtain = '';
let session = '';
let saved: {
  settings: Awaited<ReturnType<typeof readSettings>>;
  archive: boolean | null;
  files: boolean | null;
  intake: boolean | null;
};

type Method = 'GET' | 'POST' | 'PUT';
const call = (
  method: Method,
  url: string,
  payload?: object,
  cookies: Record<string, string> = {},
) => h.app.inject({ method, url, ...(payload ? { payload } : {}), cookies });
const asOwner = (method: Method, url: string, payload?: object) =>
  call(method, url, payload, { site_access: curtain, session_token: session });

/** Every call the wizard makes after the owner is seated, in order. */
const LATER_STEPS: [Method, string, object | undefined][] = [
  ['GET', '/api/admin/site', undefined],
  ['PUT', '/api/admin/site/name', { name: 'Polling "Watch"' }],
  ['GET', '/api/admin/templates', undefined],
  ['POST', '/api/admin/templates', { template: 'elections' }],
  ['PUT', '/api/admin/moderation/archive', { published: true }],
  ['GET', '/api/admin/files/settings', undefined],
  ['PUT', '/api/admin/files/settings', { enabled: true }],
  ['PUT', '/api/admin/site/look', { palette: 'harbour', theme: 'plain' }],
];

beforeAll(async () => {
  h = await harness();
  saved = {
    settings: await readSettings(h.db),
    archive: await storedPublicArchive(h.db),
    files: (await siteLayer(h.db)).enabled,
    intake:
      (await h.db.selectFrom('intake_settings').select('intake_enabled').executeTakeFirst())
        ?.intake_enabled ?? null,
  };
  // A deployment as the installer leaves it (as setup.test.ts does).
  await h.db
    .updateTable('users')
    .set({ role: 'user' })
    .where('role', 'in', ['owner', 'admin'])
    .execute();
  await h.db
    .updateTable('site_access')
    .set({ setup_completed_at: null })
    .where('id', '=', true)
    .execute();
  await writeSiteAccess(h.db, { password: INSTALL_PW });
});

afterAll(async () => {
  await h.db
    .updateTable('users')
    .set({ role: 'user' })
    .where('role', 'in', ['owner', 'admin'])
    .execute();
  await h.db
    .updateTable('site_settings')
    .set({
      site_name: saved.settings.site_name,
      palette: saved.settings.palette,
      theme: saved.settings.theme,
      template_applied: null,
      template_applied_at: null,
    })
    .where('id', '=', true)
    .execute();
  await h.db.deleteFrom('site_copy').execute();
  await h.db
    .updateTable('moderation_settings')
    .set({ public_archive_enabled: saved.archive })
    .execute();
  await h.db.updateTable('file_settings').set({ attachments_enabled: saved.files }).execute();
  await h.db.updateTable('intake_settings').set({ intake_enabled: saved.intake }).execute();
  await liftCurtain(h.db);
  await h.close();
});

describe('in front of the site password', () => {
  it('no step of the wizard can be reached, not even the ones that write settings', async () => {
    for (const [method, url, payload] of [
      ['GET', '/api/setup/status', undefined] as const,
      ['POST', '/api/setup/code', { email: address('stranger') }] as const,
      ['POST', '/api/setup/owner', { email: address('stranger'), code: '000000' }] as const,
      ...LATER_STEPS,
      ['POST', '/api/setup/curtain', { decision: 'keep' }] as const,
    ]) {
      const res = await call(method, url, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.json(), `${method} ${url}`).toMatchObject({ error: { code: 'locked' } });
    }
  });
});

describe('behind it, before anybody owns the deployment', () => {
  it('the later steps refuse: they are an administrator’s, and nobody is one yet', async () => {
    curtain =
      cookieFrom(
        await call('POST', '/api/site-access/unlock', { password: INSTALL_PW }),
        'site_access',
      ) ?? '';
    expect(curtain).not.toBe('');
    for (const [method, url, payload] of LATER_STEPS) {
      const res = await call(method, url, payload, { site_access: curtain });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
    expect((await readSettings(h.db)).site_name).toBe(saved.settings.site_name);
  });
});

describe('walking the wizard', () => {
  it('step one seats the owner, by the code in the email', async () => {
    const asked = await call('POST', '/api/setup/code', { email: OWNER }, { site_access: curtain });
    expect(asked.statusCode).toBe(200);
    const res = await call(
      'POST',
      '/api/setup/owner',
      { email: OWNER, code: codeFor(h.mailer, OWNER) },
      { site_access: curtain },
    );
    expect(res.statusCode).toBe(200);
    session = cookieFrom(res, 'session_token') ?? '';
    expect(await roleOf(h.db, OWNER)).toBe('owner');
  });

  it('a reloaded tab learns the owner exists and setup is not finished', async () => {
    expect((await asOwner('GET', '/api/setup/status')).json()).toMatchObject({
      needed: true,
      hasOwner: true,
    });
  });

  it('the name, through the name screen’s own route and its rules', async () => {
    const bad = await asOwner('PUT', '/api/admin/site/name', { name: 'Polling "Watch' });
    expect(bad.statusCode).toBe(400);
    const res = await asOwner('PUT', '/api/admin/site/name', { name: 'Polling "Watch"' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Polling "Watch"' });
  });

  it('the starting point, which leaves the name just typed alone', async () => {
    const list = await asOwner('GET', '/api/admin/templates');
    expect(list.statusCode).toBe(200);
    const res = await asOwner('POST', '/api/admin/templates', { template: 'elections' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      applied: 'elections',
      // -2 and so on if an earlier file in this run made one: files share the database.
      logbook: { slug: expect.stringMatching(/^election-incidents(-\d+)?$/) as unknown },
    });
    expect((await readSettings(h.db)).site_name).toBe('Polling "Watch"');
  });

  it('publishing, which can overrule what the starting point chose', async () => {
    expect(await storedPublicArchive(h.db)).toBe(true);
    const res = await asOwner('PUT', '/api/admin/moderation/archive', { published: false });
    expect(res.json()).toEqual({ published: false, stored: false });
  });

  it('files, whether or not storage is set up yet', async () => {
    const res = await asOwner('PUT', '/api/admin/files/settings', { enabled: false });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ enabled_stored: false, enabled: false });
  });

  it('the look, through the look screen’s own route', async () => {
    const res = await asOwner('PUT', '/api/admin/site/look', {
      palette: 'harbour',
      theme: 'plain',
    });
    expect(res.json()).toMatchObject({ look: { palette: 'harbour', theme: 'plain' } });
  });

  it('and setup is STILL not finished: only the password decision ends it', async () => {
    expect((await asOwner('GET', '/api/setup/status')).json()).toMatchObject({ needed: true });
  });

  it('the site password, the last step, ends it', async () => {
    const res = await asOwner('POST', '/api/setup/curtain', { decision: 'keep' });
    expect(res.json()).toEqual({ ok: true, changed: false });
  });
});

describe('once setup is done', () => {
  it('it refuses to run again, at every step that is setup’s own', async () => {
    expect((await asOwner('GET', '/api/setup/status')).json()).toMatchObject({ needed: false });
    const other = address('second-owner');
    const code = await call('POST', '/api/setup/code', { email: other }, { site_access: curtain });
    expect(code.statusCode).toBe(409);
    expect(code.json()).toMatchObject({ error: { code: 'already_set_up' } });
    const claim = await call(
      'POST',
      '/api/setup/owner',
      { email: other, code: '123456' },
      { site_access: curtain },
    );
    expect(claim.statusCode).toBe(409);
    expect((await asOwner('POST', '/api/setup/curtain', { decision: 'keep' })).statusCode).toBe(
      409,
    );
    expect(await roleOf(h.db, other)).toBeUndefined();
  });

  it('even if the flag were reopened, the owner step stays shut while anybody holds a seat', async () => {
    // Not a path the software offers: the owner's seat comes from this step
    // or the two-party handover, and the step checks for a seat as well as
    // for the flag, so clearing the flag by hand does not reopen it.
    await h.db
      .updateTable('site_access')
      .set({ setup_completed_at: null })
      .where('id', '=', true)
      .execute();
    try {
      const late = address('late-claimant');
      const asked = await call(
        'POST',
        '/api/setup/code',
        { email: late },
        { site_access: curtain },
      );
      expect(asked.statusCode).toBe(409);
      expect(await roleOf(h.db, late)).toBeUndefined();
    } finally {
      await h.db
        .updateTable('site_access')
        .set({ setup_completed_at: new Date() })
        .where('id', '=', true)
        .execute();
    }
  });

  it('a deployment template, applied later by an administrator, never touches the seat', async () => {
    const res = await asOwner('POST', '/api/admin/templates', { template: 'blank' });
    expect(res.statusCode).toBe(200);
    const holders = await h.db
      .selectFrom('users')
      .select(['email', 'role'])
      .where('role', 'in', ['owner', 'admin'])
      .execute();
    expect(holders).toEqual([{ email: OWNER, role: 'owner' }]);
  });

  it('left the seating and the decision in the trail, and nothing else about the seat', async () => {
    const trail = await h.db
      .selectFrom('role_audit')
      .select(['axis', 'detail'])
      .where('actor_email', '=', OWNER)
      .orderBy('id')
      .execute();
    expect(trail).toEqual([
      { axis: 'owner', detail: 'owner, by first-run setup' },
      { axis: 'site', detail: 'finished setup, keeping the site password' },
    ]);
  });
});
