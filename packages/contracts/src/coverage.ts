/**
 * Coverage (decision 84): articles journalists link to their profile, tagged
 * with where the events they report happened. Once a moderator approves one
 * and its author chose to list it, it shows on the public coverage list
 * beside the reports and on the heat maps as a layer of its own.
 *
 * An article is never sealed and never names a reporter. Its page is never
 * stored: the card shown for it is read from the page when asked for
 * (`getCoverageCard`) and kept only in the server's memory.
 */
import { z } from 'zod';
import { defineRoute } from './route.ts';

/** A place code in the gazetteer's spelling: US-AZ, US-AZ-04013, or a country such as DE. */
export const CoveragePlaceCode = z
  .string()
  .regex(/^[A-Z]{2}(-[A-Z0-9]{1,3}(-[0-9]{5})?)?$/)
  .refine((c) => c !== 'US', 'National is its own choice, not a place.');

export const CoverageReview = z.enum(['waiting', 'approved', 'declined']);
export type CoverageReview = z.infer<typeof CoverageReview>;

export const CoveragePlace = z.object({ code: z.string(), name: z.string() });
export type CoveragePlace = z.infer<typeof CoveragePlace>;

/** Where an article is about, as every screen shows it. */
const Where = {
  national: z.boolean(),
  international: z.boolean(),
  places: z.array(CoveragePlace),
};

export const Byline = z.object({
  name: z.string(),
  outlet: z.string().nullable(),
});
export type Byline = z.infer<typeof Byline>;

/** An article as its author sees it, on their own profile. */
export const MyArticle = z.object({
  id: z.number().int(),
  url: z.string(),
  host: z.string(),
  happened_on: z.string().nullable(),
  ...Where,
  listed: z.boolean(),
  review: CoverageReview,
  /** The moderator's note, when they wrote one. */
  review_note: z.string().nullable(),
  created_at: z.string(),
});
export type MyArticle = z.infer<typeof MyArticle>;

export const MyCoverage = z.object({
  byline: Byline.nullable(),
  articles: z.array(MyArticle),
});
export type MyCoverage = z.infer<typeof MyCoverage>;

export const getMyCoverage = defineRoute({
  method: 'GET',
  path: '/api/coverage/mine',
  summary: "The signed-in journalist's byline and the articles they linked.",
  response: MyCoverage,
});

export const BylineBody = z.object({
  name: z.string().trim().min(1).max(120),
  outlet: z.string().trim().max(160).optional(),
});
export type BylineBody = z.infer<typeof BylineBody>;

export const setMyByline = defineRoute({
  method: 'PUT',
  path: '/api/coverage/mine/byline',
  summary: 'How the journalist is credited on the public coverage list.',
  body: BylineBody,
  response: MyCoverage,
});

export const ArticleBody = z
  .object({
    url: z.string().trim().min(8).max(2000),
    /** YYYY-MM-DD: the day the events it reports happened. */
    happened_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    national: z.boolean(),
    international: z.boolean(),
    places: z.array(CoveragePlaceCode).max(25),
    listed: z.boolean(),
  })
  .refine((a) => a.national || a.international || a.places.length > 0, {
    message: 'Say where it is about: National, International, or at least one place.',
    path: ['places'],
  });
export type ArticleBody = z.infer<typeof ArticleBody>;

export const addMyArticle = defineRoute({
  method: 'POST',
  path: '/api/coverage/mine/articles',
  summary: 'Link an article. It waits for a moderator before it is shown to anybody else.',
  body: ArticleBody,
  response: MyCoverage,
});

const ArticleParams = z.object({ id: z.coerce.number().int().positive() });

export const setMyArticleListed = defineRoute({
  method: 'POST',
  path: '/api/coverage/mine/articles/:id/listed',
  summary: 'Show an article on the public coverage list and the maps, or keep it to the profile.',
  params: ArticleParams,
  body: z.object({ listed: z.boolean() }),
  response: MyCoverage,
});

export const removeMyArticle = defineRoute({
  method: 'DELETE',
  path: '/api/coverage/mine/articles/:id',
  summary: 'Remove an article from the profile, the list and the maps. It is deleted.',
  params: ArticleParams,
  response: MyCoverage,
});

// ── moderators ─────────────────────────────────────────────────────────────

export const QueuedArticle = z.object({
  id: z.number().int(),
  url: z.string(),
  host: z.string(),
  happened_on: z.string().nullable(),
  ...Where,
  listed: z.boolean(),
  review: CoverageReview,
  review_note: z.string().nullable(),
  reviewed_by: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  created_at: z.string(),
  byline: Byline.nullable(),
});
export type QueuedArticle = z.infer<typeof QueuedArticle>;

export const listCoverageQueue = defineRoute({
  method: 'GET',
  path: '/api/moderation/coverage',
  summary: 'Articles journalists linked, for a moderator: waiting first, or those decided.',
  query: z.object({ show: z.enum(['waiting', 'approved', 'declined']).optional() }),
  response: z.object({ articles: z.array(QueuedArticle), waiting: z.number().int() }),
});

export const decideArticle = defineRoute({
  method: 'POST',
  path: '/api/moderation/coverage/:id',
  summary: 'Approve or decline an article. Approving shows it wherever its author chose.',
  params: ArticleParams,
  body: z.object({
    decision: z.enum(['approved', 'declined']),
    note: z.string().trim().max(1000).optional(),
  }),
  response: QueuedArticle,
});

// ── the public list ────────────────────────────────────────────────────────

export const PublicArticle = z.object({
  id: z.number().int(),
  url: z.string(),
  host: z.string(),
  happened_on: z.string().nullable(),
  ...Where,
  byline: Byline.nullable(),
});
export type PublicArticle = z.infer<typeof PublicArticle>;

export const CoverageQuery = z.object({
  /** A place a map was clicked on: a state holds every county in it. */
  place: z
    .string()
    .regex(/^[A-Z]{2}(-[A-Z0-9]{1,3}(-[0-9]{5})?)?$/)
    .optional(),
  page: z.coerce.number().int().min(1).max(10000).optional(),
});

export const listCoverage = defineRoute({
  method: 'GET',
  path: '/api/coverage',
  summary: 'Approved articles their authors chose to list, newest event first.',
  query: CoverageQuery,
  response: z.object({
    articles: z.array(PublicArticle),
    total: z.number().int(),
    page: z.number().int(),
    page_size: z.number().int(),
  }),
});

/**
 * What the page behind an article says about itself, from its own meta tags
 * (Open Graph, then the plain title and description). Read when asked for,
 * never stored. `found: false` when the page could not be read, which the
 * card shows as the bare address.
 */
export const CoverageCard = z.union([
  z.object({
    found: z.literal(true),
    title: z.string().nullable(),
    description: z.string().nullable(),
    site_name: z.string().nullable(),
    published: z.string().nullable(),
  }),
  z.object({ found: z.literal(false) }),
]);
export type CoverageCard = z.infer<typeof CoverageCard>;

export const getCoverageCard = defineRoute({
  method: 'GET',
  path: '/api/coverage/:id/card',
  summary:
    "The card for an article: its page's own title, description and publisher, read now and not stored.",
  params: ArticleParams,
  response: CoverageCard,
});

/**
 * Listed, approved articles counted by place, for the heat maps' coverage
 * layer. A county counts toward its state too; an article naming two places
 * in one state counts once for that state. No threshold: an article names no
 * reporter, so a small count reveals nobody (decision 84).
 */
export const CoverageCounts = z.object({
  /** States and countries. */
  areas: z.record(z.string(), z.number().int()),
  /** Counties, keyed `US-AZ-04013`. */
  counties: z.record(z.string(), z.number().int()),
  national: z.number().int(),
  international: z.number().int(),
  total: z.number().int(),
});
export type CoverageCounts = z.infer<typeof CoverageCounts>;

export const getCoverageCounts = defineRoute({
  method: 'GET',
  path: '/api/coverage/counts',
  summary: 'Listed, approved articles counted by place, for the heat maps.',
  response: CoverageCounts,
});
