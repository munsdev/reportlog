/**
 * The blocklist (Plan D K13).
 *
 * KEYED HASHES, NEVER ADDRESSES. Neither the database nor a backup holds a
 * readable list of illegal links, so nobody on staff can read the list back
 * either: an entry is shown by kind, reason, who and when. An exact entry is
 * the matching key of the normalized address; a domain entry is the hash of
 * the domain, and an arriving host is tested with each of its parent
 * domains, so blocking `example.com` also blocks `video.example.com`.
 *
 * A link that matches is ERASED ON ARRIVAL: it is never written, never queued
 * and never shown (store.ts). Copies that arrived before the entry was added
 * stay where they are; marking their group illegal is how they go.
 *
 * Every addition and removal goes into `link_block_log`, append-only.
 */
import { normalizeUrl } from '../lists/urls.ts';
import { LinkRefusal } from './refusals.ts';
import { domainHash, matchKey } from './keys.ts';
import type { LinkKeys } from './keys.ts';
import type { Db } from './rows.ts';

export const BLOCK_KINDS = ['address', 'domain'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

/**
 * Why a link is illegal, for the blocklist and for erasure (X4). A category,
 * never free text: the log is read by whoever audits it, and a written
 * description of illegal material is a copy of it.
 */
export const REASON_CATEGORIES = [
  'child-sexual-abuse',
  'terrorist-content',
  'non-consensual-intimate-imagery',
  'incitement-or-threats',
  'other-illegal',
] as const;
export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

export const isReasonCategory = (v: unknown): v is ReasonCategory =>
  typeof v === 'string' && (REASON_CATEGORIES as readonly string[]).includes(v);

/** Why an entry comes off the list. Also a category. */
export const UNBLOCK_REASONS = ['added-by-mistake', 'too-broad', 'no-longer-illegal'] as const;
export type UnblockReason = (typeof UNBLOCK_REASONS)[number];

export const isUnblockReason = (v: unknown): v is UnblockReason =>
  typeof v === 'string' && (UNBLOCK_REASONS as readonly string[]).includes(v);

/** A host and each parent domain, never the bare top-level one. */
export function domainsOf(host: string): string[] {
  const labels = host.toLowerCase().replace(/\.+$/, '').split('.').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < labels.length - 1; i += 1) out.push(labels.slice(i).join('.'));
  return out;
}

/** A domain as a moderator typed it: bare, or pasted as a whole address. */
export function cleanDomain(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length > 253) return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/\.+$/, '');
  // Two labels at least: blocking `com` is never what anybody meant.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/** Every hash an arriving link is tested against. */
export function hashesFor(keys: LinkKeys, normalized: string, host: string): string[] {
  return [matchKey(keys, normalized), ...domainsOf(host).map((d) => domainHash(keys, d))];
}

export async function isBlocked(db: Db, hashes: readonly string[]): Promise<boolean> {
  if (!hashes.length) return false;
  const hit = await db
    .selectFrom('link_blocklist')
    .select('id')
    .where('hash', 'in', [...hashes])
    .executeTakeFirst();
  return Boolean(hit);
}

/** What to block: typed by a moderator, or taken from a group being checked. */
export interface BlockTarget {
  kind: BlockKind;
  hash: string;
}

/** A target from what a moderator typed. Refuses what is not an address or a domain. */
export function targetFromText(keys: LinkKeys, kind: BlockKind, text: string): BlockTarget {
  if (kind === 'address') {
    const n = normalizeUrl(text);
    if (!n.ok) throw new LinkRefusal('not-an-address');
    return { kind, hash: matchKey(keys, n.url) };
  }
  const d = cleanDomain(text);
  if (!d) throw new LinkRefusal('not-a-domain');
  return { kind, hash: domainHash(keys, d) };
}

/** Add an entry, and log it. Adding one that is there already logs nothing. */
export async function addBlock(
  db: Db,
  target: BlockTarget,
  { reason, actor }: { reason: ReasonCategory; actor: string },
): Promise<{ id: number; added: boolean }> {
  const inserted = await db
    .insertInto('link_blocklist')
    .values({ kind: target.kind, hash: target.hash, reason_category: reason, added_by: actor })
    .onConflict((oc) => oc.column('hash').doNothing())
    .returning('id')
    .executeTakeFirst();
  if (!inserted) {
    const had = await db
      .selectFrom('link_blocklist')
      .select('id')
      .where('hash', '=', target.hash)
      .executeTakeFirstOrThrow();
    return { id: had.id, added: false };
  }
  await db
    .insertInto('link_block_log')
    .values({
      entry_id: inserted.id,
      kind: target.kind,
      action: 'add',
      reason_category: reason,
      actor_email: actor,
    })
    .execute();
  return { id: inserted.id, added: true };
}

/** Remove an entry, and log it. */
export async function removeBlock(
  db: Db,
  id: number,
  { reason, actor }: { reason: UnblockReason; actor: string },
): Promise<boolean> {
  const gone = await db
    .deleteFrom('link_blocklist')
    .where('id', '=', id)
    .returning(['id', 'kind'])
    .executeTakeFirst();
  if (!gone) return false;
  await db
    .insertInto('link_block_log')
    .values({
      entry_id: gone.id,
      kind: gone.kind,
      action: 'remove',
      reason_category: reason,
      actor_email: actor,
    })
    .execute();
  return true;
}

/** The list as staff see it: no address, because there is none to show. */
export async function blocklist(db: Db) {
  const rows = await db
    .selectFrom('link_blocklist')
    .select(['id', 'kind', 'reason_category', 'added_by', 'created_at'])
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as BlockKind,
    reason_category: r.reason_category,
    added_by: r.added_by,
    created_at: new Date(r.created_at).toISOString(),
  }));
}
