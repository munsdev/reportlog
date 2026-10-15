/**
 * Deployment templates: a named bundle of settings, applied once.
 *
 * THE DECISION THIS FEATURE TURNS ON, stated first because everything else
 * follows from it: a template is NOT a mode the software runs in. Applying
 * one writes the ordinary settings rows an administrator could have typed
 * by hand, and then it is over. Nothing reads "which template is this" to
 * decide anything. There is no branch anywhere that asks what kind of log
 * this deployment is.
 *
 * The test of that, so it can be checked rather than hoped: if templates
 * turn out to be the wrong idea, this file and its routes can be deleted
 * and no deployment changes behaviour, because all any template ever did
 * was write settings that already existed and remain individually editable.
 *
 * The alternative — a `deployment_type` the code consults — was rejected.
 * It starts as a convenience and ends as a permanent fork in every query.
 *
 * WHAT FOLLOWS FROM IT
 *
 * - A template may only set things that are ALREADY settings. It cannot
 *   introduce behaviour. Wanting a template to change something is a reason
 *   to make that thing an ordinary operator-editable setting first.
 * - Nothing it writes is locked. Every value is editable afterwards.
 * - It is offered, never imposed. Skipping is a real answer.
 * - Applying a second one later just overwrites the settings it covers. It
 *   does not "switch type", because there is no type.
 * - It NEVER touches the imprint or the privacy policy. Those are the
 *   operator's own words and a template that pre-filled them would publish
 *   a placeholder as somebody's legal notice — the exact failure migration
 *   013 exists to prevent. Asserted in the suite.
 * - It NEVER touches anything hashed. Nothing here goes near a report.
 *
 * A TEMPLATE'S QUESTIONS ARE A LOGBOOK FILE. Every report is filed through a
 * logbook, so what a template brings is a logbook to start from: one of the
 * files in /templates, in exactly the format an administrator downloads and
 * uploads (src/logbookFile.js). Applying it creates a DRAFT. The operator
 * reads it, changes anything, and launches it themselves. A template that
 * takes no files and asks nothing to be typed is just a logbook file whose
 * questions are all choices, and whose `accepts_files` is false — the
 * operator can add a written question or turn files on before launch, or
 * add an optional question after it, like on any other logbook.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');

/**
 * A template's logbook file, by name, read from /templates. Null when there
 * is no such file. The name is checked before it is used as a path, so a
 * template cannot name a file outside the folder.
 */
export function templateLogbook(name) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(String(name))) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, `${name}.json`), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Every key a template is allowed to set, and how it is written.
 *
 * This list is the whole permission surface. A template naming anything
 * outside it is refused rather than partially applied, so a typo cannot
 * silently do half a job.
 */
export const TEMPLATE_KEYS = [
  // `layout` is still accepted and still ignored. The axis is retired —
  // width belongs to the theme — but a template written against the old
  // key should not become invalid, and no shipped template ever set it.
  //
  // `palette` and `theme` are now in the same position: STILL ACCEPTED AND
  // NO LONGER SET BY ANYTHING THAT SHIPS. A starting point answers what kind
  // of archive this is; it has no business also deciding what the site looks
  // like. Two reasons, and the second is the one that was actually costing
  // something. A template that set a palette meant picking "workplace"
  // repainted the whole site grey-blue, which an operator had not asked for
  // and had to hunt for afterwards under a tab that had nothing to do with
  // the choice they made. And the deployment now has a default look worth
  // starting from — the shipped flint/signal — so a template naming it was
  // restating the default, while a template naming anything else was
  // overriding a choice nobody made yet. The look is Style, changed there,
  // starting from the shipped one.
  //
  // Kept in the list rather than removed so an operator's own template file
  // written against them still applies instead of being refused whole.
  'siteName', 'palette', 'theme', 'layout', 'publicArchive', 'distribution',
  'attachments', 'intake', 'copy', 'clearCopy', 'logbook',
];

/**
 * CLEARING IS A SETTING TOO, and it needs saying out loud because the rule
 * everywhere else here is the opposite: a key a template omits is left
 * alone, so a narrow template stays narrow.
 *
 * "Start from nothing" could not be written under that rule. Omitting the
 * name and the page text left the previous operator's name and page text
 * sitting there, which is the one thing its label promises it will not do —
 * an operator pressed it, watched nothing happen, and reasonably concluded
 * the button was broken.
 *
 * So clearing is explicit rather than implied by absence:
 *   siteName: ''      the empty string means "back to the shipped default",
 *                     exactly as it does on POST /api/admin/identity.
 *   clearCopy: true   every page-text slot back to what ships.
 *
 * None of it deletes anything that cannot be got back: page text returns to
 * the shipped wording, logbooks are never touched (a template only ever ADDS
 * a draft), and the imprint and the privacy policy are untouchable from here.
 */

export const TEMPLATES = [
  {
    id: 'elections',
    label: 'Election incidents',
    description: 'Observers and voters reporting what went wrong at a polling place: '
      + 'what happened, where, when, and an account in their own words. Takes files. '
      + 'Public archive on.',
    // Omitted keys are LEFT ALONE rather than reset, so a template can be
    // narrow on purpose.
    settings: {
      publicArchive: true,
      attachments: true,
      intake: true,
      logbook: 'elections',
      copy: {
        home_headline: 'A record of what happened, that cannot be quietly changed.',
        home_intro: 'If you saw something go wrong at a polling place — a voter turned '
          + 'away, a line nobody could stand in, an observer shut out — file it here. '
          + 'A moderator reads every report before any of it is published.',
      },
    },
  },
  {
    // The same subject with nothing to type and nothing to upload: every
    // question is a choice, and the logbook takes no files. Not a mode —
    // just a logbook file built that way, and changeable like any other.
    id: 'elections-choices',
    label: 'Election incidents, no files or free text',
    description: 'How it went, asked as a short set of choices: the reporter\'s role, '
      + 'the state, the day, the time, and what went wrong if anything did. Nothing to '
      + 'type and nothing to upload. Public archive on.',
    settings: {
      publicArchive: true,
      attachments: false,
      intake: true,
      logbook: 'elections-choices',
      copy: {
        home_headline: 'A record of what happened, that cannot be quietly changed.',
        home_intro: 'Voted, worked a polling place or watched one? Say how it went — '
          + 'fine or not — in a minute, with nothing to type. A moderator reads every '
          + 'report before any of it is published.',
      },
    },
  },
  {
    id: 'workplace',
    label: 'Workplace or safety incidents',
    description: 'Incidents inside one organisation — safety, conduct, near misses. '
      + 'Nothing published by default, and takes files.',
    settings: {
      publicArchive: false,
      attachments: true,
      intake: true,
      logbook: 'workplace',
      copy: {
        home_headline: 'A record of what happened here, that cannot be quietly changed.',
        home_lede: 'File a report. A reviewer reads it. Once it is filed, nobody — '
          + 'including whoever runs this archive — can alter or remove it without that '
          + 'being visible.',
        home_intro: 'This archive is for incidents inside this organisation. Nothing '
          + 'filed here is published outside it.',
        standards: 'Who reviews a report, how quickly, and what happens next.\n\n'
          + 'Write this before opening the form, not afterwards.',
      },
    },
  },
  {
    /* ARCHIVE OFF AND EDITORIAL NOTES ON, which is the combination nothing
       else here exercises: the editorial layer working with nothing
       publishing. An organisation's own hazard log has readers — the people
       who have to act on it — and "what we established about this" is worth
       as much internally as it is in public.

       NOT THE SAME AS 'workplace'. That one collects incidents: things that
       happened. This collects observations: things that have not happened
       yet and should not be left to. A log that asks "what happened" of a
       near miss is how a near-miss log fills with nothing. */
    id: 'safety-log',
    label: 'An internal safety log',
    description: 'Hazards and near misses inside one organisation \u2014 things noticed '
      + 'before they go wrong. Nothing published outside it, and reviewers can attach '
      + 'their own notes. Takes files.',
    settings: {
      publicArchive: false,
      attachments: true,
      intake: true,
      logbook: 'safety-log',
      copy: {
        home_headline: 'Say what you noticed, before it hurts somebody.',
        home_lede: 'It does not have to have gone wrong yet. File it, somebody reads '
          + 'it, and once it is filed nobody \u2014 including whoever runs this '
          + 'archive \u2014 can quietly alter or remove it.',
        home_intro: 'This log is for hazards and near misses here. Nothing filed in it '
          + 'is published outside this organisation.',
        standards: 'Who reads a safety observation, how quickly, and what happens '
          + 'next.\n\nWrite this before opening the form. A hazard log that nobody '
          + 'has promised to read is a suggestion box.',
      },
    },
  },
  {
    /* IDENTITY REQUIRED, and it is NOT a setting \u2014 it is a logbook
       asking required questions, which is the only way it could be done
       honestly. The spine always collects a way to reach somebody; what
       this logbook adds is that they say who they are, sealed with every
       other answer.

       A `deployment_type` the code consults is refused outright
       (docs/reference.md \u00a721.5), and "anonymous filing off" as a
       site switch would be exactly that by another name: it would have to
       mean something different on every logbook of a deployment that runs
       several.

       THE FIRST CARD IS THE WARNING, before anything asks for a name, and
       every later question is conditional on the answer. A required name
       question that arrives unannounced is a form somebody abandons on the
       card that asks it \u2014 and abandoning it after typing an account
       of something that happened to them is worse than not starting. */
    id: 'professional-complaint',
    label: 'A complaint about a practitioner',
    description: 'Conduct or competence of somebody practising \u2014 clinical, legal, '
      + 'or any licensed trade. Asks who the complainant is and will not take an '
      + 'anonymous one. Nothing published until a moderator publishes it.',
    settings: {
      publicArchive: false,
      attachments: true,
      intake: true,
      logbook: 'professional-complaint',
      copy: {
        home_headline: 'A complaint that is on the record, and stays on it.',
        home_lede: 'File it, a reviewer reads it, and once it is filed nobody '
          + '\u2014 including whoever runs this archive \u2014 can alter or remove it '
          + 'without that being visible.',
        home_intro: 'This archive takes complaints about the conduct and competence of '
          + 'people practising. It cannot take an anonymous one: a complaint about a '
          + 'named person that nobody will stand behind cannot be acted on.',
        standards: 'Who reviews a complaint, what happens to the person complained '
          + 'about, and what the complainant is told.\n\nWrite this before opening '
          + 'the form. This is the archive where not having written it does the most '
          + 'harm \u2014 to both of them.',
      },
    },
  },
  {
    id: 'blank',
    label: 'Start from nothing',
    description: 'Clears the page text and makes no logbook: you build your own. '
      + 'For a deployment you want to set up entirely by hand. It leaves the name '
      + 'and the look alone \u2014 the name is asked before this and no starting '
      + 'point touches the look.',
    settings: {
      // NO siteName. It used to be '', which means "back to the shipped
      // default" — and the setup wizard now asks for the name BEFORE the
      // starting point, so clearing it here would wipe the name the operator
      // typed on the screen before and send them to a deployment called
      // ReportLog. A starting point supplies settings and questions; the
      // deployment's own name is not a starting point's business.
      clearCopy: true,
      intake: true,
      publicArchive: false,
      attachments: false,
    },
  },
];

export const TEMPLATE_IDS = TEMPLATES.map((t) => t.id);

export function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) || null;
}

/** What the wizard and the admin panel show: never the settings themselves. */
export function templateSummaries() {
  return TEMPLATES.map((t) => ({
    id: t.id,
    label: t.label,
    description: t.description,
    // So a person can see what pressing this will change before they press
    // it. A bundle that applies invisibly is a bundle nobody can consent to.
    sets: describeSettings(t.settings),
  }));
}

/** One plain line per thing a template will change. */
export function describeSettings(settings) {
  const out = [];
  if (settings.siteName) out.push(`Names the site “${settings.siteName}”`);
  // Distinguished from an absent key, which means "leave the name alone".
  if (settings.siteName === '') out.push('Clears the name, back to what the software ships with');
  if (settings.clearCopy) out.push('Clears every piece of page text, back to the shipped wording');
  if (settings.palette) out.push(`Sets the colours to ${settings.palette}`);
  if (settings.theme) out.push(`Sets the type and shape to ${settings.theme}`);
  if (settings.publicArchive !== undefined) {
    out.push(settings.publicArchive ? 'Publishes an archive' : 'Publishes nothing');
  }
  if (settings.distribution !== undefined) {
    out.push(settings.distribution ? 'Allows distribution' : 'Leaves distribution off');
  }
  if (settings.attachments !== undefined) {
    out.push(settings.attachments ? 'Turns file storage on' : 'Leaves file storage off');
  }
  if (settings.intake !== undefined) {
    out.push(settings.intake ? 'Opens the site to reports' : 'Leaves the site closed to reports');
  }
  if (settings.logbook !== undefined) {
    const f = templateLogbook(settings.logbook);
    if (f) {
      const typed = f.questions.some((q) => ['short_text', 'long_text', 'email', 'url'].includes(q.kind)
        || (q.kind === 'place' && q.allow_other !== false));
      out.push(`Makes a draft logbook, “${f.title}”, with ${f.questions.length} questions`
        + `${typed ? '' : ', all of them choices'}`
        + `${f.accepts_files ? ' and a place for files' : ' and no files'}. `
        + 'You launch it when you are ready.');
    }
  }
  if (settings.copy) {
    out.push(`Writes ${Object.keys(settings.copy).length} piece(s) of page text`);
  }
  return out;
}

/**
 * Pure, so what a template is allowed to contain is testable without a
 * database — and so a bad one is refused whole rather than applied halfway.
 */
export function validateTemplate(t) {
  if (!t || typeof t !== 'object') return { ok: false, error: 'No such template.' };
  const keys = Object.keys(t.settings || {});
  const unknown = keys.filter((k) => !TEMPLATE_KEYS.includes(k));
  if (unknown.length) {
    return { ok: false, error: `A template cannot set: ${unknown.join(', ')}` };
  }
  // The line that matters most. A template that wrote these would publish a
  // placeholder as somebody's legal notice.
  for (const forbidden of ['impressum', 'privacy', 'impressum_text', 'privacy_text']) {
    if (keys.includes(forbidden)) {
      return { ok: false, error: 'A template may never write legal text.' };
    }
  }
  return { ok: true };
}

/**
 * The starting points a NEW LOGBOOK can be built from — the question sets
 * only, with nothing about the deployment in them.
 *
 * NOT THE SAME THING AS A TEMPLATE, and the difference is the whole reason
 * this exists separately. A template is how a DEPLOYMENT begins: it writes
 * site settings wholesale and is offered once, by the first-run wizard. A
 * starting point is how a LOGBOOK begins, and a deployment makes logbooks for
 * years — so offering the template here would mean the act of adding a second
 * logbook silently rewrote the settings of a site that had been running for
 * months.
 *
 * So this reads the same `templates/*.json` logbook files and reports only
 * what is in them: a title, a blurb, its questions. Every one of them is
 * `accepts_files` or an upload question away from taking files, which is said
 * here because it is the one thing about a question set somebody wants to know
 * before picking it.
 *
 * Described FROM THE FILE rather than from a table beside it, so a question
 * added to a shipped logbook cannot leave this page claiming the old count.
 */
export const LOGBOOK_STARTING_POINTS = [
  'elections', 'elections-choices', 'workplace', 'safety-log', 'professional-complaint',
];

export function logbookStartingPoints() {
  return LOGBOOK_STARTING_POINTS.map((id) => {
    const f = templateLogbook(id);
    if (!f) return null;
    const questions = Array.isArray(f.questions) ? f.questions : [];
    const takesFiles = Boolean(f.accepts_files) || questions.some((q) => q.kind === 'file');
    return {
      id,
      title: f.title,
      blurb: f.blurb || null,
      // The count a person sees is the count of questions they will be shown,
      // so an upload question counts like any other — it is one of the things
      // the form asks for.
      questions: questions.length,
      takesFiles,
      // Enough to tell a set of choices from a set of typing, which is the
      // distinction that actually changes whether somebody wants it.
      typed: questions.some((q) => ['short_text', 'long_text', 'email', 'url'].includes(q.kind)
        || (q.kind === 'place' && q.allow_other !== false)),
    };
  }).filter(Boolean);
}
