/**
 * The public board: published reports, newest first (public.md §03; the
 * mock-up's board.html).
 *
 * NOTHING IS FILTERABLE UNLESS AN OPERATOR SAID SO. The filter row offers
 * which logbook and, once a logbook is chosen, only the questions its maker
 * marked as filters. There is no built-in date or place filter: when and where
 * are questions a logbook asks or does not.
 *
 * NOTHING CHANGES UNDERNEATH THE READER. Search applies on Enter or with its
 * own Search button, never as somebody types (decision 59). A choice in a
 * select applies when the reader makes it. Both live in the address, so a
 * narrowed board can be shared. The count line above the list says what it
 * holds and is announced politely when it changes.
 *
 * SORT is newest first, fixed, as the API serves it: there is no sort button.
 */
import type { BoardLogbook, FormQuestion, PublicReport } from '@reportlog/contracts';
import { BOARD_CSV_PATH } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { CopyText } from '../../components/ui/copy-text.tsx';
import { Empty } from '../../mockup/Empty.tsx';
import { Note } from '../../mockup/Note.tsx';
import { Pager } from '@/mockup/Pager.tsx';
import { MapSlot } from '../maps/MapSlot.tsx';
import { useMainAction } from '../nav/Menu.tsx';
import { CountsOnlyPanel } from './Activity.tsx';
import { BoardFrame } from './BoardFrame.tsx';
import { boardMetaQuery, boardReportsQuery } from './queries.ts';
import type { BoardSearch } from './queries.ts';
import { useReportParts } from './ReportAnswers.tsx';

const filed = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The board's address with something changed, and the page back to the first. */
function searchWith(search: BoardSearch, change: Partial<BoardSearch>): BoardSearch {
  const next: BoardSearch = { ...search, ...change };
  delete next.page;
  if (!next.q) delete next.q;
  if (!next.logbook) delete next.logbook;
  if (!next.f || !Object.keys(next.f).length) delete next.f;
  return next;
}

function csvHref(search: BoardSearch): string {
  const csv = new URLSearchParams();
  if (search.q) csv.set('q', search.q);
  if (search.logbook) csv.set('logbook', search.logbook);
  for (const [k, v] of Object.entries(search.f ?? {})) csv.set(`a.${k}`, v);
  return `${BOARD_CSV_PATH}?${csv.toString()}`;
}

export function BoardPage({ search }: { search: BoardSearch }) {
  const meta = useQuery(boardMetaQuery);
  const reports = useQuery(boardReportsQuery(search));
  const chosen = meta.data?.published
    ? meta.data.logbooks.find((l) => l.slug === search.logbook)
    : undefined;
  // The spreadsheet: only with the distribution switch on, only when there
  // is something in it, and never for a counts-only logbook.
  const csv =
    meta.data?.published &&
    meta.data.downloads &&
    !chosen?.counts_only &&
    reports.data?.published &&
    'total' in reports.data &&
    reports.data.total > 0
      ? csvHref(search)
      : null;
  return (
    <BoardFrame title="Reports" list>
      <CopyText slot="board_intro" />
      {meta.isPending ? <p role="status">Reading the reports…</p> : null}
      {meta.isError ? (
        <Note warn>
          <span role="alert">
            <b>The board could not be loaded.</b> {meta.error.message}
          </span>
        </Note>
      ) : null}
      {meta.data && !meta.data.published ? <PublishingPaused /> : null}
      {meta.data?.published ? (
        <>
          <MapSlot slot="board_reports" />
          <Narrowing
            // A new address means new starting values for the controls.
            key={JSON.stringify(search)}
            logbooks={meta.data.logbooks}
            search={search}
          />
          {chosen?.counts_only ? (
            // Counted, never listed: its counts in place of the list.
            <CountsOnlyPanel slug={chosen.slug} title={chosen.title} />
          ) : (
            <Results search={search} logbooks={meta.data.logbooks} />
          )}
          {csv ? (
            <div className="btn-row" style={{ paddingBlock: 12 }}>
              <a className="btn sm flat" href={csv} download>
                Download these (CSV)
              </a>
            </div>
          ) : null}
          {chosen ? null : <CountedNotShown logbooks={meta.data.logbooks} />}
        </>
      ) : null}
    </BoardFrame>
  );
}

/** Publication switched off by the operator: said in place of the list. */
function PublishingPaused() {
  return (
    <div style={{ paddingBlock: 18 }}>
      <Note>
        <span>
          <b>Publishing is paused.</b> Reports still arrive and are being read.
        </span>
      </Note>
    </div>
  );
}

/**
 * With no logbook chosen, which logbooks are counted rather than listed, so
 * their absence from the list is not a mystery.
 */
function CountedNotShown({ logbooks }: { logbooks: BoardLogbook[] }) {
  const counted = logbooks.filter((l) => l.counts_only);
  if (!counted.length) return null;
  return (
    <p className="muted" style={{ paddingBlock: 12, fontSize: '.9rem' }}>
      {`Counted, not shown: ${counted.map((l) => l.title).join(', ')}. Choose one in the logbook list to see its counts.`}
    </p>
  );
}

// ── search, filter, and the filters that are on ─────────────────────────

/** Every filter that is on, in words, with what removing it leaves. */
function activeFilters(
  search: BoardSearch,
  logbooks: BoardLogbook[],
): { key: string; words: string; without: BoardSearch }[] {
  const out: { key: string; words: string; without: BoardSearch }[] = [];
  const lb = logbooks.find((l) => l.slug === search.logbook);
  if (search.logbook) {
    out.push({
      key: 'logbook',
      words: `Logbook: ${lb?.title ?? search.logbook}`,
      // An answer filter belongs to its logbook, so it goes with it.
      without: searchWith(search, { logbook: undefined, f: undefined }),
    });
  }
  for (const [k, v] of Object.entries(search.f ?? {})) {
    const q = lb?.filters.find((x) => x.key === k);
    const label = optionsOf(q)?.find((o) => o.value === v)?.label ?? v;
    const rest = Object.fromEntries(Object.entries(search.f ?? {}).filter(([x]) => x !== k));
    out.push({
      key: `f.${k}`,
      words: `${q?.label ?? k}: ${label}`,
      without: searchWith(search, { f: rest }),
    });
  }
  return out;
}

/**
 * The mock-up's filter row (`.filters`): the search field with its own
 * button, then a select for the logbook and, once one is chosen, one for each
 * question its maker allowed. A question of free kind (a date, a number) is
 * a small field that applies on Enter.
 */
function Narrowing({ logbooks, search }: { logbooks: BoardLogbook[]; search: BoardSearch }) {
  const navigate = useNavigate();
  const [q, setQ] = useState(search.q ?? '');
  const on = activeFilters(search, logbooks);
  const chosen = logbooks.find((l) => l.slug === search.logbook);
  const go = (next: BoardSearch) => {
    void navigate({ to: '/board', search: next });
  };
  const setAnswer = (key: string, value: string) => {
    go(searchWith(search, { f: { ...search.f, [key]: value } }));
  };
  return (
    <>
      <form
        className="filters"
        role="search"
        aria-label="Search reports"
        onSubmit={(e) => {
          e.preventDefault();
          go(searchWith(search, { q: q.trim() || undefined }));
        }}
      >
        {/* Applies on Enter or with its own button, never per keystroke. */}
        <div className="search">
          <label className="vh" htmlFor="q">
            Search reports
          </label>
          <input
            id="q"
            type="search"
            value={q}
            placeholder="Search, then press Enter"
            enterKeyHint="search"
            onChange={(e) => {
              setQ(e.target.value);
            }}
          />
          <button className="btn sm flat" type="submit">
            Search
          </button>
        </div>
        {logbooks.length > 1 || chosen ? (
          <label className="select">
            <span className="vh">Logbook</span>
            <select
              value={search.logbook ?? ''}
              onChange={(e) => {
                go(searchWith(search, { logbook: e.target.value || undefined, f: undefined }));
              }}
            >
              <option value="">Every logbook</option>
              {logbooks.map((l) => (
                <option key={l.slug} value={l.slug}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {chosen?.filters.map((question) => (
          <FilterControl
            key={question.key}
            question={question}
            value={search.f?.[question.key] ?? ''}
            onChange={(v) => {
              setAnswer(question.key, v);
            }}
          />
        ))}
      </form>
      {on.length ? (
        <p className="muted" style={{ fontSize: '.9rem' }} aria-label="Filters on">
          {on.map((f) => (
            <button
              key={f.key}
              type="button"
              className="chip"
              style={{ marginRight: 6, cursor: 'pointer' }}
              aria-label={`Remove the filter ${f.words}`}
              onClick={() => {
                go(f.without);
              }}
            >
              {f.words} <span aria-hidden="true">✕</span>
            </button>
          ))}
          <button
            type="button"
            className="btn sm flat ghost"
            onClick={() => {
              go(searchWith({}, { q: search.q }));
            }}
          >
            Clear all
          </button>
        </p>
      ) : null}
    </>
  );
}

/**
 * One operator-chosen filter, as the mock-up's `.select`: a short list or a
 * long one is a select; a question without options is a small field that
 * applies on Enter. Only the logbook's own wording.
 */
function FilterControl({
  question,
  value,
  onChange,
}: {
  question: FormQuestion;
  value: string;
  onChange: (v: string) => void;
}) {
  const options = optionsOf(question);
  const [draft, setDraft] = useState(value);
  if (!options) {
    return (
      <label className="select">
        <span className="vh">{question.label}</span>
        <input
          type={question.kind === 'date' ? 'date' : question.kind === 'number' ? 'number' : 'text'}
          value={draft}
          placeholder={question.label}
          style={{ border: 0, background: 'transparent', font: 'inherit', color: 'inherit' }}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onBlur={() => {
            if (draft !== value) onChange(draft);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onChange(draft);
            }
          }}
        />
      </label>
    );
  }
  return (
    <label className="select">
      <span className="vh">{question.label}</span>
      <select
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      >
        <option value="">{`Any: ${question.label}`}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function optionsOf(q: FormQuestion | undefined): { value: string; label: string }[] | null {
  if (!q) return null;
  if (q.kind === 'choice_one' || q.kind === 'choice_many') {
    const list = Array.isArray(q.settings.options) ? (q.settings.options as unknown[]) : [];
    return list
      .filter((o): o is string => typeof o === 'string')
      .map((o) => ({ value: o, label: o }));
  }
  // Sealed as true or false, so that is what the filter sends.
  if (q.kind === 'yes_no' || q.kind === 'evidence_declaration') {
    return [
      { value: 'true', label: 'Yes' },
      { value: 'false', label: 'No' },
    ];
  }
  if (q.kind === 'location' && q.places) {
    return [...q.places.subdivisions, ...q.places.countries].map((p) => ({
      value: p.code,
      label: p.name,
    }));
  }
  return null;
}

// ── the list ────────────────────────────────────────────────────────────

function Results({ search, logbooks }: { search: BoardSearch; logbooks: BoardLogbook[] }) {
  const navigate = useNavigate();
  const main = useMainAction();
  const query = useQuery(boardReportsQuery(search));
  if (query.isPending) return <p role="status">Reading the reports…</p>;
  if (query.isError) {
    return (
      <Note warn>
        <span role="alert">
          <b>The reports could not be loaded.</b> {query.error.message}
        </span>
      </Note>
    );
  }
  if (!query.data.published) return <PublishingPaused />;
  // A thin place: the server sent no reports and no count, so there is
  // nothing to draw but its sentence.
  if ('withheld' in query.data)
    return (
      <Note>
        <span>{query.data.reason}</span>
      </Note>
    );
  const { reports, total, page, page_size: size } = query.data;
  const filters = activeFilters(search, logbooks).length;
  const narrowed = Boolean(search.q) || filters > 0;
  const pages = Math.max(1, Math.ceil(total / size));
  const titles = new Map(logbooks.map((l) => [l.slug, l.title]));
  const count = [
    `${String(total)} report${total === 1 ? '' : 's'}`,
    filters ? `${String(filters)} filter${filters === 1 ? '' : 's'}` : null,
    search.q ? `“${search.q}”` : null,
    pages > 1 ? `page ${String(page)} of ${String(pages)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section aria-label="Reports">
      <p className="muted" role="status" style={{ fontSize: '.9rem', paddingTop: 6 }}>
        {count}
      </p>
      {total === 0 ? (
        narrowed ? (
          <Empty title="No published report matches that">
            Try fewer words, or fewer filters.
            <br />
            <button
              type="button"
              className="btn go"
              style={{ marginTop: 10 }}
              onClick={() => {
                void navigate({ to: '/board', search: {} });
              }}
            >
              Clear all
            </button>
          </Empty>
        ) : (
          <Empty title="No published reports yet">
            Reports appear here once a moderator has approved them.
            <br />
            {main.href === '/submit' ? (
              <Link className="btn go" style={{ marginTop: 10 }} to="/submit">
                {main.label}
              </Link>
            ) : (
              <a className="btn go" style={{ marginTop: 10 }} href={main.href}>
                {main.label}
              </a>
            )}
          </Empty>
        )
      ) : (
        <div className="rlist">
          {reports.map((r) => (
            <ReportCard
              key={r.public_ref}
              r={r}
              logbookTitle={titles.get(r.logbook_slug) ?? r.logbook_title}
            />
          ))}
        </div>
      )}
      <Pager
        label="Pages of reports"
        page={page}
        pages={pages}
        link={(p, children, ariaLabel) => (
          <Link
            to="/board"
            search={{ ...search, ...(p > 1 ? { page: p } : { page: undefined }) }}
            {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
            onClick={() => {
              if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
            }}
          >
            {children}
          </Link>
        )}
      />
    </section>
  );
}

/**
 * Where it came from, in the operator's words (Plan E): "Unverified public
 * report", or the organization's label. The words are the operator's (site
 * copy), sent with the report. The mock-up's quiet small-caps line.
 */
export function OriginLabel({ r }: { r: Pick<PublicReport, 'origin' | 'label'> }) {
  return r.origin === 'organization' ? (
    <span className="quiet" data-copy="origin_organization">
      {r.label}
    </span>
  ) : (
    <span className="quiet" data-copy="origin_open_form">
      {r.label}
    </span>
  );
}

/**
 * A published report on the board (mock-up .report): the whole card is the
 * link. What it was, where, and the reference with the time. No "Confirmed"
 * chip and no count of accounts: the public report carries neither
 * (PublicReport), and severity is staff-only (decision 16). Nothing the
 * reporter typed appears on a card.
 */
function ReportCard({ r, logbookTitle }: { r: PublicReport; logbookTitle: string }) {
  const { where, what } = useReportParts(r.logbook_slug, r.answers);
  return (
    <Link to="/board/$ref" params={{ ref: r.public_ref }} className="report">
      <span className="top">
        <ReportTags r={r} />
      </span>
      <span className="outcome">{what ?? where ?? logbookTitle}</span>
      <span className="where">{what ? (where ?? logbookTitle) : logbookTitle}</span>
      <span className="meta">
        <span>{r.public_ref}</span>
        <span>{filed(r.received_at)}</span>
      </span>
    </Link>
  );
}

/** The facts public data supports, as the mock-up's quiet line and chips. */
export function ReportTags({ r }: { r: PublicReport }): ReactNode {
  return (
    <>
      <OriginLabel r={r} />
      {r.third_party ? <span className="chip">Via {r.third_party.filed_via}</span> : null}
      {r.corrected ? <span className="chip">Corrected</span> : null}
      {r.editorial_note ? <span className="chip">Archive note</span> : null}
    </>
  );
}
