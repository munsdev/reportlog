/**
 * Deployment templates: a named bundle of settings, applied once.
 *
 * A TEMPLATE IS NOT A MODE. Applying one writes the ordinary settings an
 * administrator could have set by hand, each through the module that owns
 * it, and then it is over. Nothing anywhere asks "which template is this" to
 * decide anything; `site_settings.template_applied` is a record and nothing
 * reads it to branch. The test of that: delete this file and its routes and
 * no deployment behaves differently. A `deployment_type` the code consults
 * was rejected in legacy for that reason, and still is.
 *
 * WHAT FOLLOWS FROM IT
 *
 * - A template sets only what is already a setting. `TEMPLATE_KEYS` is the
 *   whole permission surface, and a template naming anything else is refused
 *   whole rather than half applied. Legacy's `layout` (a retired axis) and
 *   `distribution` are not in it. The rebuild has the distribution switch
 *   (decision 11), but it decides whether an archive may be released to
 *   others, which no starting point should do for an operator.
 * - A key a template leaves out is LEFT ALONE, so a narrow template stays
 *   narrow. Clearing is said out loud instead (`clearCopy`, `siteName: ''`).
 * - It NEVER writes the imprint or the privacy policy. A template that did
 *   would publish a placeholder as somebody's legal notice. It never goes
 *   near anything sealed either: its logbook is a DRAFT, and launching is
 *   the operator's own one-way step.
 * - Every value goes through the validator that owns it (validateSiteName,
 *   validateLook, validateCopy, validateLogbookFile, the figure check), so a
 *   template cannot write a value an administrator could not. All of it is
 *   checked before a single row is written, and then written in ONE
 *   transaction: a template half applied is worse than none.
 * - No shipped template sets a name or a look. The wizard asks for the name
 *   before the starting point, so a template that set one would overwrite
 *   what was typed on the screen before; and a starting point answers what
 *   kind of archive this is, not what it looks like. The keys stay so the
 *   rule is checked rather than assumed (the database test asserts it).
 */
import type { TemplateCatalogue, TemplateSummary } from '@reportlog/contracts';
import * as C from '@reportlog/contracts';
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { checkText, figureValues } from '../board/figures.ts';
import { setPublicArchive } from '../board/publication.ts';
import { setSiteLimits } from '../files/limits.ts';
import { setIntakeSwitch } from '../filing/intakeSwitch.ts';
import { HttpError } from '../http/errors.ts';
import { route } from '../http/route.ts';
import { createFromFile, validateLogbookFile } from '../logbooks/logbookFile.ts';
import { isStartingPoint, startingPoints, templateLogbook } from '../logbooks/templates.ts';
import { createFromTemplate } from '../lists/manage.ts';
import { shippedTemplate } from '../lists/templates.ts';
import type { StartingPointId } from '../logbooks/templates.ts';
import { validateCopy } from './copy.ts';
import { validateSiteName } from './identity.ts';
import { validateLook } from './look.ts';
import type { Checked } from './result.ts';
import { writeCopy, writeSettings } from './settings.ts';

/** Every key a template may set. Anything else is refused, whole. */
export const TEMPLATE_KEYS = [
  'siteName',
  'palette',
  'theme',
  'publicArchive',
  'attachments',
  'intake',
  'copy',
  'clearCopy',
  'logbook',
  'list',
] as const;
type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** Named so the refusal can say the one thing that matters, not just "unknown key". */
const LEGAL_KEYS = ['impressum', 'privacy', 'impressum_text', 'privacy_text', 'legal'];

export interface TemplateSettings {
  /** '' means "back to the software's name"; absent leaves the name alone. */
  siteName?: string;
  palette?: string;
  theme?: string;
  publicArchive?: boolean;
  attachments?: boolean;
  intake?: boolean;
  copy?: Record<string, string>;
  /** Every slot back to the shipped wording, before `copy` is written. */
  clearCopy?: boolean;
  /** A logbook starting point (logbooks/templates/), made as a draft. */
  logbook?: string;
  /**
   * A list starting point (lists/templates/), made HIDDEN, as every new list
   * is: an administrator lists it. `slug` is its address when it should not
   * be the template's own; a taken address refuses the whole template.
   */
  list?: { template: string; slug?: string };
}

export interface Template {
  id: string;
  label: string;
  description: string;
  settings: TemplateSettings;
}

const HOME_HEADLINE = 'A record of what happened, that cannot be quietly changed.';

/** What ships. Legacy's catalogue, word for word where the words still hold. */
export const TEMPLATES: readonly Template[] = [
  {
    id: 'elections',
    label: 'Election incidents',
    description:
      'Observers and voters reporting what went wrong at a polling place: what happened, where, when, and an account in their own words. Takes files. Public archive on.',
    settings: {
      publicArchive: true,
      attachments: true,
      intake: true,
      logbook: 'elections',
      copy: {
        home_headline: HOME_HEADLINE,
        home_intro:
          'If you saw something go wrong at a polling place (a voter turned away, a line nobody could stand in, an observer shut out), file it here. A moderator reads every report before any of it is published.',
      },
    },
  },
  {
    // The same subject with nothing to type and nothing to upload. Not a
    // mode: a logbook file built that way, changeable like any other.
    id: 'elections-choices',
    label: 'Election incidents, no files or free text',
    description:
      "How it went, asked as a short set of choices: the reporter's role, the state, the day, the time, and what went wrong if anything did. Nothing to type and nothing to upload. Public archive on.",
    settings: {
      publicArchive: true,
      attachments: false,
      intake: true,
      logbook: 'elections-choices',
      copy: {
        home_headline: HOME_HEADLINE,
        home_intro:
          'Voted, worked a polling place or watched one? Say how it went, fine or not, in a minute, with nothing to type. A moderator reads every report before any of it is published.',
      },
    },
  },
  {
    // THE OWNER'S QUESTIONNAIRES OF 21 OCTOBER 2026 (docs/electionlog-
    // questionnaires.md), as ordinary settings: the one logbook, the tip list
    // at /list/tips (where "Send it as a tip" points), and the choosing card's
    // question. Nothing reads which template this was.
    id: 'electionlog',
    label: 'ElectionLog',
    description:
      'How voting went, for every voter in the US or abroad and every voting method, good and bad, asked as choices with nothing to type, plus a tip list that takes up to three links and nothing else. No files. Public archive on.',
    settings: {
      publicArchive: true,
      attachments: false,
      intake: true,
      logbook: 'electionlog',
      list: { template: 'electionlog-tips', slug: 'tips' },
      copy: {
        home_headline: HOME_HEADLINE,
        home_intro:
          'Voted, or tried to? Log how it went, good or bad, in a few choices with nothing to type. Saw a post, a video or an article about the election? Send it as a link. A moderator reads every report before any of it is published, and links are never published.',
        submit_question: 'What do you want to do?',
      },
    },
  },
  {
    id: 'workplace',
    label: 'Workplace or safety incidents',
    description:
      'Incidents inside one organisation: safety, conduct, near misses. Nothing published by default, and takes files.',
    settings: {
      publicArchive: false,
      attachments: true,
      intake: true,
      logbook: 'workplace',
      copy: {
        home_headline: 'A record of what happened here, that cannot be quietly changed.',
        home_lede:
          'File a report. A reviewer reads it. Once it is filed, nobody, including whoever runs this archive, can alter or remove it without that being visible.',
        home_intro:
          'This archive is for incidents inside this organisation. Nothing filed here is published outside it.',
        standards:
          'Who reviews a report, how quickly, and what happens next.\n\nWrite this before opening the form, not afterwards.',
      },
    },
  },
  {
    // Archive off and editorial notes on (the logbook file turns them on):
    // the editorial layer working with nothing publishing. It collects
    // observations, things that have not happened yet, which is why it is
    // not 'workplace': a near-miss log that asks "what happened" fills with
    // nothing.
    id: 'safety-log',
    label: 'An internal safety log',
    description:
      'Hazards and near misses inside one organisation: things noticed before they go wrong. Nothing published outside it, and reviewers can attach their own notes. Takes files.',
    settings: {
      publicArchive: false,
      attachments: true,
      intake: true,
      logbook: 'safety-log',
      copy: {
        home_headline: 'Say what you noticed, before it hurts somebody.',
        home_lede:
          'It does not have to have gone wrong yet. File it, somebody reads it, and once it is filed nobody, including whoever runs this archive, can quietly alter or remove it.',
        home_intro:
          'This log is for hazards and near misses here. Nothing filed in it is published outside this organisation.',
        standards:
          'Who reads a safety observation, how quickly, and what happens next.\n\nWrite this before opening the form. A hazard log that nobody has promised to read is a suggestion box.',
      },
    },
  },
  {
    // IDENTITY REQUIRED, and not as a setting: as a logbook asking required
    // questions, sealed with every other answer. "Anonymous filing off" as a
    // site switch would be a deployment type by another name.
    id: 'professional-complaint',
    label: 'A complaint about a practitioner',
    description:
      'Conduct or competence of somebody practising: clinical, legal, or any licensed trade. Asks who the complainant is and will not take an anonymous one. Nothing published until a moderator publishes it.',
    settings: {
      publicArchive: false,
      attachments: true,
      intake: true,
      logbook: 'professional-complaint',
      copy: {
        home_headline: 'A complaint that is on the record, and stays on it.',
        home_lede:
          'File it, a reviewer reads it, and once it is filed nobody, including whoever runs this archive, can alter or remove it without that being visible.',
        home_intro:
          'This archive takes complaints about the conduct and competence of people practising. It cannot take an anonymous one: a complaint about a named person that nobody will stand behind cannot be acted on.',
        standards:
          'Who reviews a complaint, what happens to the person complained about, and what the complainant is told.\n\nWrite this before opening the form. This is the archive where not having written it does the most harm, to both of them.',
      },
    },
  },
  {
    id: 'blank',
    label: 'Start from nothing',
    description:
      'Clears the page text and makes no logbook: you build your own. It leaves the name and the look alone.',
    settings: {
      // NO siteName. The wizard asks for the name before the starting point,
      // so clearing it here would wipe what was typed on the screen before
      // and hand somebody a deployment named after the software.
      clearCopy: true,
      intake: true,
      publicArchive: false,
      attachments: false,
    },
  },
];

export function templateById(id: string): Template | null {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

/** Everything checked and ready to write. Absent means "leave it alone". */
export interface TemplatePlan {
  siteName?: string | null;
  look?: { palette?: C.Look['palette']; theme?: C.Look['theme'] };
  publicArchive?: boolean;
  attachments?: boolean;
  intake?: boolean;
  clearCopy?: boolean;
  copy: { key: C.CopyKey; body: string | null }[];
  logbook?: StartingPointId;
  list?: { template: string; slug?: string };
}

/**
 * Check everything, write nothing. Pure, so what a template may contain is
 * testable without a database, and a refusal names every problem at once
 * rather than leaving a half-configured deployment behind.
 *
 * The figure check on page text needs the database and is made in
 * `applyTemplate`, inside the transaction, before anything is written.
 */
export function planTemplate(t: unknown): Checked<TemplatePlan> {
  if (!t || typeof t !== 'object' || !('settings' in t)) {
    return { ok: false, error: 'There is no such template.' };
  }
  const raw = t.settings;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'A template’s settings have to be a list of named values.' };
  }
  const keys = Object.keys(raw);
  // First, and on its own: the line that matters most. (Legacy checked for
  // unknown keys first, which these are too, so its own sentence never ran.)
  if (keys.some((k) => LEGAL_KEYS.includes(k))) {
    return { ok: false, error: 'A template may never write legal text.' };
  }
  const unknown = keys.filter((k) => !(TEMPLATE_KEYS as readonly string[]).includes(k));
  if (unknown.length) {
    return { ok: false, error: `A template cannot set: ${unknown.join(', ')}.` };
  }
  const s = raw as Partial<Record<TemplateKey, unknown>>;
  const problems: string[] = [];
  const plan: TemplatePlan = { copy: [] };

  if (s.siteName !== undefined) {
    if (typeof s.siteName !== 'string') problems.push('The name has to be text.');
    else {
      // '' is a real answer ("back to the software's name"), the same one the
      // name screen's empty box gives.
      const c = validateSiteName(s.siteName);
      if (c.ok) plan.siteName = c.value;
      else problems.push(`The name: ${c.error}`);
    }
  }
  if (s.palette !== undefined || s.theme !== undefined) {
    const c = validateLook({
      ...(s.palette !== undefined ? { palette: s.palette } : {}),
      ...(s.theme !== undefined ? { theme: s.theme } : {}),
    });
    if (c.ok) plan.look = c.value;
    else problems.push(`The look: ${c.error}`);
  }
  for (const key of ['publicArchive', 'attachments', 'intake', 'clearCopy'] as const) {
    const v = s[key];
    if (v === undefined) continue;
    if (typeof v === 'boolean') plan[key] = v;
    else problems.push(`${key} has to be true or false.`);
  }
  if (s.copy !== undefined) {
    if (!s.copy || typeof s.copy !== 'object' || Array.isArray(s.copy)) {
      problems.push('The page text has to be a list of named slots.');
    } else {
      for (const [key, body] of Object.entries(s.copy as Record<string, unknown>)) {
        if (typeof body !== 'string') {
          problems.push(`${key}: has to be text.`);
          continue;
        }
        const c = validateCopy(key, body);
        if (c.ok) plan.copy.push(c.value);
        else problems.push(`${key}: ${c.error}`);
      }
    }
  }
  if (s.logbook !== undefined) {
    if (typeof s.logbook !== 'string' || !isStartingPoint(s.logbook)) {
      problems.push(
        `There is no starting point called "${typeof s.logbook === 'string' ? s.logbook : '?'}".`,
      );
    } else {
      const errors = validateLogbookFile(templateLogbook(s.logbook));
      if (errors.length) problems.push(`The logbook: ${errors.join(' ')}`);
      else plan.logbook = s.logbook;
    }
  }
  if (s.list !== undefined) {
    const l = s.list as { template?: unknown; slug?: unknown } | null;
    const template = typeof l?.template === 'string' ? l.template : '';
    if (!l || typeof l !== 'object' || !shippedTemplate(template)) {
      problems.push(`There is no list starting point called "${template || '?'}".`);
    } else if (l.slug !== undefined && typeof l.slug !== 'string') {
      problems.push('A list’s address has to be text.');
    } else {
      plan.list = { template, ...(typeof l.slug === 'string' ? { slug: l.slug } : {}) };
    }
  }
  if (problems.length) return { ok: false, error: problems.join(' ') };
  return { ok: true, value: plan };
}

/**
 * One plain line per thing a template will change, so a person can see what
 * pressing it does before they press it.
 */
export function describeSettings(s: TemplateSettings): string[] {
  const out: string[] = [];
  if (s.siteName) out.push(`Names the site “${s.siteName}”`);
  // Distinguished from an absent key, which leaves the name alone.
  if (s.siteName === '') out.push('Clears the name, back to the software’s own');
  if (s.clearCopy) out.push('Clears every piece of page text, back to the shipped wording');
  if (s.palette) out.push(`Sets the colours to ${s.palette}`);
  if (s.theme) out.push(`Sets the type and shape to ${s.theme}`);
  if (s.publicArchive !== undefined) {
    out.push(
      s.publicArchive
        ? 'Publishes an archive of the reports a moderator approves'
        : 'Publishes nothing',
    );
  }
  if (s.attachments !== undefined) {
    out.push(s.attachments ? 'Takes files with reports' : 'Takes no files');
  }
  if (s.intake !== undefined) {
    out.push(s.intake ? 'Opens the site to reports' : 'Leaves the site closed to reports');
  }
  if (s.logbook !== undefined) {
    const p = startingPoints().find((x) => x.id === s.logbook);
    if (p) {
      out.push(
        `Makes a draft logbook, “${p.title}”, with ${String(p.questions)} questions` +
          (p.typed ? '' : ', all of them choices') +
          `${p.takes_files ? ' and a place for files' : ' and no files'}. ` +
          'You launch it when you are ready.',
      );
    }
  }
  if (s.list !== undefined) {
    const t = shippedTemplate(s.list.template);
    if (t) {
      out.push(
        `Makes a list, “${t.title}”, at /list/${s.list.slug ?? t.slug}, asking ${String(t.fields.length)} ` +
          `${t.fields.length === 1 ? 'question' : 'questions'}` +
          (t.requiresEmail ? '' : ' and no email address') +
          '. It starts hidden: you list it when you are ready.',
      );
    }
  }
  if (s.copy) {
    const n = Object.keys(s.copy).length;
    out.push(`Writes ${String(n)} ${n === 1 ? 'piece' : 'pieces'} of page text`);
  }
  return out;
}

export function templateSummaries(): TemplateSummary[] {
  return TEMPLATES.map((t) => ({
    id: t.id,
    label: t.label,
    description: t.description,
    sets: describeSettings(t.settings),
  }));
}

export async function appliedTemplate(db: Database): Promise<TemplateCatalogue['applied']> {
  const row = await db
    .selectFrom('site_settings')
    .select(['template_applied', 'template_applied_at'])
    .where('id', '=', true)
    .executeTakeFirst();
  if (!row?.template_applied || !row.template_applied_at) return null;
  return { id: row.template_applied, at: new Date(row.template_applied_at).toISOString() };
}

/**
 * Apply one, in one transaction. `by` is who did it, recorded on each switch
 * the way its own screen records it.
 *
 * Applying the same one twice makes a second draft rather than touching the
 * first, which may already be launched. A logbook already there, and every
 * report in it, is never touched.
 */
export async function applyTemplate(db: Database, id: string, by: string): Promise<Applied> {
  const template = templateById(id);
  if (!template) throw new HttpError(404, 'no_such_template', 'There is no such template.');
  return applyTemplateDefinition(db, template, by);
}

/**
 * Apply a template that is not necessarily one that ships. Exported for the
 * database test, which hands it one that fails at the last write to show
 * that nothing before it stays written.
 */
export async function applyTemplateDefinition(
  db: Database,
  template: Template,
  by: string,
): Promise<Applied> {
  const id = template.id;
  const checked = planTemplate(template);
  if (!checked.ok) throw new HttpError(400, 'refused', checked.error);
  const plan = checked.value;

  return db.transaction().execute(async (trx) => {
    // Page text with a placeholder is checked as the wording screen checks
    // it, before anything is written.
    const placeholders = plan.copy.filter((c) => c.body?.includes('{{'));
    if (placeholders.length) {
      const values = await figureValues(trx);
      const problems = placeholders.flatMap((c) => checkText(c.body ?? '', values));
      if (problems.length) throw new HttpError(400, 'refused', problems.join(' · '));
    }

    // Each through the module that owns it, as its own screen writes it.
    const settings = {
      ...(plan.siteName !== undefined ? { site_name: plan.siteName } : {}),
      ...(plan.look ?? {}),
    };
    if (Object.keys(settings).length) await writeSettings(trx, settings);
    if (plan.publicArchive !== undefined) await setPublicArchive(trx, plan.publicArchive, by);
    if (plan.attachments !== undefined) await setSiteLimits(trx, { enabled: plan.attachments }, by);
    if (plan.intake !== undefined) await setIntakeSwitch(trx, plan.intake, by);

    // CLEAR FIRST, then write: a template that both cleared and set text
    // would otherwise clear what it had just written. No row is "what ships".
    if (plan.clearCopy) await trx.deleteFrom('site_copy').execute();
    for (const c of plan.copy) await writeCopy(trx, c.key, c.body);

    // The logbook, as a DRAFT. Launching is the one step that cannot be
    // undone, so it is never done on anybody's behalf.
    let logbook: { id: number; slug: string; title: string } | undefined;
    if (plan.logbook !== undefined) {
      const made = await createFromFile(trx, templateLogbook(plan.logbook), { by });
      logbook = { id: made.id, slug: made.slug, title: made.title };
    }

    // The list, HIDDEN, as every new list starts (lists/manage.ts).
    let list: { id: number; slug: string; title: string } | undefined;
    if (plan.list !== undefined) {
      const made = await createFromTemplate(trx, plan.list.template, { slug: plan.list.slug });
      list = { id: made.id, slug: made.slug, title: made.title };
    }

    await trx
      .updateTable('site_settings')
      .set({ template_applied: id, template_applied_at: sql`now()`, updated_at: sql`now()` })
      .where('id', '=', true)
      .execute();

    return { applied: id, ...(logbook ? { logbook } : {}), ...(list ? { list } : {}) };
  });
}

type Made = { id: number; slug: string; title: string };
export interface Applied {
  applied: string;
  logbook?: Made;
  list?: Made;
}

export interface TemplateRouteDeps {
  /** Refuses anybody who is not an administrator. Required: there is no unguarded form. */
  requireAdmin: preHandlerAsyncHookHandler;
}

export async function templateRoutes(
  app: FastifyInstance,
  db: Database,
  { requireAdmin }: TemplateRouteDeps,
): Promise<void> {
  await app.register((scope, _opts, done) => {
    scope.addHook('preHandler', requireAdmin);

    route(scope, C.listTemplates, async () => ({
      templates: templateSummaries(),
      applied: await appliedTemplate(db),
    }));

    route(scope, C.applyTemplate, async ({ request }) => {
      // Fastify has already validated the body against the contract.
      const { template } = request.body as C.BodyOf<typeof C.applyTemplate>;
      const by = request.user?.email;
      if (!by) throw new HttpError(401, 'signed_out', 'Sign in first.');
      return applyTemplate(db, template, by);
    });

    done();
  });
}
