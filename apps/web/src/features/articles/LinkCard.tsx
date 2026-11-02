/**
 * An article's card: what its own page says about itself (title, summary,
 * publisher), with where and when it is about and who linked it.
 *
 * THE CARD IS NEVER STORED, here or on the server's disk: the server reads
 * the page's meta tags when the card is asked for (articles/preview.ts) and
 * this page asks the server, never the article's site. No picture: showing
 * one would be a request to another site, which no page here makes. Until
 * the card arrives, or if the page could not be read, the card shows the
 * address itself, so it is never empty and never waits on a slow site.
 */
import type { Byline, CoveragePlace } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { coverageCardQuery } from './queries.ts';

export interface CardArticle {
  id: number;
  url: string;
  host: string;
  happened_on: string | null;
  national: boolean;
  international: boolean;
  places: CoveragePlace[];
  byline?: Byline | null;
}

const longDay = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { dateStyle: 'long' });

/** "National · Arizona · Maricopa, Arizona", in that order. */
export function whereOf(a: Pick<CardArticle, 'national' | 'international' | 'places'>): string {
  return [
    ...(a.national ? ['National'] : []),
    ...(a.international ? ['International'] : []),
    ...a.places.map((p) => p.name),
  ].join(' · ');
}

export function LinkCard({ article, children }: { article: CardArticle; children?: ReactNode }) {
  const card = useQuery(coverageCardQuery(article.id));
  const found = card.data?.found ? card.data : null;
  const title = found?.title ?? article.url;
  const publisher = found?.site_name ?? article.host;
  return (
    <article className="card" aria-busy={card.isPending || undefined}>
      <span className="tag">{publisher}</span>
      <h3 className="[overflow-wrap:anywhere]">
        {/* A plain link: leaving for the article is the reader's own choice. */}
        <a href={article.url} rel="noopener noreferrer nofollow" target="_blank">
          {title}
        </a>
      </h3>
      {found?.description ? <p>{found.description}</p> : null}
      <p className="m">
        {[
          whereOf(article),
          article.happened_on ? longDay(article.happened_on) : null,
          article.byline
            ? `Linked by ${article.byline.name}${article.byline.outlet ? `, ${article.byline.outlet}` : ''}`
            : null,
        ]
          .filter(Boolean)
          .join(' — ')}
      </p>
      {children}
    </article>
  );
}
