/**
 * The pure half of lists: the rules, the separation, the migration and the
 * templates. Ported from the lists groups of legacy/scripts/selftest.js.
 * Nothing here needs a database; the rows round-tripping through Postgres are
 * test/db/lists.test.ts.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.ts';
import {
  AGGREGATABLE_KINDS,
  assertCollectable,
  assertFieldDefinition,
  collectionRequirements,
  defaultRetention,
  isPersonalKind,
} from '../../src/lists/fields.ts';
import type { ListField } from '../../src/lists/fields.ts';
import { ERASABLE_COLUMNS, prepareAnswers } from '../../src/lists/policy.ts';
import {
  CLASSES,
  DEFAULT_PERSONAL_DAYS,
  NEVER,
  erasureExpiry,
  personalExpiresAt,
  personalRetentionDays,
} from '../../src/lists/retention.ts';
import { clustersIn } from '../../src/lists/review.ts';
import { listSettingsFrom } from '../../src/lists/settings.ts';
import { parseListTemplate, shippedTemplates } from '../../src/lists/templates.ts';
import { REJECTIONS, SHORTENERS, normalizeUrl } from '../../src/lists/urls.ts';
import { normalizeValue } from '../../src/lists/values.ts';

const API = fileURLToPath(new URL('../../', import.meta.url));
const ROOT = resolve(API, '../..');
const LISTS = join(API, 'src/lists');

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const listSource = (f: string) => stripComments(readFileSync(join(LISTS, f), 'utf8'));
const stripSql = (sql: string) => sql.replace(/--.*$/gm, '');

const MIGRATION_FILE = readdirSync(join(API, 'migrations')).find((f) => f.endsWith('_lists.sql'));
const MIGRATION = stripSql(readFileSync(join(API, 'migrations', MIGRATION_FILE ?? ''), 'utf8'));

// ── the separation rule ─────────────────────────────────────────────────

/**
 * Every file reachable from apps/api/src/lists/, following imports
 * TRANSITIVELY, workspace packages included. A per-file grep for the sealing
 * code is the obvious test and the wrong one: it passes while the reach exists
 * one hop away. The boundary check (dependency-cruiser) says the same thing;
 * this is the same promise kept by the unit suite as well, as legacy kept it.
 */
function listsGraph(): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = readdirSync(LISTS)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(LISTS, f));
  while (queue.length) {
    const file = queue.shift() ?? '';
    if (seen.has(file) || !existsSync(file) || !statSync(file).isFile()) continue;
    const src = readFileSync(file, 'utf8');
    seen.set(file, src);
    const specs = [
      ...[...src.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
      ...[...src.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
    ];
    for (const s of specs) {
      if (!s) continue;
      if (s.startsWith('.')) queue.push(resolve(dirname(file), s));
      const pkg = /^@reportlog\/([a-z-]+)$/.exec(s)?.[1];
      if (pkg) queue.push(join(ROOT, 'packages', pkg, 'src/index.ts'));
    }
  }
  return seen;
}

describe('the separation rule: an entry is not a report', () => {
  const graph = listsGraph();
  const files = [...graph.keys()].map((f) => f.slice(ROOT.length + 1));

  it('the walker actually follows edges, so the checks below cannot pass vacuously', () => {
    expect(files).toContain('apps/api/src/lists/routes.ts');
    expect(files).toContain('apps/api/src/http/route.ts');
    expect(files).toContain('apps/api/src/identity/siteAccess.ts');
    expect(files).toContain('packages/fields/src/normalize.ts');
    expect(files.filter((f) => f.startsWith('apps/api/src/lists/')).length).toBeGreaterThanOrEqual(
      15,
    );
  });

  it('nothing a list can reach seals, chains or verifies a report', () => {
    const reach = files.filter(
      (f) => f.startsWith('packages/seal/') || f.startsWith('apps/api/src/chain/'),
    );
    expect(reach).toEqual([]);
  });

  it('and nothing in it names a chain', () => {
    for (const f of readdirSync(LISTS).filter((x) => x.endsWith('.ts'))) {
      const src = listSource(f);
      for (const banned of [
        'chainHash',
        'chainGenesis',
        'appendReportVersion',
        'sealedReportRows',
        'report_heads',
        "insertInto('reports')",
        'logbook_form',
      ]) {
        expect(src.includes(banned), `${f} names ${banned}`).toBe(false);
      }
    }
  });

  it('the rule modules reach no database, so this suite can test them', () => {
    for (const f of [
      'urls.ts',
      'retention.ts',
      'fields.ts',
      'policy.ts',
      'values.ts',
      'templates.ts',
    ]) {
      expect(listSource(f), f).not.toMatch(/from '\.\.\/db\/database\.ts'|from 'pg'/);
    }
  });

  it('answers are normalized by @reportlog/fields, the package kept apart from sealing', () => {
    expect(listSource('values.ts')).toMatch(/from '@reportlog\/fields'/);
  });
});

describe('the routes: who may do what is stated once per scope', () => {
  const src = listSource('routes.ts');
  const visitor = src.slice(
    src.indexOf('const filing = limiter'),
    src.indexOf('const adminDetail'),
  );

  it('building is an administrator’s job, reviewing a moderator’s', () => {
    expect(src).toMatch(/staff\.addHook\('preHandler', roleGuard\(\['admin'\]\)\)/);
    expect(src).toMatch(/mods\.addHook\('preHandler', roleGuard\(\['moderator', 'admin'\]\)\)/);
  });

  it('nothing a visitor can call approves, edits or reads an entry', () => {
    expect(visitor.length).toBeGreaterThan(200);
    expect(visitor).not.toMatch(
      /reviewEntries|setTriageState|updateSettings|replaceFields|reviewBatch|erasable_answers/,
    );
  });

  it('a list nobody may see is 404, never 403', () => {
    expect(visitor).not.toMatch(/403|notAllowed/);
    expect((visitor.match(/maySee\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('published counts need listed AND published', () => {
    const counts = src.slice(
      src.search(/route\(\s*app,\s*getListCounts,/),
      src.search(/route\(\s*app,\s*sendListEntry,/),
    );
    expect(counts).toMatch(/list\??\.visibility !== 'listed'/);
    expect(counts).toMatch(/!list\.aggregates_published/);
    expect(counts).not.toMatch(/erasable/);
  });

  it('OPENING AN ERASURE LINK ERASES NOTHING: only the button does', () => {
    const get = src.slice(
      src.indexOf("pages.get('/api/forget/:token'"),
      src.indexOf("pages.post('/api/forget/:token'"),
    );
    expect(get.length).toBeGreaterThan(50);
    expect(get).not.toMatch(/redeem|erasePersonal|updateTable/);
    expect(listSource('pages.ts')).toMatch(/<form method="post" action="\/api\/forget\//);
  });

  it('and opening the mail confirmation link agrees to nothing', () => {
    const get = src.slice(
      src.indexOf("pages.get('/api/list-mail/:token'"),
      src.indexOf("pages.post('/api/list-mail/:token'"),
    );
    expect(get.length).toBeGreaterThan(50);
    expect(get).not.toMatch(/confirmRecipient|updateTable/);
  });

  it('the emailed links point where the pages are', () => {
    expect(src).toMatch(/\$\{siteOrigin\}\/api\/forget\/\$\{got\.erasureToken\}/);
    expect(src).toMatch(/\$\{siteOrigin\}\/api\/list-mail\/\$\{named\.token\}/);
  });
});

// ── the migration ───────────────────────────────────────────────────────

describe('the migration', () => {
  it('creates the list tables and touches nothing that exists', () => {
    expect(MIGRATION_FILE).toMatch(/^\d{14}_lists\.sql$/);
    expect(MIGRATION).not.toMatch(/ALTER TABLE|DROP /i);
    expect(MIGRATION).not.toMatch(/\breports\b/);
    for (const t of [
      'lists',
      'list_fields',
      'list_entries',
      'list_entry_links',
      'link_index',
      'list_salts',
      'list_erasures',
      'list_notify_confirmations',
    ]) {
      expect(MIGRATION).toMatch(new RegExp(`CREATE TABLE ${t} \\(`));
    }
  });

  it('NO LIST ROW CARRIES expires_at: the other sweep deletes whole rows keyed on that name', () => {
    // The two credential tables (an erasure link, a mail confirmation) are
    // what that name means. Everything else is a list's own row.
    const rows = MIGRATION.replace(/CREATE TABLE list_erasures[\s\S]*?\n\);/, '').replace(
      /CREATE TABLE list_notify_confirmations[\s\S]*?\n\);/,
      '',
    );
    expect(rows).not.toMatch(/^\s*expires_at\s/m);
    expect(MIGRATION).toMatch(/personal_expires_at\s+timestamptz/);
  });

  it('the SQL CHECK and AGGREGATABLE_KINDS state the same list', () => {
    const m = /list_fields_aggregatable_check CHECK \(([\s\S]*?)\n {2}\),/.exec(MIGRATION);
    expect(m, 'the CHECK is not where this test looks for it').toBeTruthy();
    const inSql = [...(m?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(inSql).toEqual([...AGGREGATABLE_KINDS].sort());
  });

  it('nothing records which template made a list', () => {
    expect(MIGRATION).not.toMatch(/from_template|template_slug|template_id/);
    const lists = MIGRATION.slice(MIGRATION.indexOf('CREATE TABLE lists ('));
    expect(lists.slice(0, lists.indexOf('\n);'))).not.toMatch(/^\s*kind\s+text/m);
    for (const f of ['entries.ts', 'aggregates.ts', 'review.ts', 'sweep.ts', 'routes.ts']) {
      expect(listSource(f), `${f} branches on which list it is`).not.toMatch(
        /'tips'|'check-ins'|'contact'/,
      );
    }
  });

  it('no other code deletes rows from a list table: there are two sweeps, and only one is ours', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (p !== LISTS) walk(p);
        } else if (p.endsWith('.ts') && !p.endsWith('.gen.ts')) {
          const src = stripComments(readFileSync(p, 'utf8'));
          if (
            /deleteFrom\('(lists|list_entries|list_entry_links|link_index|list_fields)'\)|DELETE FROM (lists|list_entries|list_entry_links|link_index)\b/.test(
              src,
            )
          ) {
            offenders.push(p.slice(ROOT.length + 1));
          }
        }
      }
    };
    walk(join(API, 'src'));
    expect(offenders).toEqual([]);
  });
});

// ── the two halves of an entry ─────────────────────────────────────────

const FORM: ListField[] = [
  { key: 'links', kind: 'url', label: 'Link', max_values: 3, retention: 'durable', required: true },
  {
    key: 'state',
    kind: 'choice_one',
    label: 'Where',
    retention: 'durable',
    aggregatable: true,
    settings: { options: ['Ohio', 'Iowa'] },
  },
  { key: 'description', kind: 'long_text', label: 'Anything else', retention: 'transient' },
];

describe('the two halves of an entry, which is the structural heart', () => {
  it('a count cannot reach anything erasable, because it is a different column', () => {
    const src = listSource('aggregates.ts');
    expect(src).not.toMatch(/erasable_answers/);
    expect(src).toMatch(/answers/);
  });

  it('durable answers and erasable answers are split on the way in', () => {
    const out = prepareAnswers(FORM, {
      links: 'https://ex.org/a?utm_source=x',
      state: 'Ohio',
      description: 'something somebody typed',
    });
    if (!out.ok) throw new Error(out.reason);
    expect(Object.keys(out.answers).sort()).toEqual(['links', 'state']);
    expect(Object.keys(out.erasable ?? {})).toEqual(['description']);
    expect(out.answers.links).toEqual(['https://ex.org/a']);
    expect(out.links).toHaveLength(1);
    expect(out.links[0]?.host).toBe('ex.org');
  });

  it('nothing erasable means NULL, not an empty object', () => {
    const out = prepareAnswers(FORM, { links: 'https://ex.org/a', state: 'Iowa' });
    expect(out.ok && out.erasable).toBe(null);
  });

  it('a key is absent when it was not answered, never null', () => {
    const out = prepareAnswers(FORM, { links: 'https://ex.org/a', state: 'Ohio' });
    if (!out.ok) throw new Error(out.reason);
    expect('description' in out.answers).toBe(false);
    expect(Object.values(out.answers)).not.toContain(null);
  });

  it('a required question left blank names itself', () => {
    const out = prepareAnswers(FORM, { state: 'Ohio' });
    expect(out).toMatchObject({ ok: false, reason: 'missing-required', keys: ['links'] });
  });

  it('one person pasting the same link twice is one link', () => {
    const out = prepareAnswers(FORM, {
      links: ['https://ex.org/a?utm_source=x', 'https://EX.org/a#top'],
      state: 'Ohio',
    });
    if (!out.ok) throw new Error(out.reason);
    expect(out.answers.links).toHaveLength(1);
    expect(out.links).toHaveLength(1);
  });

  it('more answers than the question takes is refused, not cut', () => {
    const out = prepareAnswers(FORM, {
      links: ['https://a.com/1', 'https://b.com/2', 'https://c.com/3', 'https://d.com/4'],
      state: 'Ohio',
    });
    expect(out).toMatchObject({ ok: false, reason: 'too-many-values', key: 'links' });
  });

  it('an answer outside a closed set of options is refused', () => {
    expect(prepareAnswers(FORM, { links: 'https://ex.org/a', state: 'Nowhere' })).toMatchObject({
      ok: false,
      reason: 'not-an-option',
    });
  });

  it('a question classed absent is not collected even when an answer arrives', () => {
    const form = [
      ...FORM,
      { key: 'extra', kind: 'short_text', label: 'Extra', retention: 'absent' as const },
    ];
    const out = prepareAnswers(form, { links: 'https://ex.org/a', state: 'Ohio', extra: 'typed' });
    if (!out.ok) throw new Error(out.reason);
    expect('extra' in out.answers).toBe(false);
    expect(out.erasable).toBe(null);
  });

  it('a question the form does not ask is dropped, not refused', () => {
    const out = prepareAnswers(FORM, { links: 'https://ex.org/a', stray: 'x' });
    expect(out.ok && 'stray' in out.answers).toBe(false);
  });

  it('the erasure names the columns it blanks, and the link index is not one', () => {
    expect([...ERASABLE_COLUMNS]).toEqual(['erasable_answers', 'email', 'ip_hash']);
  });

  it('the submission gate reads what arrived, never the form’s flag', () => {
    // Requiring an address of the FORM is not requiring one of every
    // submission: somebody sending only a link must not be asked for one.
    const src = listSource('entries.ts');
    expect(src).toMatch(/prepared\.erasable && !email/);
    expect(src).not.toMatch(/requiresEmail && !email/);
  });
});

// ── the countable flag ──────────────────────────────────────────────────

describe('the countable flag', () => {
  it('free text can never be counted, whoever ticks the box', () => {
    for (const kind of ['long_text', 'short_text']) {
      expect(() =>
        assertFieldDefinition({ key: 'x', kind, label: 'X', aggregatable: true }),
      ).toThrow(/only a closed vocabulary/);
    }
  });

  it('a choice with an escape hatch cannot be counted either', () => {
    expect(() =>
      assertFieldDefinition({
        key: 'where',
        kind: 'place',
        label: 'Where',
        aggregatable: true,
        retention: 'durable',
        settings: { options: ['Ohio'], allowOther: true },
      }),
    ).toThrow(/escape hatch/);
    expect(() =>
      assertFieldDefinition({
        key: 'where',
        kind: 'place',
        label: 'Where',
        aggregatable: true,
        retention: 'durable',
        settings: { options: ['Ohio'] },
      }),
    ).not.toThrow();
  });

  it('a question that is not collected cannot be counted', () => {
    expect(() =>
      assertFieldDefinition({
        key: 'state',
        kind: 'choice_one',
        label: 'Where',
        aggregatable: true,
        retention: 'absent',
        settings: { options: ['Ohio'] },
      }),
    ).toThrow(/not collected/);
  });

  it('a counted question the sweep erases is refused, because its count would shrink', () => {
    expect(() =>
      assertFieldDefinition({
        key: 'where',
        kind: 'place',
        label: 'Where',
        aggregatable: true,
        retention: 'transient',
        settings: { options: ['Ohio'] },
      }),
    ).toThrow(/shrink on its own/);
  });

  it('every question needs a label, because a count is named by it', () => {
    expect(() => assertFieldDefinition({ key: 'state', kind: 'choice_one', label: ' ' })).toThrow(
      /no label/,
    );
  });

  it('uploads and evidence are not available on a list at all', () => {
    expect(() => assertFieldDefinition({ key: 'photo', kind: 'file', label: 'Photo' })).toThrow(
      /belong to a logbook/,
    );
    expect(() =>
      assertCollectable([{ key: 'e', kind: 'evidence_declaration', label: 'E' }], {
        hasRequiredEmail: true,
      }),
    ).toThrow(/belong to a logbook/);
  });

  it('two questions cannot share a key', () => {
    expect(() =>
      assertCollectable([
        { key: 'state', kind: 'choice_one', label: 'A', settings: { options: ['x'] } },
        { key: 'state', kind: 'choice_one', label: 'B', settings: { options: ['y'] } },
      ]),
    ).toThrow(/share the key/);
  });
});

// ── the gate ─────────────────────────────────────────────────────────────

const LINK_ONLY: ListField[] = [
  { key: 'links', kind: 'url', label: 'Link' },
  { key: 'state', kind: 'choice_one', label: 'Where', settings: { options: ['Ohio'] } },
];

describe('the gate, derived from the questions and never ticked', () => {
  it('a link and a dropdown asks for no address', () => {
    const r = collectionRequirements(LINK_ONLY);
    expect(r.collectsPersonal).toBe(false);
    expect(r.requiresEmail).toBe(false);
    expect(() => assertCollectable(LINK_ONLY)).not.toThrow();
  });

  it('one free-text box makes the address required', () => {
    const withText = [...LINK_ONLY, { key: 'description', kind: 'long_text', label: 'More' }];
    const r = collectionRequirements(withText);
    expect(r.personalKeys).toEqual(['description']);
    expect(r.requiresEmail && r.requiresErasureRoute).toBe(true);
    expect(() => assertCollectable(withText)).toThrow(/must ask for an email address/);
  });

  it('requiring an address of the FORM is not requiring one of every submission', () => {
    const form = [...LINK_ONLY, { key: 'description', kind: 'long_text', label: 'More' }];
    expect(collectionRequirements(form).requiresEmail).toBe(true);
    const withText = prepareAnswers(form, { links: 'https://ex.org/a', description: 'words' });
    expect(withText.ok && withText.erasable).not.toBe(null);
    const without = prepareAnswers(form, { links: 'https://ex.org/a' });
    expect(without.ok && without.erasable).toBe(null);
  });

  it('an unknown kind counts as personal: the failure is an unnecessary email, not an unerasable record', () => {
    expect(isPersonalKind('voice_note_2027')).toBe(true);
    expect(
      collectionRequirements([{ key: 'x', kind: 'voice_note_2027', label: 'X' }]).requiresEmail,
    ).toBe(true);
  });

  it('a location is not personal, a place is', () => {
    expect(isPersonalKind('location')).toBe(false);
    expect(isPersonalKind('place')).toBe(true);
  });

  it('retention defaults by whether the question is personal', () => {
    expect(defaultRetention('long_text')).toBe(CLASSES.TRANSIENT);
    expect(defaultRetention('choice_one')).toBe(CLASSES.DURABLE);
    expect(defaultRetention('yes_no')).toBe(CLASSES.DURABLE);
  });
});

// ── retention ─────────────────────────────────────────────────────────────

describe('retention belongs to a field', () => {
  it('the period is read from configuration, never written as a literal', () => {
    expect(personalRetentionDays(undefined)).toBe(DEFAULT_PERSONAL_DAYS);
    expect(personalRetentionDays('30')).toBe(30);
    expect(personalRetentionDays('never')).toBe(NEVER);
  });

  it('a typo in the setting cannot turn retention off', () => {
    for (const bad of ['', '  ', '0', '-5', 'ninety', '90 days', '1.5']) {
      expect(personalRetentionDays(bad), JSON.stringify(bad)).toBe(DEFAULT_PERSONAL_DAYS);
    }
  });

  it('and the server refuses to start on one, rather than guess', () => {
    const base = { DATABASE_URL: 'postgres://x' };
    expect(() => loadConfig({ ...base, LIST_PERSONAL_DAYS: 'ninety' })).toThrow(
      /LIST_PERSONAL_DAYS/,
    );
    expect(() => loadConfig({ ...base, LIST_PERSONAL_DAYS: '0' })).toThrow(/LIST_PERSONAL_DAYS/);
    const s = listSettingsFrom(loadConfig({ ...base, LIST_PERSONAL_DAYS: 'Never' }));
    expect(s.personalDays).toBe(NEVER);
    const d = listSettingsFrom(
      loadConfig({ ...base, LIST_KNOWN_HOSTS: ' News.Example.org , ,x.org', ADMIN_EMAIL: '' }),
    );
    expect(d.personalDays).toBe(DEFAULT_PERSONAL_DAYS);
    expect(d.knownHosts).toEqual(['news.example.org', 'x.org']);
    expect(d.adminEmail).toBe(null);
  });

  it('the expiry is computed forward from the moment of writing', () => {
    expect(personalExpiresAt(new Date('2026-10-10T12:00:00Z'), 90)?.toISOString()).toBe(
      '2027-01-08T12:00:00.000Z',
    );
  });

  it('kept means NULL, which is what the column means', () => {
    expect(personalExpiresAt(new Date(), NEVER)).toBe(null);
  });

  it('the erasure link lives as long as the data it can erase', () => {
    const expiry = new Date('2027-01-08T12:00:00Z');
    expect(erasureExpiry(expiry, new Date()).toISOString()).toBe(expiry.toISOString());
    expect(erasureExpiry(null, new Date('2026-10-10T00:00:00Z'), 10).toISOString()).toBe(
      '2026-10-20T00:00:00.000Z',
    );
  });
});

// ── links ────────────────────────────────────────────────────────────────

describe('normalizing a link', () => {
  const ok = (u: string) => {
    const n = normalizeUrl(u);
    if (!n.ok) throw new Error(`${u}: ${n.reason}`);
    return n;
  };
  const why = (u: string) => {
    const n = normalizeUrl(u);
    return n.ok ? null : n.reason;
  };

  it('host case, a trailing dot, and an internationalized name', () => {
    expect(ok('https://EXAMPLE.com/a').url).toBe('https://example.com/a');
    expect(ok('https://example.com./a').url).toBe('https://example.com/a');
    expect(ok('https://münchen.de/x').host).toBe('xn--mnchen-3ya.de');
  });

  it('tracking parameters go and the content ones stay', () => {
    expect(ok('https://ex.com/w?utm_source=t&fbclid=9&v=abc').url).toBe('https://ex.com/w?v=abc');
    expect(ok('https://www.youtube.com/watch?v=xyz&si=zz').url).toMatch(/v=xyz/);
    expect(ok('https://www.youtube.com/watch?v=xyz&t=42').url).toMatch(/t=42/);
  });

  it('remaining parameters are sorted, so two apps produce one key', () => {
    expect(ok('https://ex.com/p?b=2&a=1').urlKey).toBe(ok('https://ex.com/p?a=1&b=2').urlKey);
  });

  it('a fragment goes unless it carries a post identifier', () => {
    expect(ok('https://ex.com/p#top').url).toBe('https://ex.com/p');
    expect(ok('https://ex.com/p#:~:text=hello').url).toBe('https://ex.com/p');
    expect(ok('https://ex.com/p#comment-4821').url).toBe('https://ex.com/p#comment-4821');
  });

  it('what is rejected, and only what cannot be a link to public material', () => {
    expect(why('ftp://ex.com/f')).toBe(REJECTIONS.SCHEME);
    expect(why('javascript:alert(1)')).toBe(REJECTIONS.SCHEME);
    expect(why('https://user:pw@ex.com/')).toBe(REJECTIONS.CREDENTIALS);
    expect(why('https://bit.ly/abc')).toBe(REJECTIONS.SHORTENER);
    expect(why('not a url')).toBe(REJECTIONS.UNPARSEABLE);
  });

  it('a bare address is refused in all four spellings it has', () => {
    for (const u of [
      'http://192.168.1.1/x',
      'http://2130706433/x',
      'http://0x7f000001/x',
      'http://[::1]/x',
    ]) {
      expect(why(u), u).toBe(REJECTIONS.BARE_ADDRESS);
    }
  });

  it('youtu.be is NOT a shortener and must never become one', () => {
    expect(SHORTENERS.has('youtu.be')).toBe(false);
    expect(ok('https://youtu.be/dQw4w9WgXcQ?si=track').url).toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  it('url_key is sha256 of the normalized form, not of what was typed', () => {
    expect(ok('https://EX.com/p?utm_source=x').urlKey).toBe(
      createHash('sha256').update('https://ex.com/p').digest('hex'),
    );
  });

  it('the server never fetches a submitted link', () => {
    const src = listSource('urls.ts');
    for (const io of [
      'fetch(',
      'http.get',
      'https.get',
      'request(',
      "from 'node:dns'",
      "from 'node:net'",
    ]) {
      expect(src.includes(io), io).toBe(false);
    }
  });
});

// ── one answer at a time ───────────────────────────────────────────────

describe('one answer at a time', () => {
  it('a yes or no takes the spellings a form actually sends', () => {
    const f = { key: 'q', kind: 'yes_no', label: 'Q' };
    for (const yes of [true, 'true', 'yes', 'on', '1']) {
      expect(normalizeValue(f, yes), String(yes)).toEqual({ ok: true, value: true });
    }
    for (const no of [false, 'false', 'no', 'off', '0']) {
      expect(normalizeValue(f, no), String(no)).toEqual({ ok: true, value: false });
    }
    expect(normalizeValue(f, 'maybe').ok).toBe(false);
  });

  it('several boxes ticked are stored in the operator’s order, so one answer has one shape', () => {
    const f = { key: 'q', kind: 'choice_many', label: 'Q', settings: { options: ['b', 'a', 'c'] } };
    expect(normalizeValue(f, ['c', 'b'])).toEqual({ ok: true, value: ['b', 'c'] });
    expect(normalizeValue(f, ['b', 'c'])).toEqual({ ok: true, value: ['b', 'c'] });
    expect(normalizeValue(f, ['a', 'a'])).toEqual({ ok: true, value: ['a'] });
    expect(normalizeValue(f, ['a', 'z'])).toEqual({ ok: false, reason: 'not-an-option' });
  });

  it('a blank answer is undefined rather than an empty string', () => {
    const f = { key: 'q', kind: 'short_text', label: 'Q' };
    for (const blank of [null, undefined, '', '   ', []]) {
      expect(normalizeValue(f, blank)).toEqual({ ok: true, value: undefined });
    }
  });

  it('text is refused when too long rather than cut, and a file never gets this far', () => {
    expect(normalizeValue({ key: 'q', kind: 'long_text', label: 'Q' }, 'a'.repeat(1001))).toEqual({
      ok: false,
      reason: 'too-long',
    });
    expect(normalizeValue({ key: 'q', kind: 'file', label: 'Q' }, 'x').ok).toBe(false);
  });

  it('each kind names its refusal', () => {
    expect(normalizeValue({ key: 'q', kind: 'email', label: 'Q' }, 'nope')).toEqual({
      ok: false,
      reason: 'not-an-email',
    });
    expect(normalizeValue({ key: 'q', kind: 'date', label: 'Q' }, '2026-02-31')).toEqual({
      ok: false,
      reason: 'not-a-date',
    });
    expect(normalizeValue({ key: 'q', kind: 'number', label: 'Q' }, 'many')).toEqual({
      ok: false,
      reason: 'not-a-number',
    });
    expect(
      normalizeValue({ key: 'q', kind: 'number', label: 'Q', settings: { min: 0, max: 10 } }, '11'),
    ).toEqual({ ok: false, reason: 'out-of-range' });
    expect(normalizeValue({ key: 'q', kind: 'location', label: 'Q' }, 'XX-NOWHERE')).toEqual({
      ok: false,
      reason: 'not-a-place',
    });
    expect(normalizeValue({ key: 'q', kind: 'location', label: 'Q' }, 'US-AZ')).toEqual({
      ok: true,
      value: 'US-AZ',
    });
    expect(normalizeValue({ key: 'q', kind: 'choice_one', label: 'Q' }, 'x')).toEqual({
      ok: false,
      reason: 'field-has-no-options',
    });
  });
});

// ── the shipped templates ──────────────────────────────────────────────

describe('the shipped templates', () => {
  const by = Object.fromEntries(shippedTemplates().map((t) => [t.slug, t]));

  it('three ship, and all three parse', () => {
    expect(Object.keys(by).sort()).toEqual(['check-ins', 'contact', 'tips']);
  });

  it('the Tip List asks for an address, because it takes free text', () => {
    const t = by.tips;
    expect(t?.requiresEmail).toBe(true);
    expect(t?.fields.filter((f) => f.aggregatable).map((f) => f.key)).toEqual([
      'state',
      'category',
    ]);
    const links = t?.fields.find((f) => f.key === 'links');
    expect(links?.max_values).toBe(3);
    expect(links?.retention).toBe('durable');
  });

  it('check-ins ask for no address, and everything they keep IS the count', () => {
    const t = by['check-ins'];
    expect(t?.requiresEmail).toBe(false);
    expect(t?.fields.every((f) => f.aggregatable && f.retention === 'durable')).toBe(true);
  });

  it('a contact form ticks nothing countable, and always asks for an address', () => {
    const t = by.contact;
    expect(t?.fields.filter((f) => f.aggregatable)).toHaveLength(0);
    expect(t?.requiresEmail).toBe(true);
    expect(t?.email_mode).toBe('required');
  });

  it('a template that lies about needing an address fails to load', () => {
    expect(() =>
      parseListTemplate({
        reportlog_list: 1,
        slug: 'bad',
        title: 'Bad',
        email: 'none',
        fields: [{ key: 'msg', kind: 'long_text', label: 'Message' }],
      }),
    ).toThrow(/DO require an address/);
  });

  it('a template that asks nothing is refused', () => {
    expect(() =>
      parseListTemplate({ reportlog_list: 1, slug: 'empty', title: 'Empty', fields: [] }),
    ).toThrow(/asks nothing/);
  });
});

// ── what a reviewer sees at a glance ──────────────────────────────────

describe('what a reviewer can see at a glance', () => {
  it('a repeated submitter is counted without the hash leaving the function', () => {
    const entries = [1, 2, 3, 4].map((id) => ({ id, created_at: '2026-11-03T09:02:00Z' }));
    const rows = [{ ip_hash: 'aaa' }, { ip_hash: 'aaa' }, { ip_hash: 'aaa' }, { ip_hash: 'bbb' }];
    const c = clustersIn(entries, rows);
    expect(c.repeated_submitters).toBe(1);
    expect(c.largest_repeated_submitter).toBe(3);
    expect(c.entries_from_repeated_submitters).toEqual([1, 2, 3]);
    expect(JSON.stringify(c)).not.toContain('aaa');
  });

  it('a burst is visible with no addresses at all, so a flood’s shape survives the sweep', () => {
    const entries = [1, 2, 3].map((id) => ({ id, created_at: '2026-11-03T09:02:00Z' }));
    const c = clustersIn(entries, [{}, {}, {}]);
    expect(c.repeated_submitters).toBe(0);
    expect(c.busiest_minutes[0]).toEqual({ minute: '2026-11-03T09:02', count: 3 });
  });

  it('an entry cannot be un-reviewed', () => {
    expect(listSource('review.ts')).toMatch(/refuse\('un-review'\)/);
  });
});
