/**
 * Coverage (decision 84): a journalist's own articles, a moderator's review
 * of them, and the public list and map counts they feed.
 *
 * What goes public: an article a moderator APPROVED, that its author chose to
 * LIST, by somebody who is STILL A JOURNALIST. A journalist whose access ends
 * drops off the public list at once, without anybody deleting their rows,
 * and comes back if their access does.
 *
 * Nothing here is sealed or reaches the chain (the boundary check says so);
 * an article names no reporter, which is why its counts carry no threshold.
 */
import type {
  ArticleBody,
  Byline,
  BylineBody,
  CoverageCounts,
  CoveragePlace,
  MyArticle,
  MyCoverage,
  PublicArticle,
  QueuedArticle,
} from '@reportlog/contracts';
import { isPlaceCode, placeLabel, stateOfPlace } from '@reportlog/fields';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/schema.gen.ts';
import { HttpError } from '../http/errors.ts';
import { normalizeUrl } from '../lists/urls.ts';

type Db = Kysely<DB>;

export const PAGE_SIZE = 25;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const day = (d: Date | string | null): string | null =>
  d === null ? null : typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);

const URL_REFUSALS: Record<string, string> = {
  empty: 'Paste the address of the article.',
  'too-long': 'That address is too long. Use the article’s own address, not a search result.',
  unparseable: 'That does not look like a web address. It should start with https://',
  'not-http': 'Only web addresses (https:// or http://) can be linked.',
  'credentials-in-url': 'That address carries a password. Link the public page instead.',
  'bare-address-host': 'Link the article by its site’s name, not a numeric address.',
  shortener: 'Link the article’s own address, not a shortened one.',
  'no-host': 'That address has no site in it.',
};

/** Who is still a journalist: the public list and counts read only their articles. */
const stillJournalist = sql<boolean>`u.roles @> ARRAY['journalist']::text[]`;

async function placesOf(db: Db, ids: readonly number[]): Promise<Map<number, CoveragePlace[]>> {
  const out = new Map<number, CoveragePlace[]>();
  if (ids.length === 0) return out;
  const rows = await db
    .selectFrom('coverage_article_places')
    .select(['article_id', 'code'])
    .where('article_id', 'in', ids)
    .orderBy('code')
    .execute();
  for (const r of rows) {
    const list = out.get(r.article_id) ?? [];
    list.push({ code: r.code, name: placeLabel(r.code) });
    out.set(r.article_id, list);
  }
  return out;
}

async function bylineOf(db: Db, userId: number): Promise<Byline | null> {
  const row = await db
    .selectFrom('coverage_bylines')
    .select(['name', 'outlet'])
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return row ? { name: row.name, outlet: row.outlet } : null;
}

// ── the journalist's own ───────────────────────────────────────────────────

export async function mine(db: Db, userId: number): Promise<MyCoverage> {
  const rows = await db
    .selectFrom('coverage_articles')
    .selectAll()
    .where('user_id', '=', userId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  const places = await placesOf(
    db,
    rows.map((r) => r.id),
  );
  const articles: MyArticle[] = rows.map((r) => ({
    id: r.id,
    url: r.url,
    host: r.host,
    happened_on: day(r.happened_on),
    national: r.national,
    international: r.international,
    places: places.get(r.id) ?? [],
    listed: r.listed,
    review: r.review_state as MyArticle['review'],
    review_note: r.review_note,
    created_at: r.created_at.toISOString(),
  }));
  return { byline: await bylineOf(db, userId), articles };
}

export async function setByline(db: Db, userId: number, body: BylineBody): Promise<MyCoverage> {
  const outlet = body.outlet?.trim() ? body.outlet.trim() : null;
  await db
    .insertInto('coverage_bylines')
    .values({ user_id: userId, name: body.name.trim(), outlet })
    .onConflict((oc) =>
      oc.column('user_id').doUpdateSet({ name: body.name.trim(), outlet, updated_at: new Date() }),
    )
    .execute();
  return mine(db, userId);
}

/** The places as given, checked against the gazetteer, without repeats. */
export function checkedPlaces(codes: readonly string[]): string[] {
  const out = [...new Set(codes)];
  for (const code of out) {
    if (code === 'US' || !isPlaceCode(code)) {
      throw new HttpError(400, 'unknown_place', `${code} is not a place this site knows.`);
    }
  }
  // A county with its own state chosen too is the state's already; keep both,
  // since the journalist said both, but a state and its county count once.
  return out;
}

function checkedDay(value: string | undefined): string | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, 'bad_date', 'That date does not exist.');
  }
  return value;
}

export async function addArticle(db: Db, userId: number, body: ArticleBody): Promise<MyCoverage> {
  const url = normalizeUrl(body.url);
  if (!url.ok) throw new HttpError(400, 'bad_url', URL_REFUSALS[url.reason] ?? 'Not a link.');
  const places = checkedPlaces(body.places);
  const happened = checkedDay(body.happened_on);
  if (!body.national && !body.international && places.length === 0) {
    throw new HttpError(
      400,
      'no_place',
      'Say where it is about: National, International, or at least one place.',
    );
  }
  await db.transaction().execute(async (trx) => {
    const inserted = await trx
      .insertInto('coverage_articles')
      .values({
        user_id: userId,
        url: url.url,
        host: url.host,
        happened_on: happened,
        national: body.national,
        international: body.international,
        listed: body.listed,
      })
      .onConflict((oc) => oc.columns(['user_id', 'url']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!inserted) {
      throw new HttpError(409, 'already_linked', 'You have already linked that article.');
    }
    if (places.length > 0) {
      await trx
        .insertInto('coverage_article_places')
        .values(places.map((code) => ({ article_id: inserted.id, code })))
        .execute();
    }
  });
  return mine(db, userId);
}

async function ownArticle(db: Db, userId: number, id: number) {
  const row = await db
    .selectFrom('coverage_articles')
    .select('id')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!row) throw new HttpError(404, 'not_found', 'There is no such article on your profile.');
}

/** Listing needs no new review: the moderator already judged the article itself. */
export async function setListed(
  db: Db,
  userId: number,
  id: number,
  listed: boolean,
): Promise<MyCoverage> {
  await ownArticle(db, userId, id);
  await db
    .updateTable('coverage_articles')
    .set({ listed })
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .execute();
  return mine(db, userId);
}

export async function removeArticle(db: Db, userId: number, id: number): Promise<MyCoverage> {
  await ownArticle(db, userId, id);
  await db
    .deleteFrom('coverage_articles')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .execute();
  return mine(db, userId);
}

// ── moderators ─────────────────────────────────────────────────────────────

const queuedSelect = (db: Db) =>
  db
    .selectFrom('coverage_articles as a')
    .leftJoin('coverage_bylines as b', 'b.user_id', 'a.user_id')
    .select([
      'a.id',
      'a.url',
      'a.host',
      'a.happened_on',
      'a.national',
      'a.international',
      'a.listed',
      'a.review_state',
      'a.review_note',
      'a.reviewed_by',
      'a.reviewed_at',
      'a.created_at',
      'b.name as byline_name',
      'b.outlet as byline_outlet',
    ]);

type QueuedRow = Awaited<ReturnType<ReturnType<typeof queuedSelect>['executeTakeFirstOrThrow']>>;

const queuedOf = (r: QueuedRow, places: Map<number, CoveragePlace[]>): QueuedArticle => ({
  id: r.id,
  url: r.url,
  host: r.host,
  happened_on: day(r.happened_on),
  national: r.national,
  international: r.international,
  places: places.get(r.id) ?? [],
  listed: r.listed,
  review: r.review_state as QueuedArticle['review'],
  review_note: r.review_note,
  reviewed_by: r.reviewed_by,
  reviewed_at: iso(r.reviewed_at),
  created_at: r.created_at.toISOString(),
  byline: r.byline_name ? { name: r.byline_name, outlet: r.byline_outlet } : null,
});

export async function waitingCount(db: Db): Promise<number> {
  const row = await db
    .selectFrom('coverage_articles')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('review_state', '=', 'waiting')
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

export async function queue(
  db: Db,
  show: 'waiting' | 'approved' | 'declined',
): Promise<{ articles: QueuedArticle[]; waiting: number }> {
  let q = queuedSelect(db).where('a.review_state', '=', show);
  q =
    show === 'waiting'
      ? q.orderBy('a.created_at', 'asc')
      : q.orderBy('a.reviewed_at', 'desc').limit(200);
  const rows = await q.execute();
  const places = await placesOf(
    db,
    rows.map((r) => r.id),
  );
  return { articles: rows.map((r) => queuedOf(r, places)), waiting: await waitingCount(db) };
}

export async function decide(
  db: Db,
  id: number,
  by: string,
  decision: 'approved' | 'declined',
  note: string | undefined,
): Promise<QueuedArticle> {
  const updated = await db
    .updateTable('coverage_articles')
    .set({
      review_state: decision,
      reviewed_by: by,
      reviewed_at: new Date(),
      review_note: note?.trim() ? note.trim() : null,
    })
    .where('id', '=', id)
    .returning('id')
    .executeTakeFirst();
  if (!updated) throw new HttpError(404, 'not_found', 'There is no such article.');
  const row = await queuedSelect(db).where('a.id', '=', id).executeTakeFirstOrThrow();
  return queuedOf(row, await placesOf(db, [id]));
}

// ── the public list and counts ─────────────────────────────────────────────

const publicArticles = (db: Db) =>
  db
    .selectFrom('coverage_articles as a')
    .innerJoin('users as u', 'u.id', 'a.user_id')
    .where('a.review_state', '=', 'approved')
    .where('a.listed', '=', true)
    .where(stillJournalist);

/**
 * Narrowed to a place a map was clicked on: a state holds its counties, and
 * `US` (a country on a world map) holds every US place and the national ones.
 */
function inPlace(place: string) {
  return sql<boolean>`(
    ${place === 'US' ? sql`a.national OR ` : sql``}
    EXISTS (
      SELECT 1 FROM coverage_article_places p
      WHERE p.article_id = a.id
        AND (p.code = ${place} OR p.code LIKE ${`${place}-%`})
    )
  )`;
}

export async function publicList(
  db: Db,
  { place, page = 1 }: { place?: string | undefined; page?: number | undefined },
): Promise<{ articles: PublicArticle[]; total: number; page: number; page_size: number }> {
  let base = publicArticles(db);
  if (place) base = base.where(inPlace(place));
  const total = Number(
    (await base.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow()).n,
  );
  const rows = await base
    .leftJoin('coverage_bylines as b', 'b.user_id', 'a.user_id')
    .select([
      'a.id',
      'a.url',
      'a.host',
      'a.happened_on',
      'a.national',
      'a.international',
      'b.name as byline_name',
      'b.outlet as byline_outlet',
    ])
    // Newest events first; an article with no date sorts by when it was linked.
    .orderBy(sql`coalesce(a.happened_on, a.created_at::date)`, 'desc')
    .orderBy('a.id', 'desc')
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE)
    .execute();
  const places = await placesOf(
    db,
    rows.map((r) => r.id),
  );
  return {
    articles: rows.map((r) => ({
      id: r.id,
      url: r.url,
      host: r.host,
      happened_on: day(r.happened_on),
      national: r.national,
      international: r.international,
      places: places.get(r.id) ?? [],
      byline: r.byline_name ? { name: r.byline_name, outlet: r.byline_outlet } : null,
    })),
    total,
    page,
    page_size: PAGE_SIZE,
  };
}

/**
 * Listed, approved articles counted by area. An article counts once per
 * area however many of its places fall in it: two counties in Arizona are
 * one article for Arizona, and one each for the two counties.
 */
export async function counts(db: Db): Promise<CoverageCounts> {
  const rows = await publicArticles(db)
    .leftJoin('coverage_article_places as p', 'p.article_id', 'a.id')
    .select(['a.id', 'a.national', 'a.international', 'p.code'])
    .execute();
  const areas = new Map<string, Set<number>>();
  const counties = new Map<string, Set<number>>();
  const all = new Set<number>();
  const national = new Set<number>();
  const international = new Set<number>();
  const add = (into: Map<string, Set<number>>, code: string, id: number) => {
    const set = into.get(code) ?? new Set<number>();
    set.add(id);
    into.set(code, set);
  };
  for (const r of rows) {
    const id = r.id;
    all.add(id);
    if (r.national) national.add(id);
    if (r.international) international.add(id);
    if (!r.code) continue;
    const area = stateOfPlace(r.code);
    add(areas, area, id);
    if (area !== r.code) add(counties, r.code, id);
  }
  const sizes = (m: Map<string, Set<number>>) =>
    Object.fromEntries([...m].map(([code, ids]) => [code, ids.size]));
  return {
    areas: sizes(areas),
    counties: sizes(counties),
    national: national.size,
    international: international.size,
    total: all.size,
  };
}

/**
 * The address behind an article, if the person asking may see its card:
 * anybody for a public one, its author for their own, a moderator or an
 * administrator for any. Null otherwise, which the route answers as not found.
 */
export async function cardAddress(
  db: Db,
  id: number,
  asker: { id: number; roles: readonly string[] } | null,
): Promise<string | null> {
  const row = await db
    .selectFrom('coverage_articles as a')
    .innerJoin('users as u', 'u.id', 'a.user_id')
    .select(['a.url', 'a.user_id', 'a.review_state', 'a.listed', stillJournalist.as('journalist')])
    .where('a.id', '=', id)
    .executeTakeFirst();
  if (!row) return null;
  if (row.review_state === 'approved' && row.listed && row.journalist) return row.url;
  if (!asker) return null;
  if (row.user_id === asker.id) return row.url;
  if (asker.roles.some((r) => r === 'moderator' || r === 'admin' || r === 'owner')) return row.url;
  return null;
}
