/**
 * How much work is waiting for one person: the number on the site's Menu
 * button and beside the pages in the menu (docs/design/navigation.md).
 *
 * EACH COUNT ASKS WHAT ITS OWN SCREEN ASKS. A total is left out, not
 * zeroed, for anybody that screen's route would refuse, and the rule for
 * each is the route's own (imported, not restated), so the two cannot drift:
 *
 *   reports, list_entries   moderators and administrators who have accepted
 *                           the moderator agreement (moderatorGuard, the
 *                           queue's and list review's scope guard);
 *   tip_links               moderators and administrators (the link check
 *                           scope's roleGuard);
 *   feedback                the tester flag, administrators and Access
 *                           Managers (mayUseTracker).
 *
 * Totals only: no reference, no text, no link, no address. Every count is
 * one indexed aggregate, so asking on every page is cheap.
 */
import { OPEN_FEEDBACK_STATUSES } from '@reportlog/contracts';
import type { MenuWaiting } from '@reportlog/contracts';
import { roleSatisfies } from '@reportlog/access';
import { sql } from 'kysely';
import type { Database } from '../db/database.ts';
import { mayUseTracker } from '../feedback/routes.ts';
import type { SignedIn } from '../identity/sessions.ts';
import { hasAccepted } from '../moderation/agreement.ts';
import { waitingCount } from '../moderation/texts/items.ts';

const moderates = (user: SignedIn) =>
  roleSatisfies(user.roles, 'moderator') || roleSatisfies(user.roles, 'admin');

/** Waiting for a moderator: the queue's default view ("pending", withdrawn ones apart). */
export async function reportsWaiting(db: Database): Promise<number> {
  const r = await db
    .selectFrom('report_heads')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('moderation_status', '=', 'pending')
    .where('withdrawn', '=', false)
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

/** List entries nobody has reviewed, every list together (lists/review.ts `pendingCount`, summed). */
export async function listEntriesWaiting(db: Database): Promise<number> {
  const r = await db
    .selectFrom('list_entries')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('review_state', '=', 'received')
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

/** Tip links nobody has checked: the link check's default filter ("unchecked"). */
export async function tipLinksWaiting(db: Database): Promise<number> {
  const r = await db
    .selectFrom('link_groups as g')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('g.outcome', 'is', null)
    // Not a group only an older version of a report still carries (the link
    // was corrected away): links/reads.ts hides those from the queue too.
    .where(
      sql<boolean>`NOT (NOT EXISTS (SELECT 1 FROM links l WHERE l.group_id = g.id)
        AND NOT EXISTS (SELECT 1 FROM report_values rv
             JOIN report_heads h ON h.current_report_id = rv.report_id WHERE rv.group_id = g.id)
        AND EXISTS (SELECT 1 FROM report_values o WHERE o.group_id = g.id))`,
    )
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

/** Feedback still open (the statuses the weekly digest lists). */
export async function feedbackOpen(db: Database): Promise<number> {
  const r = await db
    .selectFrom('feedback')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('status', 'in', [...OPEN_FEEDBACK_STATUSES])
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

export async function waitingFor(db: Database, user: SignedIn): Promise<MenuWaiting> {
  const mod = moderates(user);
  const agreed = mod && (await hasAccepted(db, 'moderator', user.email));
  // Conditional keys on purpose: absent means "not yours to know", and a
  // zero would claim the person had looked and found nothing.
  return {
    ...(agreed ? { reports: await reportsWaiting(db) } : {}),
    ...(agreed ? { list_entries: await listEntriesWaiting(db) } : {}),
    ...(mod ? { tip_links: await tipLinksWaiting(db) } : {}),
    ...(agreed ? { texts: await waitingCount(db) } : {}),
    ...(mayUseTracker(user) ? { feedback: await feedbackOpen(db) } : {}),
  };
}
