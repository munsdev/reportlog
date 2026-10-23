/**
 * The parts of the documentation that are read out of the code rather than
 * written by hand: every setting, every command, every question kind, every
 * scheduled job, the roles table and the shipped starting points.
 *
 * A hand-written list of these goes stale the first time somebody adds one
 * and forgets the docs. Read from the source, the docs change in the same
 * commit as the thing they describe.
 *
 * Imported by relative path, not as `@reportlog/fields`: the site is built
 * with no `pnpm install` (build.ts says why), so workspace links do not
 * exist there. Each module imported here imports only types, or nothing.
 * The job registry is read as text instead: importing it would bring the
 * whole API's types into the site's type check.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MAY_GRANT, SYSTEM_ROLES } from '../../../packages/access/src/index.ts';
import { CONDITIONABLE_KINDS } from '../../../packages/fields/src/conditions.ts';
import { CONTACT_KINDS, TYPED_KINDS } from '../../../packages/fields/src/email.ts';
import { FIELD_TYPES, FILTERABLE_TYPES } from '../../../packages/fields/src/fieldTypes.ts';
import { escapeHtml, inline } from './markdown.ts';

const code = (s: string) => `<code>${escapeHtml(s)}</code>`;

function table(head: string[], rows: string[][]): string {
  const th = head.map((h) => `<th>${h}</th>`).join('');
  const tr = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<div class="table"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

/** `.env.example`, grouped by its own `# --- section ---` lines, each key with the comment above it. */
export function settings(root: string): string {
  const lines = readFileSync(join(root, '.env.example'), 'utf8').split('\n');
  const groups: { title: string; rows: { keys: string[]; value: string; note: string[] }[] }[] = [];
  let comment: string[] = [];
  let started = false;
  for (const line of lines) {
    const section = /^# -{3} (.*?) -+$/.exec(line);
    if (section) {
      started = true;
      // "error tracking (apps/api/src/telemetry/, deploy/README.md)": the
      // pointer is for whoever edits the file, not for the reader.
      groups.push({ title: (section[1] ?? '').replace(/\s*\(.*\)$/, ''), rows: [] });
      comment = [];
      continue;
    }
    if (!started) continue;
    const setting = /^(?:# )?([A-Z][A-Z0-9_]+)=(.*)$/.exec(line);
    const group = groups[groups.length - 1];
    if (setting && group) {
      const last = group.rows[group.rows.length - 1];
      // Keys with no comment of their own share the one above (HOST, PORT).
      if (comment.length === 0 && last) last.keys.push(setting[1] ?? '');
      else group.rows.push({ keys: [setting[1] ?? ''], value: setting[2] ?? '', note: comment });
      comment = [];
    } else if (line.startsWith('#')) {
      comment.push(line.replace(/^# ?/, ''));
    } else if (line.trim() === '') {
      comment = [];
    }
  }
  return groups
    .filter((g) => g.rows.length > 0)
    .map(
      (g) =>
        `<h2 id="${g.title
          .replace(/[^a-z0-9]+/gi, '-')
          .replace(/^-|-$/g, '')
          .toLowerCase()}">${escapeHtml(g.title.charAt(0).toUpperCase() + g.title.slice(1))}</h2>` +
        table(
          ['Setting', 'Meaning'],
          g.rows.map((r) => [
            r.keys.map(code).join('<br>') +
              (r.value && !/^(postgres|https?):/.test(r.value)
                ? `<br><span class="muted">example: ${code(r.value)}</span>`
                : ''),
            inline(r.note.join(' ')),
          ]),
        ),
    )
    .join('\n');
}

/** The commands `deploy/bin/reportlog` lists in its own header. */
export function commands(root: string): string {
  const rows: string[][] = [];
  for (const line of readFileSync(join(root, 'deploy/bin/reportlog'), 'utf8').split('\n')) {
    const m = /^#\s+(reportlog \S+(?: \S+)*?)\s{2,}(.*)$/.exec(line);
    if (m) rows.push([code(`sudo ${m[1] ?? ''}`), escapeHtml(m[2] ?? '')]);
  }
  return table(['Command', 'What it does'], rows);
}

const KIND_ASKS_EMAIL = (id: string): string => {
  if (TYPED_KINDS.has(id) || CONTACT_KINDS.has(id)) return 'Yes';
  if (id === 'place') return 'Yes, unless the answers are a closed list';
  return 'No';
};

/** Every question kind a form can ask, from `packages/fields`. */
export function questionKinds(): string {
  return table(
    [
      'Kind',
      'What it asks',
      'Asks the reporter for an address',
      'Can be a board filter',
      'Can trigger a follow-up',
    ],
    FIELD_TYPES.map((t) => [
      `<strong>${escapeHtml(t.label)}</strong><br>${code(t.id)}`,
      escapeHtml(t.description),
      KIND_ASKS_EMAIL(t.id),
      FILTERABLE_TYPES.has(t.id) ? 'Yes' : 'No',
      CONDITIONABLE_KINDS.has(t.id) ? 'Yes' : 'No',
    ]),
  );
}

const ROLE_NAMES: Record<string, string> = {
  owner: 'Owner',
  admin: 'Administrator',
  access_manager: 'Access Manager',
  moderator: 'Moderator',
  journalist: 'Journalist',
  user: 'Signed-in person',
};

/** Who may appoint whom, from `MAY_GRANT` in `packages/access`. */
export function roles(): string {
  const order = ['owner', 'admin', 'access_manager', 'moderator', 'journalist', 'user'] as const;
  const known = new Set<string>(SYSTEM_ROLES);
  return table(
    ['Role', 'May appoint'],
    order
      .filter((r) => known.has(r))
      .map((r) => {
        const grants = MAY_GRANT[r].filter((g) => g !== 'user').map((g) => ROLE_NAMES[g] ?? g);
        return [
          `<strong>${ROLE_NAMES[r] ?? r}</strong>`,
          grants.length ? grants.join(', ') : 'Nobody',
        ];
      }),
  );
}

function when(onCalendar: string): string {
  if (onCalendar === '*-*-* *:*:00') return 'Every minute';
  if (onCalendar === '*-*-* *:00:00') return 'Every hour';
  const daily = /^\*-\*-\* (\d\d:\d\d):00$/.exec(onCalendar);
  if (daily) return `Daily, ${daily[1] ?? ''} UTC`;
  const weekly = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \*-\*-\* (\d\d:\d\d):00$/.exec(onCalendar);
  const days: Record<string, string> = {
    Mon: 'Mondays',
    Tue: 'Tuesdays',
    Wed: 'Wednesdays',
    Thu: 'Thursdays',
    Fri: 'Fridays',
    Sat: 'Saturdays',
    Sun: 'Sundays',
  };
  if (weekly) return `${days[weekly[1] ?? ''] ?? ''}, ${weekly[2] ?? ''} UTC`;
  return code(onCalendar);
}

/** Every scheduled job, read from the text of `apps/api/src/jobs/registry.ts`. */
export function jobList(root: string): { name: string; what: string; onCalendar: string }[] {
  const source = readFileSync(join(root, 'apps/api/src/jobs/registry.ts'), 'utf8');
  return [
    ...source.matchAll(
      /name: '([^']+)',\s*what:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"),[\s\S]*?onCalendar: '([^']+)'/g,
    ),
  ].map((m) => ({
    name: m[1] ?? '',
    what: (m[2] ?? m[3] ?? '').replace(/\\(.)/g, '$1'),
    onCalendar: m[4] ?? '',
  }));
}

export function jobs(root: string): string {
  return table(
    ['Job', 'When', 'What it does'],
    jobList(root).map((j) => [code(j.name), when(j.onCalendar), escapeHtml(j.what)]),
  );
}

function titles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const data: unknown = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      return data && typeof data === 'object' && 'title' in data && typeof data.title === 'string'
        ? data.title
        : f;
    });
}

/** The logbooks and lists a site can start from, from their template files. */
export function startingPoints(root: string): string {
  const list = (items: string[]) =>
    `<ul>${items.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`;
  return (
    `<p>Logbooks:</p>${list(titles(join(root, 'apps/api/src/logbooks/templates')))}` +
    `<p>Lists:</p>${list(titles(join(root, 'apps/api/src/lists/templates')))}`
  );
}

/** How many palettes and themes ship, from the built-in look pack. */
export function lookCounts(root: string): { palettes: number; themes: number } {
  const pack: unknown = JSON.parse(
    readFileSync(join(root, 'packages/contracts/src/look/reportlog-core.look.json'), 'utf8'),
  );
  const count = (key: string) =>
    pack && typeof pack === 'object' && key in pack
      ? ((pack as Record<string, unknown[]>)[key]?.length ?? 0)
      : 0;
  return { palettes: count('palettes'), themes: count('themes') };
}
