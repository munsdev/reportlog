/**
 * A report's links, joined to the link store (W3, K10, K11).
 *
 * A report link is a `report_values` row (reportValues/store.ts); this is what
 * puts it in a GROUP: one per distinct normalized address, the same group a
 * tip's copy of that address is in, so one check covers every copy from every
 * report and every tip, now and later (K12).
 *
 * THE MATCHING FORM is the link store's own (lists/urls.ts). A report link may
 * be one a tip would be refused for (a shortener, a bare address): the report
 * form takes any http or https link, so such a link falls back to the form
 * the URL parser wrote and is grouped on that. It still gets a group, so it
 * can still be checked or found illegal.
 *
 * THE BLOCKLIST (K13). A link it matches is never written, as for a tip, and
 * nobody is told: telling the sender would tell them what is listed. The
 * report is not refused and its sealed fingerprint stays; the value is simply
 * not kept, and the tombstone says so (reportValues/store.ts).
 */
import { normalizeUrl } from '../lists/urls.ts';
import { hashesFor, isBlocked } from './blocklist.ts';
import { matchKey } from './keys.ts';
import type { LinkKeys } from './keys.ts';
import type { Db } from './rows.ts';

export type ReportLinkGroup = { blocked: false; groupId: number } | { blocked: true };

export async function groupReportLink(
  trx: Db,
  keys: LinkKeys,
  value: string,
): Promise<ReportLinkGroup> {
  const n = normalizeUrl(value);
  let form = value;
  let host = '';
  if (n.ok) {
    form = n.url;
    host = n.host;
  } else {
    try {
      host = new URL(value).hostname.replace(/\.+$/, '');
    } catch {
      host = '';
    }
  }
  if (host && (await isBlocked(trx, hashesFor(keys, form, host)))) return { blocked: true };
  const key = matchKey(keys, form);
  await trx
    .insertInto('link_groups')
    .values({ match_key: key })
    .onConflict((oc) => oc.column('match_key').doNothing())
    .execute();
  const group = await trx
    .selectFrom('link_groups')
    .select('id')
    .where('match_key', '=', key)
    .executeTakeFirstOrThrow();
  return { blocked: false, groupId: group.id };
}
