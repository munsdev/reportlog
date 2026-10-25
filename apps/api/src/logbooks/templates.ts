/**
 * The starting points a new logbook can be built from: the question sets in
 * ./templates/, each a logbook file (see logbookFile.ts).
 *
 * NOT THE DEPLOYMENT TEMPLATES. A deployment template writes site settings
 * wholesale and is offered once, by the first-run wizard; it belongs to the
 * site and identity workstreams, and its tables do not exist yet. A starting
 * point is how a LOGBOOK begins, and a deployment makes logbooks for years, so
 * a starting point carries questions and nothing about the site: adding a
 * second logbook must never rewrite the settings of a site that has been
 * running for months.
 *
 * A TEMPLATE IS NOT A MODE. Using one makes an ordinary draft, and then it is
 * over: nothing anywhere asks which starting point a logbook came from. If
 * starting points turned out to be the wrong idea, this file could be deleted
 * and no logbook would behave differently.
 *
 * IMPORTED, NOT READ FROM A PATH. The files are bundled by name, so a
 * starting point's id can never name a file outside the folder.
 */
import { LogbookFile } from '@reportlog/contracts';
import type { LogbookDetail, StartingPoint } from '@reportlog/contracts';
import { FILE_TYPE } from '@reportlog/fields';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { createFromFile } from './logbookFile.ts';
import { refuse } from './refusals.ts';
import elections from './templates/elections.json' with { type: 'json' };
import general from './templates/general.json' with { type: 'json' };
import howVotingWent from './templates/how-voting-went.json' with { type: 'json' };
import workplace from './templates/workplace.json' with { type: 'json' };

const FILES = {
  elections,
  'how-voting-went': howVotingWent,
  workplace,
  general,
} as const;

export type StartingPointId = keyof typeof FILES;
export const STARTING_POINTS = Object.keys(FILES) as StartingPointId[];

export function isStartingPoint(id: string): id is StartingPointId {
  return Object.hasOwn(FILES, id);
}

/** A starting point's logbook file, parsed. A shipped file that does not parse is a bug. */
export function templateLogbook(id: StartingPointId): LogbookFile {
  return LogbookFile.parse(FILES[id]);
}

const TYPED_KINDS: ReadonlySet<string> = new Set(['short_text', 'long_text', 'email', 'url']);

/**
 * What the "new logbook" screen shows. DESCRIBED FROM THE FILE rather than
 * from a table beside it, so a question added to a shipped logbook cannot
 * leave the page claiming the old count.
 */
export function startingPoints(): StartingPoint[] {
  return STARTING_POINTS.map((id) => {
    const f = templateLogbook(id);
    const hasUpload = f.questions.some((q) => q.kind === FILE_TYPE);
    return {
      id,
      title: f.title,
      blurb: f.blurb ?? null,
      // The count a person sees is the count of questions they will be shown,
      // so an upload question counts like any other, including the one an
      // older file's `accepts_files` turns into.
      questions: f.questions.length + (f.accepts_files && !hasUpload ? 1 : 0),
      takes_files: Boolean(f.accepts_files) || hasUpload,
      // Enough to tell a set of choices from a set of typing, which is the
      // distinction that actually changes whether somebody wants it.
      typed: f.questions.some(
        (q) => TYPED_KINDS.has(q.kind) || (q.kind === 'place' && q.allow_other !== false),
      ),
    };
  });
}

/**
 * Make a draft from a starting point. A STARTING POINT SUPPLIES QUESTIONS,
 * and the switches its file carries (editorial notes), as any logbook file
 * does: the operator's title and address win over the file's, because
 * they typed them second and on purpose. Nothing is launched on anybody's
 * behalf; launching is the one step that cannot be undone.
 */
export async function createFromStartingPoint(
  db: Kysely<DB>,
  spec: {
    starting_point: string;
    title: string;
    slug?: string | undefined;
    blurb?: string | undefined;
    /** Who is making it (see FileOverrides.by). */
    by?: string | undefined;
  },
): Promise<LogbookDetail> {
  if (!isStartingPoint(spec.starting_point)) return refuse('no-starting-point');
  return createFromFile(db, templateLogbook(spec.starting_point), {
    title: spec.title,
    slug: spec.slug,
    blurb: spec.blurb,
    by: spec.by,
  });
}
