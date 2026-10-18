/**
 * The Alliance directory — organizations that have opted in to being listed.
 *
 * Not chained, and that is the design. Participation is mutable state about
 * a living relationship; sealing it would make an organization's membership
 * permanently unremovable, which is the wrong promise for something that
 * can end. See migration 010.
 *
 * WHAT THE NAME COSTS. Any directory of organizations reads as a
 * membership body with shared commitments and a bar to clear, and the
 * neutral name below does not make that go away. No such bar
 * exists — there is no published standard for verifying an organization,
 * which the Standards pages say plainly. So every surface that renders this
 * directory carries DISCLAIMER, and it is not decoration: without it the
 * nav bar makes, on the project's behalf, exactly the kind of claim the
 * site otherwise refuses to make. It is served from the API alongside the
 * rows rather than living only in a template, so a client that renders the
 * directory cannot render it without the sentence that qualifies it.
 */
import { pool } from './db.js';

export const DIRECTORY_NAME = 'Participating organizations';

export const DISCLAIMER = 'Listing here is not verification. These organizations '
  + 'asked to be listed; nobody has checked them against a standard, because no '
  + 'standard for verifying an organization has been published yet. Treat this as '
  + 'a list of who is taking part, not as an endorsement of any of them.';

/**
 * What appears publicly when an organization switches listing on.
 *
 * Kept here, as data, because the toggle has to say it and the API has to
 * serve it and the two must not drift. "List us publicly" is not an
 * adequate question: the member count is an aggregate about them that did
 * not exist before they were asked, and somebody agreeing to be listed has
 * not thereby agreed to publish their headcount unless they were told that
 * is what listing means.
 */
export const WHAT_APPEARS = [
  'The organization’s name.',
  'The date it joined the directory.',
  'How many people have accepted an invitation to it — an exact number, not a range.',
];

/**
 * The directory, ranked.
 *
 * BY MEMBER COUNT ONLY, and the reason is load-bearing rather than a
 * preference. Ranking by report count was rejected outright: it would
 * create a public incentive to file more reports, and the archive's entire
 * value is that its contents were not manufactured. That needs no bad faith
 * — a keen coordinator who wants their organization to look active is
 * enough. A scoreboard of volume is an argument for manufacturing volume.
 *
 * Members cannot be manufactured by typing, so a headcount carries no such
 * incentive. That is why this ranking is safe and the other is not.
 *
 * A member is a person who ACCEPTED an invitation. Pending invitations live
 * in organization_invites and are deliberately not counted here — otherwise
 * the number is "addresses this organization typed in", which certifies
 * nothing.
 *
 * An organization with zero accepted members still appears, showing 0.
 * Hiding them would mean the directory silently omits organizations that
 * opted in, and a manager wondering why they are not listed is a worse
 * outcome than a row showing an honest zero.
 */
export async function directory(client = pool) {
  const { rows } = await client.query(`
    SELECT o.id, o.name, o.details, o.listed_at,
           (SELECT count(*) FROM organization_memberships m
             WHERE m.organization_id = o.id)::int AS member_count
      FROM organizations o
     WHERE o.listed = true
     ORDER BY member_count DESC, o.name ASC
  `);
  return rows.map((r) => ({
    name: r.name,
    details: r.details || null,
    joined: r.listed_at,
    member_count: r.member_count,
  }));
}

/**
 * Switch listing on or off for one organization.
 *
 * `listed_at` is set the first time and never cleared. The date answers
 * "since when have they been part of this", not "how long has this boolean
 * been true", so an organization that opts out and back in keeps the date
 * it actually joined rather than appearing to be new.
 */
export async function setListed(organizationId, listed) {
  const { rows } = await pool.query(
    `UPDATE organizations
        SET listed = $2,
            listed_at = CASE WHEN $2 AND listed_at IS NULL THEN now() ELSE listed_at END,
            updated_at = now()
      WHERE id = $1
      RETURNING listed, listed_at`,
    [organizationId, listed],
  );
  return rows[0] || null;
}
