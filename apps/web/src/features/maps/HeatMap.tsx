/**
 * One heat map: where published reports came from, as counts. Ported from
 * legacy public/js/map.js, drawn as SVG rather than through a map library.
 *
 * NOTHING INSIDE A MAP IS FOUND BY ID. Several can be on one page, and an id
 * lookup from the second map's code finds the first map's element and paints
 * the wrong one, silently. Every part is reached through React or through
 * `data-code` inside this map's own root, and nothing here carries an id at
 * all (a test renders two maps and checks both halves).
 *
 * NO TILE LAYER, EVER (see outlines.ts). The counts come from the server with
 * the threshold already applied: an area under it arrives as a bare code, and
 * this file can only say "fewer than k". It cannot undo the threshold because
 * it never has the number.
 *
 * WHAT THE READER CONTROLS: which plane and what the colour shows, among
 * those the operator offered, and which area they are looking at. Nothing
 * else. The threshold and the feeds are the operator's.
 */
import type { AreaCount, MapPlane, MapView, PublishedMap } from '@reportlog/contracts';
import { placeLabel } from '@reportlog/fields';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { cn } from '../../lib/utils.ts';
import type { OutlinePlane, Outlines } from './outlines.ts';
import { pathOf } from './outlines.ts';
import { mapQuery, outlinesQuery } from './queries.ts';
import { BELOW, ENDS, NO_DATA, SCALES, binner, colourOf } from './scale.ts';

export interface MapStart {
  plane?: string | undefined;
  view?: string | undefined;
  area?: string | undefined;
}

const PLANE_NAMES: Record<MapPlane, string> = { us: 'United States', world: 'World' };
const VIEW_NAMES: Record<MapView, string> = { volume: 'How many', outcome: 'Outcome' };

/** A state is on the US plane; a country is on the world plane. A prefix decides. */
const onPlane = (plane: MapPlane, code: string) => (plane === 'us') === code.startsWith('US-');

type Status = { kind: 'shown'; a: AreaCount } | { kind: 'below' } | { kind: 'none' };

/** A map by its short name, fetched and drawn. */
export function HeatMap({
  slug,
  start,
  showTitle = true,
}: {
  slug: string;
  start?: MapStart;
  /** False where the page's own heading already names the map. */
  showTitle?: boolean;
}) {
  const data = useQuery(mapQuery(slug));
  const outlines = useQuery(outlinesQuery());
  if (data.isPending) return <p role="status">Loading the map…</p>;
  if (data.isError) return <Alert tone="serious">{data.error.message}</Alert>;
  if (!data.data.published) return <Alert>{data.data.reason}</Alert>;
  return (
    <HeatMapView
      map={data.data}
      outlines={outlines.data ?? null}
      outlinesFailed={outlines.isError}
      showTitle={showTitle}
      {...(start ? { start } : {})}
    />
  );
}

/** The drawing, given the counts and the outlines. Exported for the unit tests. */
export function HeatMapView({
  map,
  outlines,
  outlinesFailed = false,
  start,
  showTitle = true,
}: {
  map: PublishedMap;
  outlines: Outlines | null;
  outlinesFailed?: boolean;
  start?: MapStart;
  showTitle?: boolean;
}) {
  const firstPlane = map.planes.find((p) => p === start?.plane) ?? map.planes[0] ?? 'us';
  const [plane, setPlane] = useState<MapPlane>(firstPlane);
  const [view, setView] = useState<MapView>(
    map.views.find((v) => v === start?.view) ?? map.views[0] ?? 'volume',
  );
  // A link naming an area UNDER THE THRESHOLD selects nothing: a URL is the
  // one input a reader controls completely, and selecting such an area would
  // draw a readout for a place whose count was deliberately not sent.
  const [selected, setSelected] = useState<string | null>(() =>
    start?.area && Object.hasOwn(map.areas, start.area) && onPlane(firstPlane, start.area)
      ? start.area
      : null,
  );
  const suppressed = useMemo(() => new Set(map.suppressed.areas), [map.suppressed.areas]);
  const k = map.threshold;

  const status = (code: string): Status => {
    const a = map.areas[code];
    if (a) return { kind: 'shown', a };
    return suppressed.has(code) ? { kind: 'below' } : { kind: 'none' };
  };

  const shownHere = Object.entries(map.areas).filter(([code]) => onPlane(plane, code));
  const step = binner(
    view,
    shownHere.map(([, a]) => a),
  );
  const fill = (code: string) => {
    const s = status(code);
    if (s.kind === 'below') return BELOW;
    if (s.kind === 'none') return NO_DATA;
    return colourOf(view, step(s.a));
  };

  const units = (n: number) => `${String(n)} ${n === 1 ? map.unit.one : map.unit.many}`;
  const detail = (code: string) => {
    const s = status(code);
    if (s.kind === 'shown') return units(s.a.n);
    if (s.kind === 'below') return `fewer than ${String(k)}, not shown`;
    return 'none counted';
  };
  const tip = (code: string) => `${placeLabel(code)}: ${detail(code)}`;

  const choosePlane = (p: MapPlane) => {
    setPlane(p);
    if (selected && !onPlane(p, selected)) setSelected(null);
  };

  return (
    <figure
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4"
      data-map-root={map.slug}
    >
      {showTitle ? (
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-xl font-bold">{map.title}</h2>
          {map.blurb ? <p className="max-w-prose text-ink-alt">{map.blurb}</p> : null}
        </div>
      ) : null}

      {map.planes.length > 1 || map.views.length > 1 ? (
        <div className="flex flex-wrap gap-4">
          {map.planes.length > 1 ? (
            <Switch
              label="Which map"
              options={map.planes.map((p) => [p, PLANE_NAMES[p]])}
              value={plane}
              onChange={choosePlane}
            />
          ) : null}
          {map.views.length > 1 ? (
            <Switch
              label="What the colour shows"
              options={map.views.map((v) => [v, VIEW_NAMES[v]])}
              value={view}
              onChange={setView}
            />
          ) : null}
        </div>
      ) : null}

      {outlines ? (
        <Stage
          key={plane}
          plane={outlines[plane]}
          title={`${map.title}: ${PLANE_NAMES[plane]}`}
          fill={fill}
          tip={tip}
          selected={selected}
          onSelect={setSelected}
        />
      ) : outlinesFailed ? (
        <Alert tone="serious">
          The map’s outlines could not be loaded. The counts are listed below.
        </Alert>
      ) : (
        <p role="status">Drawing the map…</p>
      )}

      {outlines && plane === 'us' ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">
            Alaska, Hawaii and the territories. Three tiles show the main island; their counts are
            for the whole territory.
          </p>
          <ul
            className="grid grid-cols-2 gap-2 sm:grid-cols-4"
            aria-label="Alaska, Hawaii and the territories"
          >
            {outlines.tiles.map((t) => {
              const s = status(t.code);
              const count =
                s.kind === 'shown' ? String(s.a.n) : s.kind === 'below' ? `<${String(k)}` : '—';
              // THE NAME STARTS WITH WHAT THE TILE SAYS ("Am. Samoa 12"), then
              // the sentence. Somebody using speech input says what they see,
              // and "American Samoa: …" is not what they see (WCAG 2.5.3). A
              // tile with nothing counted shows a dash, which is not a word.
              // The {' '} between the two spans is part of this: flex draws
              // no space, but without one the tile's text reads "Alaska3".
              const said = s.kind === 'none' ? t.short : `${t.short} ${count}`;
              const full = placeLabel(t.code);
              const name = `${said}${full === t.short ? '' : `, ${full}`}: ${detail(t.code)}`;
              return (
                <li key={t.code}>
                  <button
                    type="button"
                    aria-pressed={selected === t.code}
                    aria-label={name}
                    data-code={t.code}
                    onClick={() => {
                      setSelected(s.kind === 'shown' || s.kind === 'below' ? t.code : null);
                    }}
                    className={cn(
                      'flex w-full flex-col items-center gap-1 rounded-control border border-line bg-paper p-2 hover:border-ink',
                      selected === t.code && 'border-ink ring-1 ring-ink',
                    )}
                  >
                    <svg viewBox={t.vb.join(' ')} className="h-12 w-full" aria-hidden="true">
                      <path
                        d={t.d}
                        fill={fill(t.code)}
                        className="stroke-surface"
                        strokeWidth={1.2}
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                    <span className="text-xs font-semibold">{t.short}</span>{' '}
                    <span className="font-mono text-sm">{count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <Legend view={view} k={k} unit={map.unit.many} />

      <Readout
        map={map}
        code={selected}
        status={selected ? status(selected) : null}
        plane={plane}
      />

      <AreaList map={map} plane={plane} units={units} />

      <figcaption className="max-w-prose text-sm text-muted">
        {map.note} Counted {new Date(map.as_of).toLocaleString()}.
      </figcaption>
    </figure>
  );
}

/** A small set of mutually exclusive choices, as pressed buttons. */
function Switch<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [T, string][];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1">
      <span className="text-sm text-muted">{label}</span>
      <span className="flex gap-1">
        {options.map(([v, name]) => (
          <Button
            key={v}
            type="button"
            size="sm"
            variant="secondary"
            aria-pressed={v === value}
            // Pressed in ink, unmistakably: a near-miss shade read as the wrong one.
            className={cn(v === value && 'border-ink bg-ink text-surface hover:bg-ink')}
            onClick={() => {
              onChange(v);
            }}
          >
            {name}
          </Button>
        ))}
      </span>
    </div>
  );
}

const MAX_ZOOM = 8;

/**
 * The plane itself: one SVG path per area, and zooming by buttons.
 *
 * Pointer handling is attached to this map's own SVG element through a ref
 * and finds the area under the pointer with `closest('[data-code]')`, inside
 * this SVG and nowhere else. The keyboard's way to every area is the list
 * under the map, so the paths are not tab stops (two hundred countries
 * would be two hundred of them).
 */
function Stage({
  plane,
  title,
  fill,
  tip,
  selected,
  onSelect,
}: {
  plane: OutlinePlane;
  title: string;
  fill: (code: string) => string;
  tip: (code: string) => string;
  selected: string | null;
  onSelect: (code: string | null) => void;
}) {
  const [[x0, y0], [x1, y1]] = plane.frame;
  const W = x1 - x0;
  const H = y1 - y0;
  const [zoom, setZoom] = useState({ k: 1, cx: x0 + W / 2, cy: y0 + H / 2 });
  const svgRef = useRef<SVGSVGElement>(null);
  const paths = useMemo(
    () => Object.entries(plane.areas).map(([code, a]) => ({ code, d: pathOf(a.polys), at: a.at })),
    [plane],
  );

  const w = W / zoom.k;
  const h = H / zoom.k;
  const clampX = (cx: number) => Math.min(x1 - w / 2, Math.max(x0 + w / 2, cx));
  const clampY = (cy: number) => Math.min(y1 - h / 2, Math.max(y0 + h / 2, cy));
  const vx = clampX(zoom.cx) - w / 2;
  const vy = clampY(zoom.cy) - h / 2;

  // Kept in a ref so the listeners below, attached once, read the current
  // values without being re-attached on every render.
  const live = useRef({ zoom, onSelect, w });
  useLayoutEffect(() => {
    live.current = { zoom, onSelect, w };
  });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    let drag: { x: number; y: number; cx: number; cy: number; moved: boolean; id: number } | null =
      null;
    const down = (e: PointerEvent) => {
      drag = {
        x: e.clientX,
        y: e.clientY,
        cx: live.current.zoom.cx,
        cy: live.current.zoom.cy,
        moved: false,
        id: e.pointerId,
      };
    };
    const move = (e: PointerEvent) => {
      if (drag?.id !== e.pointerId || live.current.zoom.k === 1) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      const perPixel = live.current.w / (svg.clientWidth || 1);
      const from = drag;
      setZoom((z) => ({ ...z, cx: from.cx - dx * perPixel, cy: from.cy - dy * perPixel }));
    };
    const up = (e: PointerEvent) => {
      if (drag && !drag.moved && drag.id === e.pointerId) {
        const hit = e.target instanceof Element ? e.target.closest('[data-code]') : null;
        live.current.onSelect(hit && svg.contains(hit) ? hit.getAttribute('data-code') : null);
      }
      drag = null;
    };
    svg.addEventListener('pointerdown', down);
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    return () => {
      svg.removeEventListener('pointerdown', down);
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', up);
      svg.removeEventListener('pointercancel', up);
    };
  }, []);

  const zoomTo = (k: number) => {
    const at = selected ? plane.areas[selected]?.at : null;
    setZoom((z) => ({ k, cx: at ? at[0] : clampX(z.cx), cy: at ? at[1] : clampY(z.cy) }));
  };

  return (
    // Its own stacking context, so nothing inside can ever rise above the
    // site's header.
    <div className="relative z-0 flex flex-col gap-2">
      <svg
        ref={svgRef}
        viewBox={`${String(vx)} ${String(vy)} ${String(w)} ${String(h)}`}
        role="img"
        aria-label={title}
        className={cn(
          'block h-auto w-full rounded-control bg-paper',
          // Dragging pans only once zoomed in. At full size a finger on the
          // map scrolls the page, as it would anywhere else.
          zoom.k > 1 ? 'cursor-grab touch-none' : 'cursor-pointer',
        )}
      >
        {paths.map((p) =>
          p.code === selected ? null : (
            <path
              key={p.code}
              d={p.d}
              data-code={p.code}
              fill={fill(p.code)}
              fillRule="evenodd"
              className="stroke-surface"
              strokeWidth={0.8}
              vectorEffect="non-scaling-stroke"
            >
              <title>{tip(p.code)}</title>
            </path>
          ),
        )}
        {/* THE SELECTED OUTLINE IS DRAWN LAST, so its thicker stroke is on
            top: drawn in order, every neighbour would paint over half of it. */}
        {paths
          .filter((p) => p.code === selected)
          .map((p) => (
            <path
              key={p.code}
              d={p.d}
              data-code={p.code}
              data-selected="true"
              fill={fill(p.code)}
              fillRule="evenodd"
              className="stroke-ink"
              strokeWidth={2.5}
              vectorEffect="non-scaling-stroke"
            >
              <title>{tip(p.code)}</title>
            </path>
          ))}
      </svg>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={zoom.k >= MAX_ZOOM}
          onClick={() => {
            zoomTo(Math.min(MAX_ZOOM, zoom.k * 2));
          }}
        >
          Zoom in
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={zoom.k <= 1}
          onClick={() => {
            zoomTo(Math.max(1, zoom.k / 2));
          }}
        >
          Zoom out
        </Button>
        <Button
          type="button"
          size="sm"
          variant="quiet"
          disabled={zoom.k === 1}
          onClick={() => {
            setZoom({ k: 1, cx: x0 + W / 2, cy: y0 + H / 2 });
          }}
        >
          Whole map
        </Button>
      </div>
    </div>
  );
}

function Legend({ view, k, unit }: { view: MapView; k: number; unit: string }) {
  const [lo, mid, hi] = ENDS[view];
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3 text-sm">
      <div className="flex max-w-sm" aria-hidden="true">
        {SCALES[view].map((c) => (
          <i key={c} className="h-4 flex-1 border border-line" style={{ background: c }} />
        ))}
      </div>
      <p className="flex max-w-sm justify-between text-muted">
        <span>{lo}</span>
        <span>{mid}</span>
        <span>{hi}</span>
      </p>
      <p className="flex flex-wrap gap-x-5 gap-y-1 text-muted">
        <span className="flex items-center gap-2">
          <b
            className="block size-3.5 border border-line"
            style={{ background: NO_DATA }}
            aria-hidden="true"
          />
          None counted
        </span>
        <span className="flex items-center gap-2">
          <b
            className="block size-3.5 border border-line"
            style={{ background: BELOW }}
            aria-hidden="true"
          />
          Fewer than {k} {unit}: not shaded, and the number is not published
        </span>
      </p>
    </div>
  );
}

function Readout({
  map,
  code,
  status,
  plane,
}: {
  map: PublishedMap;
  code: string | null;
  status: Status | null;
  plane: MapPlane;
}) {
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-3" aria-live="polite">
      {!code || !status ? (
        <p className="text-sm text-muted">
          {plane === 'us' ? 'Tap a state' : 'Tap a country'} to see what is behind its colour. Every
          area is also listed under the map.
        </p>
      ) : (
        <>
          <h3 className="font-display text-lg font-bold">{placeLabel(code)}</h3>
          {status.kind === 'shown' ? (
            <>
              <p>
                <span className="font-mono text-2xl font-bold">{status.a.n}</span>{' '}
                {status.a.n === 1 ? map.unit.one : map.unit.many}
              </p>
              {status.a.assessed > 0 ? (
                <p className="text-sm">
                  Of the {status.a.assessed} that answered “
                  {map.outcome_question ?? 'the outcome question'}”: {status.a.pos} positive,{' '}
                  {status.a.neu} neither, {status.a.neg} negative.
                </p>
              ) : null}
            </>
          ) : status.kind === 'below' ? (
            <p className="max-w-prose text-sm">
              Fewer than {map.threshold} {map.unit.many}, so this area is not shaded and its number
              is not published. A single one in a thinly covered place can identify the person who
              filed it. The threshold is applied before the map is sent, not by this page.
            </p>
          ) : (
            <p className="text-sm">None counted.</p>
          )}
        </>
      )}
    </div>
  );
}

/** Every counted area on this plane, in words: the keyboard's and the screen reader's map. */
function AreaList({
  map,
  plane,
  units,
}: {
  map: PublishedMap;
  plane: MapPlane;
  units: (n: number) => string;
}) {
  const shown = Object.entries(map.areas)
    .filter(([code]) => onPlane(plane, code))
    .sort(([a, x], [b, y]) => y.n - x.n || placeLabel(a).localeCompare(placeLabel(b)));
  const below = map.suppressed.areas
    .filter((code) => onPlane(plane, code))
    .sort((a, b) => placeLabel(a).localeCompare(placeLabel(b)));
  const total = shown.reduce((sum, [, a]) => sum + a.n, 0);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-semibold">
        Every area as a list ({shown.length + below.length})
      </summary>
      <table className="mt-2 w-full max-w-md">
        <caption className="sr-only">{map.title}: counts by area</caption>
        <thead>
          <tr className="text-left text-muted">
            <th scope="col" className="py-1 font-normal">
              Area
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              Count
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map(([code, a]) => (
            <tr key={code} className="border-t border-line">
              <th scope="row" className="py-1 text-left font-normal">
                {placeLabel(code)}
              </th>
              <td className="py-1 text-right font-mono">{a.n}</td>
            </tr>
          ))}
          {below.map((code) => (
            <tr key={code} className="border-t border-line">
              <th scope="row" className="py-1 text-left font-normal">
                {placeLabel(code)}
              </th>
              <td className="py-1 text-right text-muted">fewer than {map.threshold}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-muted">
        {units(total)} in shaded areas
        {below.length
          ? map.suppressed.reports !== null && map.planes.length === 1
            ? `, and ${String(map.suppressed.reports)} more in ${String(map.suppressed.areas.length)} areas under the threshold.`
            : `, and fewer than ${String(map.threshold)} in each area under the threshold.`
          : '.'}
      </p>
    </details>
  );
}
