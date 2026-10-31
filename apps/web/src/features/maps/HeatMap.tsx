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
import { Note } from '@/mockup/Note.tsx';
import { Btn } from '@/mockup/Btn.tsx';
import { NotASample } from '../../components/ui/not-a-sample.tsx';
import type { OutlinePlane, Outlines } from './outlines.ts';
import { pathOf } from './outlines.ts';
import type { CountyOutlines } from './counties.ts';
import { loadCountyOutlines } from './counties.ts';
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
  chosen,
  onChosen,
}: {
  slug: string;
  start?: MapStart;
  /** False where the page's own heading already names the map. */
  showTitle?: boolean;
  /** The area a page narrows its list to (the board's `place`), kept in step with the map. */
  chosen?: string | null;
  onChosen?: (code: string | null) => void;
}) {
  const data = useQuery(mapQuery(slug));
  const outlines = useQuery(outlinesQuery());
  if (data.isPending) return <p role="status">Loading the map…</p>;
  if (data.isError) return <Note tone="serious">{data.error.message}</Note>;
  if (!data.data.published) return <Note>{data.data.reason}</Note>;
  return (
    <HeatMapView
      map={data.data}
      outlines={outlines.data ?? null}
      outlinesFailed={outlines.isError}
      showTitle={showTitle}
      {...(start ? { start } : {})}
      {...(chosen !== undefined ? { chosen } : {})}
      {...(onChosen ? { onChosen } : {})}
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
  chosen,
  onChosen,
}: {
  map: PublishedMap;
  outlines: Outlines | null;
  outlinesFailed?: boolean;
  start?: MapStart;
  showTitle?: boolean;
  chosen?: string | null;
  onChosen?: (code: string | null) => void;
}) {
  const firstPlane = map.planes.find((p) => p === start?.plane) ?? map.planes[0] ?? 'us';
  const [plane, setPlane] = useState<MapPlane>(firstPlane);
  const [view, setView] = useState<MapView>(
    map.views.find((v) => v === start?.view) ?? map.views[0] ?? 'volume',
  );
  // A link naming an area UNDER THE THRESHOLD selects nothing: a URL is the
  // one input a reader controls completely, and selecting such an area would
  // draw a readout for a place whose count was deliberately not sent.
  const [picked, setPicked] = useState<string | null>(() =>
    start?.area && Object.hasOwn(map.areas, start.area) && onPlane(firstPlane, start.area)
      ? start.area
      : null,
  );
  /* A PAGE ONLY HEARS OF AN AREA THAT HAS A COUNT: a state or a county the
     server sent. One under its threshold is picked here (its readout says
     "fewer than N") but a list is never narrowed to it: that list's length
     would be the count that was withheld. */
  const counted = (code: string | null): code is string =>
    code !== null && (Object.hasOwn(map.areas, code) || Object.hasOwn(map.counties, code));
  // With a page holding the choice (the board's address), what it holds is what is drawn,
  // unless the reader has just picked an area with no count, which only the map shows.
  const selected =
    onChosen && !(picked !== null && !counted(picked))
      ? chosen && counted(chosen) && onPlane(plane, chosen)
        ? chosen
        : null
      : picked;
  const setSelected = (code: string | null) => {
    setPicked(code);
    onChosen?.(counted(code) ? code : null);
  };
  const suppressed = useMemo(() => new Set(map.suppressed.areas), [map.suppressed.areas]);
  const k = map.threshold;

  /* COUNTIES, only those the server sent: a county reaches the map's county
     threshold or it is not in the payload at all (its reports are in its
     state). Their outlines are a separate download, asked for only when
     there is a county to draw. */
  const countyEntries = Object.entries(map.counties);
  const [countyOutlines, setCountyOutlines] = useState<CountyOutlines | null>(null);
  useEffect(() => {
    if (plane !== 'us' || !countyEntries.length || countyOutlines) return;
    let live = true;
    loadCountyOutlines()
      .then((c) => {
        if (live) setCountyOutlines(c);
      })
      // Without the outlines the counties are still in the list below.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [plane, countyEntries.length, countyOutlines]);
  const countyStep = binner(
    view,
    countyEntries.map(([, a]) => a),
  );

  const status = (code: string): Status => {
    const c = map.counties[code];
    if (c) return { kind: 'shown', a: c };
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
    // A county on its own scale: its counts are a state's small change, and
    // on the state scale every county would be the palest shade.
    return colourOf(view, (code in map.counties ? countyStep : step)(s.a));
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
    <figure className="panel" style={{ margin: 0 }} data-map-root={map.slug}>
      {showTitle ? (
        <div style={{ display: 'grid', gap: 4 }}>
          <h2>{map.title}</h2>
          {map.blurb ? <p className="muted">{map.blurb}</p> : null}
        </div>
      ) : null}

      {map.planes.length > 1 || map.views.length > 1 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
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
          overlay={
            plane === 'us' && countyOutlines
              ? countyEntries.flatMap(([code]) => {
                  const o = countyOutlines.areas[code];
                  return o ? [{ code, d: o.d, at: o.at }] : [];
                })
              : []
          }
        />
      ) : outlinesFailed ? (
        <Note tone="serious">
          The map’s outlines could not be loaded. The counts are listed below.
        </Note>
      ) : (
        <p role="status">Drawing the map…</p>
      )}

      {outlines && plane === 'us' ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <p className="m">
            Alaska, Hawaii and the territories. Three tiles show the main island; their counts are
            for the whole territory.
          </p>
          <ul
            className="tiles"
            style={{ listStyle: 'none', margin: 0, padding: 0 }}
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
                <li key={t.code} style={{ display: 'contents' }}>
                  <button
                    type="button"
                    aria-pressed={selected === t.code}
                    aria-label={name}
                    data-code={t.code}
                    onClick={() => {
                      setSelected(s.kind === 'shown' || s.kind === 'below' ? t.code : null);
                    }}
                    className="tile"
                    style={
                      selected === t.code
                        ? {
                            borderColor: 'var(--rl-border-main)',
                            boxShadow: '0 0 0 1px var(--rl-border-main)',
                          }
                        : undefined
                    }
                  >
                    <svg
                      viewBox={t.vb.join(' ')}
                      style={{ height: 48, width: '100%' }}
                      aria-hidden="true"
                    >
                      <path
                        d={t.d}
                        fill={fill(t.code)}
                        stroke="var(--rl-surface)"
                        strokeWidth={1.2}
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                    <b>{t.short}</b> <span>{count}</span>
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

      <figcaption className="m" style={{ display: 'grid', gap: 4 }}>
        <NotASample line={map.not_a_sample} />
        <span>
          {map.note} Counted {new Date(map.as_of).toLocaleString()}.
        </span>
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
    <div role="group" aria-label={label} style={{ display: 'grid', gap: 4 }}>
      <span className="m">{label}</span>
      <span className="seg">
        {options.map(([v, name]) => (
          <button
            key={v}
            type="button"
            // Pressed in the dark fill, unmistakably: a near-miss shade read as the wrong one.
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
  overlay = [],
}: {
  plane: OutlinePlane;
  title: string;
  fill: (code: string) => string;
  tip: (code: string) => string;
  selected: string | null;
  onSelect: (code: string | null) => void;
  /** Counties drawn over their states: only those shown on their own. */
  overlay?: { code: string; d: string; at: [number, number] | null }[];
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
    const at = selected
      ? (plane.areas[selected]?.at ?? overlay.find((o) => o.code === selected)?.at)
      : null;
    setZoom((z) => ({ k, cx: at ? at[0] : clampX(z.cx), cy: at ? at[1] : clampY(z.cy) }));
  };

  return (
    // Its own stacking context, so nothing inside can ever rise above the
    // site's header.
    <div style={{ position: 'relative', zIndex: 0, display: 'grid', gap: 8 }}>
      <svg
        ref={svgRef}
        viewBox={`${String(vx)} ${String(vy)} ${String(w)} ${String(h)}`}
        role="img"
        aria-label={title}
        style={{
          display: 'block',
          height: 'auto',
          width: '100%',
          borderRadius: 'var(--rl-radius-sm)',
          background: 'var(--rl-background)',
          // Dragging pans only once zoomed in. At full size a finger on the
          // map scrolls the page, as it would anywhere else.
          ...(zoom.k > 1 ? { cursor: 'grab', touchAction: 'none' } : { cursor: 'pointer' }),
        }}
      >
        {paths.map((p) =>
          p.code === selected ? null : (
            <path
              key={p.code}
              d={p.d}
              data-code={p.code}
              fill={fill(p.code)}
              fillRule="evenodd"
              stroke="var(--rl-surface)"
              strokeWidth={0.8}
              vectorEffect="non-scaling-stroke"
            >
              <title>{tip(p.code)}</title>
            </path>
          ),
        )}
        {/* COUNTIES OVER THEIR STATES, with a hairline so a county reads as
            a piece of the state it sits in. */}
        {overlay.map((o) => (
          <path
            key={o.code}
            d={o.d}
            data-code={o.code}
            {...(o.code === selected ? { 'data-selected': 'true' } : {})}
            fill={fill(o.code)}
            stroke={o.code === selected ? 'var(--rl-text)' : 'var(--rl-surface)'}
            strokeWidth={o.code === selected ? 2.5 : 0.4}
            vectorEffect="non-scaling-stroke"
          >
            <title>{tip(o.code)}</title>
          </path>
        ))}
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
              stroke="var(--rl-text)"
              strokeWidth={2.5}
              vectorEffect="non-scaling-stroke"
            >
              <title>{tip(p.code)}</title>
            </path>
          ))}
      </svg>
      <div className="acts">
        <Btn
          sm
          flat
          type="button"
          disabled={zoom.k >= MAX_ZOOM}
          onClick={() => {
            zoomTo(Math.min(MAX_ZOOM, zoom.k * 2));
          }}
        >
          Zoom in
        </Btn>
        <Btn
          sm
          flat
          type="button"
          disabled={zoom.k <= 1}
          onClick={() => {
            zoomTo(Math.max(1, zoom.k / 2));
          }}
        >
          Zoom out
        </Btn>
        <Btn
          sm
          flat
          type="button"
          look="ghost"
          disabled={zoom.k === 1}
          onClick={() => {
            setZoom({ k: 1, cx: x0 + W / 2, cy: y0 + H / 2 });
          }}
        >
          Whole map
        </Btn>
      </div>
    </div>
  );
}

function Legend({ view, k, unit }: { view: MapView; k: number; unit: string }) {
  const [lo, mid, hi] = ENDS[view];
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', maxWidth: 384 }} aria-hidden="true">
        {SCALES[view].map((c) => (
          <i
            key={c}
            style={{ background: c, flex: 1, height: 16, border: '1.5px solid var(--rl-border)' }}
          />
        ))}
      </div>
      <p
        className="legend"
        style={{ justifyContent: 'space-between', maxWidth: 384, paddingTop: 0 }}
      >
        <span>{lo}</span>
        <span>{mid}</span>
        <span>{hi}</span>
      </p>
      <p className="legend" style={{ paddingTop: 4 }}>
        <span>
          <i style={{ background: NO_DATA }} aria-hidden="true" />
          None counted
        </span>
        <span>
          <i style={{ background: BELOW }} aria-hidden="true" />
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
    <div style={{ display: 'grid', gap: 4 }} aria-live="polite">
      {!code || !status ? (
        <p className="m">
          {plane === 'us' ? 'Tap a state' : 'Tap a country'} to see what is behind its colour. Every
          area is also listed under the map.
        </p>
      ) : (
        <>
          <h3>{placeLabel(code)}</h3>
          {status.kind === 'shown' ? (
            <>
              <p>
                <b className="mono" style={{ fontSize: '1.6rem' }}>
                  {status.a.n}
                </b>{' '}
                {status.a.n === 1 ? map.unit.one : map.unit.many}
              </p>
              {status.a.assessed > 0 ? (
                <p className="m">
                  Of the {status.a.assessed} that answered “
                  {map.outcome_question ?? 'the outcome question'}”: {status.a.pos} positive,{' '}
                  {status.a.neu} neither, {status.a.neg} negative.
                </p>
              ) : null}
            </>
          ) : status.kind === 'below' ? (
            <p className="m">
              Fewer than {map.threshold} {map.unit.many}, so this area is not shaded and its number
              is not published. A single one in a thinly covered place can identify the person who
              filed it. The threshold is applied before the map is sent, not by this page.
            </p>
          ) : (
            <p className="m">None counted.</p>
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
    <details className="tech">
      <summary>Every area as a list ({shown.length + below.length})</summary>
      <table style={{ width: '100%', maxWidth: 448, marginTop: 8, borderCollapse: 'collapse' }}>
        <caption className="vh">{map.title}: counts by area</caption>
        <thead>
          <tr className="m" style={{ textAlign: 'left' }}>
            <th scope="col" style={{ padding: '4px 0', fontWeight: 400 }}>
              Area
            </th>
            <th scope="col" style={{ padding: '4px 0', fontWeight: 400, textAlign: 'right' }}>
              Count
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map(([code, a]) => (
            <tr key={code} style={{ borderTop: '1.5px solid var(--rl-border)' }}>
              <th scope="row" style={{ padding: '4px 0', textAlign: 'left', fontWeight: 400 }}>
                {placeLabel(code)}
              </th>
              <td className="mono" style={{ padding: '4px 0', textAlign: 'right' }}>
                {a.n}
              </td>
            </tr>
          ))}
          {below.map((code) => (
            <tr key={code} style={{ borderTop: '1.5px solid var(--rl-border)' }}>
              <th scope="row" style={{ padding: '4px 0', textAlign: 'left', fontWeight: 400 }}>
                {placeLabel(code)}
              </th>
              <td className="m" style={{ padding: '4px 0', textAlign: 'right' }}>
                fewer than {map.threshold}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {plane === 'us' && Object.keys(map.counties).length ? (
        <table style={{ width: '100%', maxWidth: 448, marginTop: 12, borderCollapse: 'collapse' }}>
          <caption style={{ textAlign: 'left', fontWeight: 700 }}>
            Counties with {map.county_threshold ?? map.threshold} or more, shown on their own
          </caption>
          <tbody>
            {Object.entries(map.counties)
              .sort(([a, x], [b, y]) => y.n - x.n || placeLabel(a).localeCompare(placeLabel(b)))
              .map(([code, a]) => (
                <tr key={code} style={{ borderTop: '1.5px solid var(--rl-border)' }}>
                  <th scope="row" style={{ padding: '4px 0', textAlign: 'left', fontWeight: 400 }}>
                    {placeLabel(code)}
                  </th>
                  <td className="mono" style={{ padding: '4px 0', textAlign: 'right' }}>
                    {a.n}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      ) : null}
      <p className="m" style={{ marginTop: 8 }}>
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
