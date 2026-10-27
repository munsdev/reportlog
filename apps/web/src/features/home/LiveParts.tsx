/**
 * The live parts a front page block can place (LIVE_MODULES): each one asks
 * for its own data and is drawn in the mock-up's markup, as the inside of a
 * zone. The figures, the map and the accounts say so (`liveGap`, plan.ts)
 * when they have nothing to show, and the page then leaves the zone out.
 */
import { LIVE_MODULE_NAMES, NOT_A_SAMPLE, SOCIAL_RULES, blockText } from '@reportlog/contracts';
import type { Block, LiveModule, PublicReport } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useSite } from '@/components/ui/site.tsx';
import { boardReportsQuery } from '../board/queries.ts';
import { useReportParts } from '../board/ReportAnswers.tsx';
import { MapSlot } from '../maps/MapSlot.tsx';
import { placedMapsQuery } from '../maps/queries.ts';
import { homeButtonsQuery, hrefOf } from './buttons.tsx';
import { SecHead, headingId } from './BlockViews.tsx';
import { moduleOf } from './plan.ts';

const NAMES = LIVE_MODULE_NAMES;

/** A live part's heading: the owner's, or the part's own name. */
const headingOf = (b: Block, own: string): string => blockText(b, 'heading') || own;

const filedAt = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
};

/** One published report as the mock-up's `.report` card; the whole card is the link. */
function ReportRow({ r }: { r: PublicReport }) {
  const { where, what } = useReportParts(r.logbook_slug, r.answers);
  return (
    <Link className="report scope-light" to="/board/$ref" params={{ ref: r.public_ref }}>
      <span className="top">
        <span className="quiet">{r.label}</span>
      </span>
      <span className="outcome">{what ?? where ?? r.logbook_title}</span>
      <span className="where">{what ? (where ?? r.logbook_title) : r.logbook_title}</span>
      <span className="meta">
        <span>{r.public_ref}</span>
        <span>{filedAt(r.received_at)}</span>
      </span>
    </Link>
  );
}

/** What people are reporting: the figure, the latest reports, and the ways on. */
function Figures({ block, num }: { block: Block; num: string | null }) {
  const board = useQuery(boardReportsQuery({}));
  const maps = useQuery(placedMapsQuery());
  const data = board.data;
  const total = data && 'total' in data ? data.total : undefined;
  const reports = data && 'reports' in data ? data.reports.slice(0, 4) : [];
  const map = maps.data?.maps[0];
  return (
    <div className="section">
      {/* The sentence that goes beside every number says these are reports
          people chose to file. The owner may word the line; empty is that. */}
      <SecHead num={num} id={headingId(block)} line={blockText(block, 'line') || NOT_A_SAMPLE}>
        {headingOf(block, 'What people are reporting')}
      </SecHead>
      {total !== undefined ? (
        <div className="figures">
          <span className="figure">
            {total.toLocaleString('en-US')}
            <small>published</small>
          </span>
        </div>
      ) : null}
      {reports.length ? (
        <div className="rlist">
          {reports.map((r) => (
            <ReportRow key={r.public_ref} r={r} />
          ))}
        </div>
      ) : null}
      <div className="btn-row" style={{ paddingTop: 22 }}>
        <Link className="btn" to="/board">
          All reports
        </Link>
        {map ? (
          <Link className="btn ghost" to="/board/maps">
            {map.title}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** A reference, checked: the mock-up's `.search` field. Enter goes. */
function Check({ block, num }: { block: Block; num: string | null }) {
  const navigate = useNavigate();
  const [ref, setRef] = useState('');
  return (
    <div className="section">
      <SecHead num={num} id={headingId(block)} line={blockText(block, 'line')}>
        {headingOf(block, NAMES.check)}
      </SecHead>
      <form
        role="search"
        aria-label="Check a report"
        className="search"
        style={{ maxWidth: 420 }}
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = ref.trim();
          if (trimmed) void navigate({ to: '/verify/$ref', params: { ref: trimmed } });
        }}
      >
        <input
          type="text"
          placeholder="RL-XXXX-XX"
          aria-label="Report reference"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="characters"
          value={ref}
          onChange={(e) => {
            setRef(e.target.value);
          }}
        />
        <button className="btn sm flat" type="submit">
          Check
        </button>
      </form>
    </div>
  );
}

function MapPart({ block, num }: { block: Block; num: string | null }) {
  return (
    <div className="section">
      <SecHead num={num} id={headingId(block)} line={blockText(block, 'line')}>
        {headingOf(block, NAMES.map)}
      </SecHead>
      <MapSlot slot="home" />
    </div>
  );
}

/** The accounts switched on, as buttons. */
function Social({ block, num }: { block: Block; num: string | null }) {
  const site = useSite().data;
  const links = site?.social_links ?? [];
  return (
    <div className="section">
      <SecHead num={num} id={headingId(block)} line={blockText(block, 'line')}>
        {headingOf(block, NAMES.social)}
      </SecHead>
      <div className="btn-row">
        {links.map((l) => (
          <a
            key={l.id}
            className="btn"
            href={l.url}
            rel="me noopener noreferrer"
            referrerPolicy="no-referrer"
            data-social={l.id}
          >
            {SOCIAL_RULES[l.id].name}
          </a>
        ))}
      </div>
    </div>
  );
}

/** The front page's buttons again, wherever the owner wants them. */
function Buttons({ block, num }: { block: Block; num: string | null }) {
  const buttons = useQuery(homeButtonsQuery).data?.buttons ?? [];
  const drawn = buttons.flatMap((b) => {
    const href = b.kind === 'social' ? null : hrefOf(b);
    return href ? [{ b, href }] : [];
  });
  return (
    <div className="section">
      <SecHead num={num} id={headingId(block)} line={blockText(block, 'line')}>
        {headingOf(block, NAMES.buttons)}
      </SecHead>
      <div className="btn-row">
        {drawn.map(({ b, href }, i) => (
          <a key={`${b.kind}:${b.ref}`} className={i === 0 ? 'btn go' : 'btn'} href={href}>
            {b.label}
          </a>
        ))}
      </div>
    </div>
  );
}

/** The software's own ways on, as plain cards: the older "More you can do". */
const MORE: readonly { to: string; tag: string; title: string; line: string }[] = [
  {
    to: '/board',
    tag: 'The record',
    title: 'Read the reports',
    line: 'Every report a moderator has approved.',
  },
  { to: '/journalists', tag: 'Alerts', title: 'For journalists', line: 'Alerts and desk access.' },
  {
    to: '/how',
    tag: 'Guide',
    title: 'How to use this site',
    line: 'What filing looks like, step by step.',
  },
];

function Links({ block, num }: { block: Block; num: string | null }) {
  return (
    <div className="section">
      <SecHead num={num} id={headingId(block)} line={blockText(block, 'line')}>
        {headingOf(block, NAMES.links)}
      </SecHead>
      <div className="cards">
        {MORE.map((m) => (
          <a key={m.to} className="card plain" href={m.to} style={{ textDecoration: 'none' }}>
            <span className="tag">{m.tag}</span>
            <h3>{m.title}</h3>
            <p>{m.line}</p>
          </a>
        ))}
      </div>
    </div>
  );
}

export function LiveView({ block, num }: { block: Block; num: string | null }) {
  const m = moduleOf(block) as LiveModule;
  switch (m) {
    case 'figures':
      return <Figures block={block} num={num} />;
    case 'check':
      return <Check block={block} num={num} />;
    case 'map':
      return <MapPart block={block} num={num} />;
    case 'social':
      return <Social block={block} num={num} />;
    case 'buttons':
      return <Buttons block={block} num={num} />;
    case 'links':
      return <Links block={block} num={num} />;
  }
}
