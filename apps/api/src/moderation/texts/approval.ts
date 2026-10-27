/**
 * Approving a report that holds a written account or a link.
 *
 * A report with nothing typed approves as it always did. One that holds words
 * or links nobody has decided yet needs a decision on each of them, with a
 * reason, in the same step as the approval (single approval), or its own look
 * (batch approval skips it). "Decided" is the check the words or the address
 * already carry: a check follows the words (their sealed fingerprint) and the
 * link's group, so a version that only added files, or an address another
 * report already settled, asks for nothing again.
 *
 * Nothing here reads a value: the undecided ones are found by ids alone.
 * The decisions are applied one by one, each its own record, BEFORE the
 * approval. If the approval then fails (the report was withdrawn meanwhile),
 * the decisions stand, as decisions made on their own would.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../../db/schema.gen.ts';
import { HttpError } from '../../http/errors.ts';
import { checkGroup } from '../../links/checks.ts';
import { isReasonCategory } from '../../links/blocklist.ts';
import type { LinkKeys } from '../../links/keys.ts';
import { checkText, redactText, whyOf } from './items.ts';

type Db = Kysely<DB>;

export const WRITTEN_SKIP_WHY = 'It has a written account, which needs its own look.';

export interface UndecidedWritten {
  texts: { ref: string; valueId: number }[];
  links: { ref: string; valueId: number; groupId: number }[];
}

/** What the report's newest version holds that has no decision yet. Ids only. */
export async function undecidedWritten(db: Db, reportId: number): Promise<UndecidedWritten> {
  const texts = await db
    .selectFrom('report_values as rv')
    .leftJoin('text_items as ti', 'ti.fingerprint', 'rv.fingerprint')
    .select(['rv.id'])
    .where('rv.report_id', '=', reportId)
    .where('rv.kind', '=', 'private_text')
    .where('ti.outcome', 'is', null)
    .orderBy('rv.id')
    .execute();
  const links = await db
    .selectFrom('report_values as rv')
    .innerJoin('link_groups as g', 'g.id', 'rv.group_id')
    .select(['rv.id', 'g.id as group_id'])
    .where('rv.report_id', '=', reportId)
    .where('rv.kind', '=', 'private_link')
    .where('g.outcome', 'is', null)
    .orderBy('rv.id')
    .execute();
  return {
    texts: texts.map((t) => ({ ref: `report-${String(t.id)}`, valueId: t.id })),
    links: links.map((l) => ({ ref: `link-${String(l.id)}`, valueId: l.id, groupId: l.group_id })),
  };
}

export const holdsUndecided = (u: UndecidedWritten) => u.texts.length + u.links.length > 0;

export interface WrittenDecision {
  ref: string;
  outcome: string;
  why: string;
  /** "Illegal" only: the category, as everywhere else. */
  reason?: string | undefined;
  /** A text decided "redacted" (write a note): the moderator's note. Never the original. */
  note?: string | undefined;
}

const needed = () =>
  new HttpError(
    409,
    'written_needs_decision',
    'This report holds a written account or a link. Decide each one, with a reason, to approve it.',
  );

/** Decide every undecided written account and link of a report, or refuse before changing anything. */
export async function settleWritten(
  db: Db,
  keys: (() => Promise<LinkKeys>) | null,
  reportId: number,
  decisions: readonly WrittenDecision[] | undefined,
  actor: string,
): Promise<void> {
  const open = await undecidedWritten(db, reportId);
  if (!holdsUndecided(open)) return;
  const given = new Map((decisions ?? []).map((d) => [d.ref, d]));
  const wanted = [
    ...open.texts.map((o) => ({ ref: o.ref, groupId: null as number | null })),
    ...open.links.map((o) => ({ ref: o.ref, groupId: o.groupId })),
  ].map((o) => {
    const d = given.get(o.ref);
    if (!d) throw needed();
    return { target: o, d };
  });
  // Everything is checked before the first decision is written.
  for (const { d } of wanted) {
    whyOf(d.why);
    // A text is kept internal, given a note, or illegal. A link keeps its own
    // three (a link is not prose): checked, withheld, illegal.
    const isLink = wanted.find((w) => w.d === d)?.target.groupId != null;
    const allowed = isLink
      ? ['checked', 'withheld', 'illegal']
      : ['redacted', 'withheld', 'illegal'];
    if (!allowed.includes(d.outcome)) throw needed();
    if (d.outcome === 'redacted' && !(typeof d.note === 'string' && d.note.trim())) {
      throw new HttpError(400, 'copy_needed', 'Write the note journalists will read.');
    }
    if (d.outcome === 'illegal' && !isReasonCategory(d.reason)) {
      throw new HttpError(
        400,
        'reason_needed',
        'Pick why it is illegal. It is recorded with the erasure.',
      );
    }
  }
  if (!keys) {
    throw new HttpError(
      503,
      'no_contact_key',
      'This site has no CONTACT_KEY yet, so it keeps no written accounts. Tell whoever runs the server.',
    );
  }
  const k = await keys();
  const doneGroups = new Set<number>();
  for (const { target, d } of wanted) {
    if (target.groupId !== null) {
      // Two copies of one address in one report are one decision.
      if (doneGroups.has(target.groupId)) continue;
      doneGroups.add(target.groupId);
      await checkGroup(db, k, target.groupId, {
        outcome: d.outcome as 'checked' | 'withheld' | 'illegal',
        actor,
        reason: d.outcome === 'illegal' && isReasonCategory(d.reason) ? d.reason : undefined,
        why: whyOf(d.why),
      });
    } else if (d.outcome === 'redacted') {
      await redactText(db, k, target.ref, { body: d.note, why: d.why, actor });
    } else {
      await checkText(db, k, target.ref, {
        outcome: d.outcome,
        reason: d.reason,
        why: d.why,
        actor,
      });
    }
  }
}
