/**
 * Look packs (stage 6; docs/design/looks/README.md section 05,
 * docs/design/checks.md section 01 PACKS): the deliberately bad pack is
 * refused with each sentence and nothing is written; the good pack installs,
 * is offered and painted, is served from this site only and in front of the
 * password, and is replaced or removed only when nothing is wearing it.
 *
 * The two packs are folders under test/fixtures/looks/, zipped here
 * (test/zip.ts). The bad one carries, on purpose: a stylesheet, a font that
 * is not WOFF2, a palette id the built-in pack already has, text under
 * 4.5:1, a blue "serious", a theme naming a font nobody provides, a radius
 * out of range, and a look marked as the default.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STEP_UP_MS } from '../../src/identity/secondFactor.ts';
import { hashPassword, sha256Hex } from '../../src/identity/secrets.ts';
import { COMMAND_ACTOR, lookCommand } from '../../src/looks/command.ts';
import { writeSettings } from '../../src/site/settings.ts';
import { FIXTURES, fixturePack, zip } from '../zip.ts';
import { address, as, harness, liftCurtain, seat, signIn } from './identity-helpers.ts';
import type { Harness } from './identity-helpers.ts';

let h: Harness;
let admin: ReturnType<typeof as>;
let adminEmail: string;
const base64 = (b: Buffer) => b.toString('base64');

beforeAll(async () => {
  h = await harness();
  adminEmail = address('looks-admin');
  await seat(h.db, adminEmail, 'admin');
  admin = as(h, await signIn(h, adminEmail));
  await clean();
});

afterAll(async () => {
  await clean();
  await h.close();
});

/** Put the site back on a built-in look and remove every pack, as other files expect. */
async function clean() {
  await writeSettings(h.db, { palette: 'flint', theme: 'signal' });
  await h.db.deleteFrom('look_packs').execute();
}

const checkZip = (z: Buffer) =>
  admin({ method: 'POST', url: '/api/admin/looks/check', payload: { zip: base64(z) } });
const installZip = (z: Buffer) =>
  admin({ method: 'POST', url: '/api/admin/looks', payload: { zip: base64(z) } });
const remove = (id: string) => admin({ method: 'DELETE', url: `/api/admin/looks/${id}` });
const packCount = async () =>
  Number(
    (
      await h.db
        .selectFrom('look_packs')
        .select((eb) => eb.fn.countAll().as('n'))
        .executeTakeFirstOrThrow()
    ).n,
  );
const auditFor = (detail: string) =>
  h.db
    .selectFrom('role_audit')
    .select(['actor_email', 'axis', 'action', 'detail'])
    .where('detail', 'like', `%${detail}%`)
    .execute();

// The sentences docs/design/checks.md section 01 names, one per fault.
const BAD_PACK_SENTENCES = [
  '"style.css" is not allowed in a pack. Only look.json and fonts/*.woff2.',
  '"fonts/BrokenSans-400.woff2" is not a WOFF2 font.',
  'A palette called "flint" is already installed from another pack.',
  /^Palette "faint": text-muted on surface is \d\.\d\d:1; it needs 4\.5:1\.$/,
  /^Palette "bluish": serious must be a red \(its hue is \d+\)\.$/,
  'Theme "unknown-font" names the font "Comic Neue", which neither this pack nor an installed one provides.',
  'Theme "round" radius must be a number from 0 to 24.',
  'Only the built-in pack may mark the default look ("broken").',
];

function expectEverySentence(problems: string[]) {
  for (const s of BAD_PACK_SENTENCES) {
    expect(
      problems.some((p) => (typeof s === 'string' ? p === s : s.test(p))),
      `${String(s)}\n  in: ${problems.join('\n      ')}`,
    ).toBe(true);
  }
}

describe('the deliberately bad pack', () => {
  it('is refused by the check with each sentence, and nothing is installed', async () => {
    const res = await checkZip(fixturePack('bad'));
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<{ problems: string[]; pack: unknown }>();
    expectEverySentence(body.problems);
    expect(body.pack).toBeNull();
    expect(await packCount()).toBe(0);
  });

  it('is refused by the installer with the same sentences, nothing written and nothing recorded', async () => {
    const res = await installZip(fixturePack('bad'));
    expect(res.statusCode).toBe(400);
    const { error } = res.json<{ error: { code: string; message: string } }>();
    expect(error.code).toBe('pack_refused');
    expect(error.message).toContain('"style.css" is not allowed in a pack.');
    expect(error.message).toContain('Only the built-in pack may mark the default look ("broken").');
    expect(await packCount()).toBe(0);
    expect(await auditFor('look pack broken')).toEqual([]);
  });

  it('and by the command line, in the same words', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-look-'));
    writeFileSync(join(dir, 'broken.zip'), fixturePack('bad'));
    const lines: string[] = [];
    // A relative path, read from where the person was, not from apps/api.
    expect(await lookCommand(h.db, ['add', 'broken.zip'], dir, (l) => lines.push(l))).toBe(1);
    expect(lines[0]).toBe('Nothing was installed:');
    expectEverySentence(lines.slice(1).map((l) => l.replace(/^ {2}- /, '')));
    expect(await packCount()).toBe(0);
  });
});

describe('a zip that reaches outside the pack', () => {
  it.each([
    ['../look.json', 'points outside the pack'],
    ['/etc/look.json', 'is an absolute path'],
    ['fonts/../../x.woff2', 'points outside the pack'],
  ])('%s is refused before anything is unpacked or written', async (name, words) => {
    const res = await installZip(fixturePack('good', undefined, [{ name, data: 'x' }]));
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { message: string } }>().error.message).toContain(words);
    expect(await packCount()).toBe(0);
  });

  it('a link is refused', async () => {
    const res = await checkZip(
      fixturePack('good', undefined, [{ name: 'fonts/x.woff2', data: '/etc', mode: 0o120777 }]),
    );
    expect(res.json<{ problems: string[] }>().problems).toEqual([
      '"fonts/x.woff2" is a link. A pack holds only files.',
    ]);
  });

  it('a look.json inside a folder is explained', async () => {
    const res = await checkZip(zip([{ name: 'tideline/look.json', data: '{}' }]));
    expect(res.json<{ problems: string[] }>().problems).toEqual([
      'look.json must be at the top of the .zip, not inside a folder. Zip what is in the folder, not the folder itself.',
    ]);
  });

  it('a look.json that is not JSON', async () => {
    const res = await checkZip(zip([{ name: 'look.json', data: '{ nope' }]));
    expect(res.json<{ problems: string[] }>().problems).toEqual(['look.json is not valid JSON.']);
  });
});

describe('what only this site can say about a pack', () => {
  const problemsOf = async (edit: (p: Record<string, unknown>) => void) =>
    (await checkZip(fixturePack('good', edit))).json<{ problems: string[] }>().problems;

  it('a field the format does not name, or a dark flag that is not true or false', async () => {
    // Either would be stored and sent back out on every page: a 0 for dark
    // (which check() reads as false, rightly for a light page) would make
    // the site's own answer fail its schema.
    expect(
      await problemsOf((p) => {
        p.css = 'body { background: url(https://x.example/a.png) }';
        const [palette] = p.palettes as Record<string, unknown>[];
        if (palette) palette.dark = 0;
      }),
    ).toEqual([
      'look.json has a field this site does not read: "css".',
      'Palette "tideline" must say dark as true or false.',
    ]);
  });

  it('a pack with no version', async () => {
    expect(await problemsOf((p) => delete p.version)).toEqual([
      'The pack needs a version, like 1.0.0.',
    ]);
  });

  it('the built-in pack’s own id', async () => {
    expect(await problemsOf((p) => (p.id = 'reportlog-core'))).toEqual([
      'That is the built-in pack’s id. A pack needs its own.',
    ]);
  });

  it('a palette or theme id a site may still have saved from before the look library', async () => {
    const problems = await problemsOf((p) => {
      const [palette] = p.palettes as { id: string }[];
      if (palette) palette.id = 'harbour';
      (p.looks as { palette: string }[]).forEach((l) => (l.palette = 'harbour'));
      (p.looks as { id: string }[]).splice(1);
    });
    expect(problems).toEqual([
      '"harbour" was the name of a built-in palette before, and a site may still have it saved. Choose another id.',
    ]);
  });

  it('a font family the built-in looks already have', async () => {
    const problems = await problemsOf((p) => {
      const fonts = p.fonts as { family: string }[];
      if (fonts[0]) fonts[0].family = 'Public Sans';
      for (const t of p.themes as {
        type: { body: { family: string }; label: { family: string } };
      }[]) {
        t.type.body.family = 'Public Sans';
        t.type.label.family = 'Public Sans';
      }
    });
    expect(problems).toEqual([
      'The font "Public Sans" is already built in. Name it in a theme instead of shipping it again.',
    ]);
  });
});

describe('the good pack', () => {
  const good = fixturePack('good');
  let stylesheet = '';

  it('passes the check, and says what it adds', async () => {
    const res = await checkZip(good);
    expect(res.json()).toMatchObject({
      problems: [],
      replaces: null,
      pack: {
        id: 'tideline',
        version: '1.0.0',
        palettes: [
          { id: 'tideline', dark: false },
          { id: 'tideline-night', dark: true },
        ],
        themes: [{ id: 'tideline' }],
        looks: [{ id: 'tideline' }, { id: 'tideline-night' }],
        fonts: ['Tideline Sans'],
      },
    });
    expect(await packCount()).toBe(0);
  });

  it('installs, recorded with who did it', async () => {
    const res = await installZip(good);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<{ pack: { stylesheet: string; installed_by: string }; replaced: null }>();
    expect(body.replaced).toBeNull();
    expect(body.pack.installed_by).toBe(adminEmail);
    stylesheet = body.pack.stylesheet;
    expect(stylesheet).toMatch(/^\/api\/looks\/tideline\/[0-9a-f]{64}\.css$/);
    expect(await auditFor('installed the look pack tideline 1.0.0')).toEqual([
      {
        actor_email: adminEmail,
        axis: 'site',
        action: 'change',
        detail: 'installed the look pack tideline 1.0.0',
      },
    ]);
  });

  it('is listed, and appears among what the site may wear', async () => {
    const list = await admin({ method: 'GET', url: '/api/admin/looks' });
    expect(list.json()).toMatchObject({
      packs: [{ id: 'tideline', stylesheet, in_use: null, installed_by: adminEmail }],
    });
    const site = (await h.app.inject({ method: 'GET', url: '/api/site' })).json<{
      look: { stylesheets: string[] };
    }>();
    expect(site.look.stylesheets).toEqual([stylesheet]);
    const set = await admin({
      method: 'PUT',
      url: '/api/admin/site/look',
      payload: { palette: 'tideline-night', theme: 'tideline' },
    });
    expect(set.statusCode, set.body).toBe(200);
    const after = (await h.app.inject({ method: 'GET', url: '/api/site' })).json<{
      look: Record<string, unknown>;
    }>();
    expect(after.look).toEqual({
      palette: 'tideline-night',
      theme: 'tideline',
      panel_head: 'title-bar',
      texture: 'none',
      dark: true,
      stylesheets: [stylesheet],
    });
  });

  it('the web manifest takes its two colours from the pack holding the palette', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/site/manifest.webmanifest' });
    const fixture = JSON.parse(readFileSync(join(FIXTURES, 'good', 'look.json'), 'utf8')) as {
      palettes: { id: string; colors: Record<string, string> }[];
    };
    const night = fixture.palettes.find((p) => p.id === 'tideline-night');
    expect(night).toBeDefined();
    expect(res.json()).toMatchObject({
      background_color: night?.colors.background,
      theme_color: night?.colors['background-deep'],
    });
  });

  it('its stylesheet is served from this site, cached forever, naming fonts on this site only', async () => {
    const res = await h.app.inject({ method: 'GET', url: stylesheet });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(createHash('sha256').update(res.body).digest('hex')).toBe(
      /([0-9a-f]{64})\.css$/.exec(stylesheet)?.[1],
    );
    const urls = [...res.body.matchAll(/url\('([^']*)'\)/g)].map((m) => m[1] ?? '');
    expect(urls).toHaveLength(1);
    for (const u of urls) expect(u).toMatch(/^\/api\/looks\/tideline\/[0-9a-f]{64}\.woff2$/);
    expect(res.body).not.toMatch(/https?:|@import|\/\//);
    expect(res.body).toContain("[data-palette='tideline-night']");
    expect(res.body).not.toContain(':root');

    const font = await h.app.inject({ method: 'GET', url: urls[0] ?? '' });
    expect(font.statusCode).toBe(200);
    expect(font.headers['content-type']).toBe('font/woff2');
    expect(font.rawPayload.subarray(0, 4).toString()).toBe('wOF2');
  });

  it('serves nothing else under /api/looks', async () => {
    const hash = 'a'.repeat(64);
    for (const url of [
      `/api/looks/tideline/${hash}.css`,
      `/api/looks/tideline/${hash}.woff2`,
      `/api/looks/tideline/${hash}.js`,
      '/api/looks/tideline/look.json',
      `/api/looks/nobody/${hash}.css`,
      stylesheet.replace('/tideline/', '/flint/'),
    ]) {
      expect((await h.app.inject({ method: 'GET', url })).statusCode, url).toBe(404);
    }
  });

  it('is served in front of the site password, and named by the lock screen’s own call', async () => {
    await h.db
      .updateTable('site_access')
      .set({ enabled: true, password_hash: await hashPassword('look-packs-password') })
      .where('id', '=', true)
      .execute();
    try {
      const status = await h.app.inject({ method: 'GET', url: '/api/site-access/status' });
      expect(status.json()).toMatchObject({
        locked: true,
        look: { palette: 'tideline-night', dark: true, stylesheets: [stylesheet] },
      });
      expect((await h.app.inject({ method: 'GET', url: stylesheet })).statusCode).toBe(200);
      // The rest is still behind it.
      expect((await h.app.inject({ method: 'GET', url: '/api/site' })).statusCode).toBe(401);
    } finally {
      await liftCurtain(h.db);
    }
  });

  it('is not removed while the site wears it, and the screen says which', async () => {
    const res = await remove('tideline');
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { message: string } }>().error.message).toBe(
      'The site is wearing the palette "Tideline night", and it comes from this pack. Choose another look on the Look screen first. ' +
        'The site is wearing the theme "Tideline", and it comes from this pack. Choose another look on the Look screen first.',
    );
    const list = (await admin({ method: 'GET', url: '/api/admin/looks' })).json<{
      packs: { in_use: string | null }[];
    }>();
    expect(list.packs[0]?.in_use).toContain('Tideline night');
  });

  it('and the database holds the same rule if the application forgets', async () => {
    await expect(
      h.db.deleteFrom('look_packs').where('id', '=', 'tideline').execute(),
    ).rejects.toThrow(/the site wears the palette tideline-night from look pack tideline/);
  });

  it('is replaced only by a higher version, and never by one that drops what the site wears', async () => {
    const same = await checkZip(good);
    expect(same.json<{ problems: string[] }>().problems).toEqual([
      '"Tideline" 1.0.0 is already installed. A replacement needs a higher version.',
    ]);
    const dropping = await checkZip(
      fixturePack('good', (p) => {
        p.version = '1.1.0';
        p.palettes = (p.palettes as { id: string }[]).filter((x) => x.id !== 'tideline-night');
        p.looks = (p.looks as { palette: string }[]).filter((l) => l.palette !== 'tideline-night');
      }),
    );
    expect(dropping.json<{ problems: string[] }>().problems).toEqual([
      'The site is wearing the palette "Tideline night", and this version does not have it. Choose another look on the Look screen first.',
    ]);
    const res = await installZip(fixturePack('good', (p) => (p.version = '1.2.0')));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ replaced: '1.0.0', pack: { version: '1.2.0' } });
    expect(await auditFor('replaced the look pack tideline 1.0.0 with 1.2.0')).toHaveLength(1);
    expect(await packCount()).toBe(1);
  });

  it('is not removed while another pack uses its font', async () => {
    const other = await installZip(
      zip([
        {
          name: 'look.json',
          data: JSON.stringify({
            format: 1,
            id: 'tideline-extra',
            label: 'Tideline extra',
            version: '1.0.0',
            looks: [
              { id: 'tideline-day', label: 'Tideline day', palette: 'tideline', theme: 'desk' },
            ],
          }),
        },
      ]),
    );
    expect(other.statusCode, other.body).toBe(200);
    await writeSettings(h.db, { palette: 'flint', theme: 'signal' });
    const res = await remove('tideline');
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { message: string } }>().error.message).toBe(
      'The look "Tideline day" in the pack "Tideline extra" uses its palette.',
    );
    expect((await remove('tideline-extra')).statusCode).toBe(200);
  });

  it('is removed once nothing wears it, recorded, and its files go with it', async () => {
    const res = await remove('tideline');
    expect(res.statusCode, res.body).toBe(200);
    expect(await auditFor('removed the look pack tideline 1.2.0')).toHaveLength(1);
    expect(await h.db.selectFrom('look_pack_files').selectAll().execute()).toEqual([]);
    const site = (await h.app.inject({ method: 'GET', url: '/api/site' })).json<{
      look: { stylesheets: string[] };
    }>();
    expect(site.look.stylesheets).toEqual([]);
    expect((await remove('tideline')).statusCode).toBe(404);
  });

  it('a palette from a pack since removed is painted as the default, never as nothing', async () => {
    await h.db
      .updateTable('site_settings')
      .set({ palette: 'tideline-night', theme: 'tideline' })
      .where('id', '=', true)
      .execute();
    const site = (await h.app.inject({ method: 'GET', url: '/api/site' })).json<{
      look: { palette: string; theme: string };
    }>();
    expect(site.look).toMatchObject({ palette: 'platinum', theme: 'desk' });
    await writeSettings(h.db, { palette: 'flint', theme: 'signal' });
  });
});

describe('the command line', () => {
  it('adds, lists and removes with the same installer, recorded as the server', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-look-'));
    writeFileSync(join(dir, 'tideline.zip'), fixturePack('good'));
    const lines: string[] = [];
    const say = (l: string) => lines.push(l);
    expect(await lookCommand(h.db, ['add', join(dir, 'tideline.zip')], '/', say)).toBe(0);
    expect(lines.pop()).toBe('Installed Tideline 1.0.0: 2 palettes, 1 theme, 2 looks.');
    expect(await auditFor('installed the look pack tideline 1.0.0')).toContainEqual(
      expect.objectContaining({ actor_email: COMMAND_ACTOR }),
    );
    expect(await lookCommand(h.db, ['list'], dir, say)).toBe(0);
    expect(lines.slice(-2)).toEqual([
      'ReportLog, built in',
      expect.stringMatching(
        /^tideline 1\.0\.0 {2}Tideline {2}· 2 palettes · 1 theme · 2 looks {2}· installed \d{4}-\d\d-\d\d by the server \(look command\)$/,
      ),
    ]);
    expect(await lookCommand(h.db, ['remove', 'tideline'], dir, say)).toBe(0);
    expect(lines.pop()).toBe('Removed tideline.');
    expect(await lookCommand(h.db, ['remove', 'tideline'], dir, say)).toBe(1);
    expect(lines.pop()).toBe('There is no look pack with that id.');
    expect(await lookCommand(h.db, ['add', 'missing.zip'], dir, say)).toBe(66);
    expect(await lookCommand(h.db, ['frobnicate'], dir, say)).toBe(64);
  });
});

describe('who may', () => {
  it('a moderator may not list, check, install or remove', async () => {
    const email = address('looks-moderator');
    await seat(h.db, email, 'moderator');
    const mod = as(h, await signIn(h, email));
    const z = base64(fixturePack('good'));
    for (const req of [
      { method: 'GET' as const, url: '/api/admin/looks' },
      { method: 'POST' as const, url: '/api/admin/looks/check', payload: { zip: z } },
      { method: 'POST' as const, url: '/api/admin/looks', payload: { zip: z } },
      { method: 'DELETE' as const, url: '/api/admin/looks/tideline' },
    ]) {
      const res = await mod(req);
      expect(res.statusCode, req.url).toBe(403);
      expect(res.body).not.toContain('step_up_required');
    }
    expect(await packCount()).toBe(0);
  });

  it('nobody signed in may either', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/admin/looks' });
    expect(res.statusCode).toBe(401);
  });

  it('the owner may', async () => {
    const email = address('looks-owner');
    await seat(h.db, email, 'owner');
    const owner = as(h, await signIn(h, email));
    expect((await owner({ method: 'GET', url: '/api/admin/looks' })).statusCode).toBe(200);
  });

  it('checking asks for no step-up; installing does', async () => {
    const email = address('looks-stale');
    await seat(h.db, email, 'admin');
    const session = await signIn(h, email);
    await h.db
      .updateTable('sessions')
      .set({ step_up_at: new Date(Date.now() - STEP_UP_MS - 1000) })
      .where('token_hash', '=', sha256Hex(session))
      .execute();
    const stale = as(h, session);
    const z = base64(fixturePack('good'));
    const checked = await stale({
      method: 'POST',
      url: '/api/admin/looks/check',
      payload: { zip: z },
    });
    expect(checked.statusCode).toBe(200);
    const installed = await stale({ method: 'POST', url: '/api/admin/looks', payload: { zip: z } });
    expect(installed.json()).toMatchObject({ error: { code: 'step_up_required' } });
    expect(await packCount()).toBe(0);
  });
});
