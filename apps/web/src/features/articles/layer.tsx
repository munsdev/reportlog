/**
 * The heat maps' coverage layer (decision 84): the same drawing, fed with
 * listed, approved articles counted by place instead of reports.
 *
 * Built as a map payload of its own rather than added into the reports'
 * counts: an article is not a report, and mixing the two would make every
 * number on the map mean neither. No threshold, because an article names no
 * reporter (the server's counts carry none, so every area arrives with its
 * number). National and international articles have no area to shade, so
 * they are said in a line under the map.
 */
import type { CoverageCounts, PublishedMap } from '@reportlog/contracts';

const area = (n: number) => ({ n, assessed: 0, pos: 0, neg: 0, neu: 0 });

export function coverageAsMap(base: PublishedMap, c: CoverageCounts): PublishedMap {
  const counties = Object.entries(c.counties);
  return {
    ...base,
    title: `${base.title}: news coverage`,
    note: 'Articles journalists linked to events, each approved by a moderator. They are not reports, and their number is not a measure of how often anything happened.',
    threshold: 1,
    unit: { one: 'article', many: 'articles' },
    views: ['volume'],
    outcome_question: null,
    filter_key: null,
    areas: Object.fromEntries(Object.entries(c.areas).map(([code, n]) => [code, area(n)])),
    suppressed: { areas: [], reports: null },
    county_threshold: counties.length > 0 ? 1 : null,
    counties: Object.fromEntries(counties.map(([code, n]) => [code, area(n)])),
  };
}

export type Layer = 'reports' | 'coverage';

/** Which layer the map shows: reports, or news coverage. Pressed buttons, like the map's own. */
export function LayerSwitch({ value, onChange }: { value: Layer; onChange: (l: Layer) => void }) {
  return (
    <div role="group" aria-label="Show on the map" className="grid gap-1">
      <span className="m">Show on the map</span>
      <span className="seg">
        {(
          [
            ['reports', 'Reports'],
            ['coverage', 'News coverage'],
          ] as const
        ).map(([v, name]) => (
          <button
            key={v}
            type="button"
            aria-pressed={v === value}
            onClick={() => {
              onChange(v);
            }}
          >
            {name}
          </button>
        ))}
      </span>
    </div>
  );
}

/** What the map cannot shade: articles about the whole country, or about abroad. */
export function Unmapped({ counts }: { counts: CoverageCounts }) {
  const parts = [
    counts.national > 0
      ? `${String(counts.national)} national ${counts.national === 1 ? 'article' : 'articles'}`
      : null,
    counts.international > 0
      ? `${String(counts.international)} international ${counts.international === 1 ? 'article' : 'articles'}`
      : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <p className="m">Not on the map: {parts.join(' and ')}.</p>;
}
