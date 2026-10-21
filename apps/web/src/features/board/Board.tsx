/**
 * The public board: published reports, newest first.
 *
 * NOTHING IS FILTERABLE UNLESS AN OPERATOR SAID SO. The form offers which
 * logbook, a search over the words, and, once a logbook is chosen, only the
 * questions its maker marked as filters. There is no built-in date or place
 * filter: when and where are questions a logbook asks or does not.
 *
 * NOTHING CHANGES UNDERNEATH THE READER. The filters apply when "Show
 * reports" is pressed, never as somebody types or picks, and they live in the
 * address so a filtered board can be shared.
 */
import type { BoardLogbook, FormQuestion, PublicReport } from '@reportlog/contracts';
import { BOARD_CSV_PATH } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardContent } from '../../components/ui/card.tsx';
import { CopyText } from '../../components/ui/copy-text.tsx';
import { Field } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Page } from '../../components/ui/page.tsx';
import { Select } from '../../components/ui/select.tsx';
import { MapSlot } from '../maps/MapSlot.tsx';
import { CountsOnlyPanel } from './Activity.tsx';
import { BoardMapsButton } from './Maps.tsx';
import { boardMetaQuery, boardReportsQuery } from './queries.ts';
import type { BoardSearch } from './queries.ts';
import { ReportAnswers } from './ReportAnswers.tsx';

const date = (iso: string) => new Date(iso).toLocaleDateString();

export function BoardPage({ search }: { search: BoardSearch }) {
  const meta = useQuery(boardMetaQuery);
  return (
    <Page
      title="Report board"
      lede="First-hand accounts a moderator has read and approved for publication, with their reporters’ permission. Published means judged publishable, which is a weaker claim than true."
      actions={
        <>
          <Button asChild variant="secondary">
            <Link to="/board/numbers">By the numbers</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/board/activity">Arrivals and declines</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/board/press">Press pack</Link>
          </Button>
          <BoardMapsButton />
        </>
      }
    >
      <CopyText slot="board_intro" />
      {meta.isPending ? <p role="status">Loading the board…</p> : null}
      {meta.isError ? <Alert tone="serious">{meta.error.message}</Alert> : null}
      {meta.data && !meta.data.published ? <Alert>{meta.data.reason}</Alert> : null}
      {meta.data?.published ? (
        <>
          <MapSlot slot="board_reports" />
          <Filters
            // A new address means new starting values for the form.
            key={JSON.stringify(search)}
            logbooks={meta.data.logbooks}
            search={search}
          />
          <CountsOnlyOr search={search} logbooks={meta.data.logbooks}>
            <Results
              search={search}
              logbooks={meta.data.logbooks}
              downloads={meta.data.downloads}
            />
          </CountsOnlyOr>
        </>
      ) : null}
    </Page>
  );
}

/**
 * A logbook published as counts only shows its counts in place of entries
 * (Plan E). With no logbook chosen, the board says which ones are counted
 * rather than listed, so their absence from the list is not a mystery.
 */
function CountsOnlyOr({
  search,
  logbooks,
  children,
}: {
  search: BoardSearch;
  logbooks: BoardLogbook[];
  children: ReactNode;
}) {
  const chosen = logbooks.find((l) => l.slug === search.logbook);
  if (chosen?.counts_only) return <CountsOnlyPanel slug={chosen.slug} title={chosen.title} />;
  const counted = logbooks.filter((l) => l.counts_only);
  return (
    <>
      {!chosen && counted.length ? (
        <p className="text-sm">
          {`Published as counts only, not listed here: ${counted.map((l) => l.title).join(', ')}. Choose one above to see its counts.`}
        </p>
      ) : null}
      {children}
    </>
  );
}

function Filters({ logbooks, search }: { logbooks: BoardLogbook[]; search: BoardSearch }) {
  const navigate = useNavigate();
  const [q, setQ] = useState(search.q ?? '');
  const [logbook, setLogbook] = useState(search.logbook ?? '');
  const [answers, setAnswers] = useState<Record<string, string>>(search.f ?? {});
  const chosen = logbooks.find((l) => l.slug === logbook);

  return (
    <form
      aria-label="Narrow the board"
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = Object.fromEntries(
          Object.entries(answers).filter(([k, v]) => v && chosen?.filters.some((x) => x.key === k)),
        );
        void navigate({
          to: '/board',
          search: {
            ...(q.trim() ? { q: q.trim() } : {}),
            ...(logbook ? { logbook } : {}),
            ...(Object.keys(f).length ? { f } : {}),
          },
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <Label>Search the words</Label>
          <Input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
            }}
          />
        </Field>
        <Field>
          <Label>Logbook</Label>
          <Select
            value={logbook}
            onChange={(e) => {
              setLogbook(e.target.value);
              setAnswers({});
            }}
          >
            <option value="">Every logbook</option>
            {logbooks.map((l) => (
              <option key={l.slug} value={l.slug}>
                {l.title}
              </option>
            ))}
          </Select>
        </Field>
        {chosen?.filters.map((question) => (
          <FilterControl
            key={question.key}
            question={question}
            value={answers[question.key] ?? ''}
            onChange={(v) => {
              setAnswers((a) => ({ ...a, [question.key]: v }));
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit">Show reports</Button>
        <Button
          type="button"
          variant="quiet"
          onClick={() => {
            void navigate({ to: '/board', search: {} });
          }}
        >
          Clear
        </Button>
      </div>
    </form>
  );
}

/** One operator-chosen filter. Choices offer only the logbook's own wording. */
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
  return (
    <Field>
      <Label>{question.label}</Label>
      {options ? (
        <Select
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        >
          <option value="">Any answer</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          type={question.kind === 'date' ? 'date' : question.kind === 'number' ? 'number' : 'text'}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      )}
    </Field>
  );
}

function optionsOf(q: FormQuestion): { value: string; label: string }[] | null {
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

function Results({
  search,
  logbooks,
  downloads,
}: {
  search: BoardSearch;
  logbooks: BoardLogbook[];
  /** The distribution switch: without it the server refuses the spreadsheet. */
  downloads: boolean;
}) {
  const navigate = useNavigate();
  const query = useQuery(boardReportsQuery(search));
  if (query.isPending) return <p role="status">Reading the reports…</p>;
  if (query.isError) return <Alert tone="serious">{query.error.message}</Alert>;
  if (!query.data.published) return <Alert>{query.data.reason}</Alert>;
  // A thin place: the server sent no reports and no count, so there is
  // nothing to draw but its sentence.
  if ('withheld' in query.data) return <Alert>{query.data.reason}</Alert>;
  const { reports, total, page, page_size: size } = query.data;
  const narrowed =
    Boolean(search.q) || Boolean(search.logbook) || Object.keys(search.f ?? {}).length > 0;
  const csv = new URLSearchParams();
  if (search.q) csv.set('q', search.q);
  if (search.logbook) csv.set('logbook', search.logbook);
  for (const [k, v] of Object.entries(search.f ?? {})) csv.set(`a.${k}`, v);
  const titles = new Map(logbooks.map((l) => [l.slug, l.title]));

  return (
    <section aria-label="Reports" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p role="status">
          {total === 0
            ? narrowed
              ? 'No published report matches that.'
              : 'Nothing has been published yet.'
            : `${String(total)} published report${total === 1 ? '' : 's'}${narrowed ? ' match' : ''}${
                total > size ? `, page ${String(page)} of ${String(Math.ceil(total / size))}` : ''
              }.`}
        </p>
        {total > 0 && downloads ? (
          <a className="text-sm underline" href={`${BOARD_CSV_PATH}?${csv.toString()}`} download>
            Download these as a spreadsheet (CSV)
          </a>
        ) : null}
      </div>
      <ul className="flex flex-col gap-4">
        {reports.map((r) => (
          <li key={r.public_ref}>
            <ReportCard r={r} logbookTitle={titles.get(r.logbook_slug) ?? r.logbook_title} />
          </li>
        ))}
      </ul>
      {total > size ? (
        <nav aria-label="Pages" className="flex gap-2">
          <Button
            variant="secondary"
            disabled={page <= 1}
            onClick={() => {
              void navigate({ to: '/board', search: { ...search, page: page - 1 } });
            }}
          >
            Newer
          </Button>
          <Button
            variant="secondary"
            disabled={page * size >= total}
            onClick={() => {
              void navigate({ to: '/board', search: { ...search, page: page + 1 } });
            }}
          >
            Older
          </Button>
        </nav>
      ) : null}
    </section>
  );
}

/** Where it came from, in the operator's words, on every entry (Plan E). */
export function OriginLabel({ r }: { r: Pick<PublicReport, 'origin' | 'label'> }) {
  return (
    <p className="self-start rounded-card border border-line px-2 text-sm font-semibold">
      {/* The operator's words for each origin (site copy), sent with the report. */}
      {r.origin === 'organization' ? (
        <span data-copy="origin_organization">{r.label}</span>
      ) : (
        <span data-copy="origin_open_form">{r.label}</span>
      )}
    </p>
  );
}

function ReportCard({ r, logbookTitle }: { r: PublicReport; logbookTitle: string }) {
  return (
    <Card>
      <CardContent>
        <p className="text-sm text-ink-alt">
          <span className="font-mono">{r.public_ref}</span> · {logbookTitle} · {date(r.received_at)}
          {r.corrected ? ' · corrected by its reporter' : ''}
          {r.third_party ? ` · collected by ${r.third_party.filed_via}` : ''}
        </p>
        <OriginLabel r={r} />
        <ReportAnswers slug={r.logbook_slug} answers={r.answers} only={4} />
        {r.editorial_note ? (
          <p className="text-sm font-semibold">The archive has a note on this report.</p>
        ) : null}
        <Link
          to="/board/$ref"
          params={{ ref: r.public_ref }}
          className="self-start underline"
          // The visible words first, then which report: an accessible name
          // must start with what is on screen (WCAG 2.5.3).
          aria-label={`Read in full: ${r.public_ref}`}
        >
          Read in full
        </Link>
      </CardContent>
    </Card>
  );
}
