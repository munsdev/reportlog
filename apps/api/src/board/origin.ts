/**
 * Where a published report came from, as the public is told (Plan E, PE3).
 *
 * TWO ORIGINS, DECIDED BY THE SOFTWARE: a report an organization filed (its
 * sealed third-party provenance, which only a signed-in coordinator's
 * batch can write: filing/intake.ts) and everything else, which anybody
 * could have sent through the open form. The operator words the two labels
 * (site copy, `origin_organization` and `origin_open_form`); they cannot move
 * a report from one to the other.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';

export type Origin = 'organization' | 'open_form';

export const LABEL_FALLBACKS: Record<Origin, string> = {
  organization: 'Filed by an organization',
  open_form: 'Unverified public report',
};

export const originOf = (r: { third_party: boolean | null }): Origin =>
  r.third_party === true ? 'organization' : 'open_form';

/** The two labels, in the operator's words or ours. */
export async function originLabels(db: Kysely<DB>): Promise<Record<Origin, string>> {
  const rows = await db
    .selectFrom('site_copy')
    .select(['key', 'body'])
    .where('key', 'in', ['origin_organization', 'origin_open_form'])
    .execute();
  const own = (key: string) => rows.find((r) => r.key === key)?.body.trim() ?? '';
  return {
    organization: own('origin_organization') || LABEL_FALLBACKS.organization,
    open_form: own('origin_open_form') || LABEL_FALLBACKS.open_form,
  };
}
