/**
 * Tip links (Plan D §5 and §8): the check queue, the comment for
 * journalists, the blocklist. Owner, administrators and moderators only.
 *
 * Bodies are typed loosely, as the lists contract's are: the module refuses
 * with a sentence a moderator can read.
 */
import { z } from 'zod';
import { defineRoute } from './route.ts';

const Id = z.coerce.number().int().positive();
const Timestamp = z.string();

export const LinkOutcome = z.enum(['checked', 'withheld', 'illegal']);
export type LinkOutcome = z.infer<typeof LinkOutcome>;
export const LinkFilter = z.enum(['unchecked', 'checked', 'withheld', 'illegal']);
export type LinkFilter = z.infer<typeof LinkFilter>;
export const BlockKind = z.enum(['address', 'domain']);
export type BlockKind = z.infer<typeof BlockKind>;

/**
 * Why a link is illegal. A category, never free text: a written description
 * of illegal material is a copy of it. Must match REASON_CATEGORIES in
 * apps/api/src/links/blocklist.ts; a unit test reads both.
 */
export const LINK_REASONS = {
  'child-sexual-abuse': 'Child sexual abuse material',
  'terrorist-content': 'Terrorist content',
  'non-consensual-intimate-imagery': 'Intimate images shared without consent',
  'incitement-or-threats': 'Incitement or threats',
  'other-illegal': 'Other illegal content',
} as const;
export type LinkReason = keyof typeof LINK_REASONS;

/** Why an entry comes off the blocklist. Must match UNBLOCK_REASONS in blocklist.ts. */
export const UNBLOCK_REASONS = {
  'added-by-mistake': 'It was added by mistake',
  'too-broad': 'It blocks more than it should',
  'no-longer-illegal': 'What it points at is no longer illegal',
} as const;
export type UnblockReason = keyof typeof UNBLOCK_REASONS;

/**
 * K2: directly above every link field, part of the field type, so every form
 * that asks for a link shows it. Logbooks ask for none (Plan D §2). The
 * owner's wording of 21 October 2026 (voting questionnaires §04),
 * replacing the spec's first version.
 */
export const LINK_FIELD_WORDING =
  "Links you send here are never published. A moderator checks each one, and links that pass may be shared with vetted journalists. Don't link to your own account if you want to stay anonymous.";

/** The comment box's warning line (M4), shown above it wherever it is edited. */
export const LINK_COMMENT_WARNING =
  "Journalists will read this. Facts about the link only. Don't name or describe any person, and nothing about who filed it.";
export const MAX_LINK_COMMENT = 500;

/**
 * The hotline procedure (X5). Outside the code: report the link to a
 * hotline, then mark it illegal here, which erases it.
 */
export const HOTLINES = [
  { name: 'Internet-Beschwerdestelle', url: 'https://www.internet-beschwerdestelle.de/' },
  { name: 'jugendschutz.net', url: 'https://www.jugendschutz.net/' },
] as const;

export const LinkGroup = z.object({
  id: z.number().int(),
  url: z.string().nullable(),
  host: z.string().nullable(),
  /** Live copies: `from_tips + from_reports`. */
  copies: z.number().int(),
  from_tips: z.number().int(),
  /** Reports whose newest version carries it (W3). */
  from_reports: z.number().int(),
  lists: z.array(z.object({ id: z.number().int(), title: z.string() })),
  /** The logbooks of the reports that carry it. */
  logbooks: z.array(z.object({ id: z.number().int(), title: z.string() })),
  outcome: LinkOutcome.nullable(),
  checked_at: Timestamp.nullable(),
  checked_by: z.string().nullable(),
  comment: z.string().nullable(),
  first_seen: Timestamp.nullable(),
  last_seen: Timestamp.nullable(),
});
export type LinkGroup = z.infer<typeof LinkGroup>;

const GroupParams = z.object({ id: Id });

export const listLinkGroups = defineRoute({
  method: 'GET',
  path: '/api/link-checks',
  summary: 'The link check queue: one entry per distinct link.',
  query: z.object({ filter: LinkFilter.optional(), limit: z.coerce.number().int().optional() }),
  response: z.object({ filter: LinkFilter, groups: z.array(LinkGroup) }),
});

export const checkLinkGroup = defineRoute({
  method: 'POST',
  path: '/api/link-checks/:id/check',
  summary: 'Check a link: checked, withheld, or illegal (which erases every copy).',
  params: GroupParams,
  body: z.object({
    outcome: z.string(),
    reason: z.string().optional(),
    block: BlockKind.optional(),
  }),
  response: z.object({ outcome: LinkOutcome, erased: z.number().int() }),
});

export const commentLinkGroup = defineRoute({
  method: 'POST',
  path: '/api/link-checks/:id/comment',
  summary: "Set a link's comment for journalists. Every edit is recorded.",
  params: GroupParams,
  body: z.object({ body: z.string() }),
  response: z.object({ comment: z.string().nullable() }),
});

export const LinkHistoryItem = z.object({
  at: Timestamp,
  by: z.string(),
  kind: z.enum(['check', 'comment', 'erasure']),
  outcome: LinkOutcome.optional(),
  comment: z.string().optional(),
  reason_category: z.string().optional(),
  erased: z.number().int().optional(),
});

export const getLinkGroupHistory = defineRoute({
  method: 'GET',
  path: '/api/link-checks/:id/history',
  summary: 'Every check, comment and erasure of a link, oldest first.',
  params: GroupParams,
  response: z.object({ items: z.array(LinkHistoryItem) }),
});

export const BlocklistEntry = z.object({
  id: z.number().int(),
  kind: BlockKind,
  reason_category: z.string(),
  added_by: z.string(),
  created_at: Timestamp,
});
export type BlocklistEntry = z.infer<typeof BlocklistEntry>;

export const getBlocklist = defineRoute({
  method: 'GET',
  path: '/api/link-checks/blocklist',
  summary: 'The blocklist, without addresses: it holds none.',
  response: z.object({ entries: z.array(BlocklistEntry) }),
});

export const addToBlocklist = defineRoute({
  method: 'POST',
  path: '/api/link-checks/blocklist',
  summary: 'Block an exact address or a whole domain, including its subdomains.',
  body: z.object({ kind: BlockKind, text: z.string(), reason: z.string() }),
  response: z.object({ id: z.number().int(), added: z.boolean() }),
});

export const removeFromBlocklist = defineRoute({
  method: 'POST',
  path: '/api/link-checks/blocklist/:id/remove',
  summary: 'Take an entry off the blocklist. Recorded.',
  params: GroupParams,
  body: z.object({ reason: z.string() }),
  response: z.object({ removed: z.boolean() }),
});
