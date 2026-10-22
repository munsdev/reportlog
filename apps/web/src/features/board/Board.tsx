/**
 * The public board: published reports, newest first (public.md §03).
 *
 * NOTHING IS FILTERABLE UNLESS AN OPERATOR SAID SO. "Filter" offers which
 * logbook and, once a logbook is chosen, only the questions its maker marked
 * as filters. There is no built-in date or place filter: when and where are
 * questions a logbook asks or does not.
 *
 * NOTHING CHANGES UNDERNEATH THE READER. Search applies on Enter or with its
 * own Search button, never as somebody types (decision 59); filters apply
 * when "Show reports" is pressed. Both live in the address, so a narrowed
 * board can be shared. The count line above the list says what it holds and
 * is announced politely when it changes.
 *
 * SORT is newest first, fixed, as the API serves it: there is no sort button.
 */
import type { BoardLogbook, FormQuestion, PublicReport } from '@reportlog/contracts';
import { BOARD_CSV_PATH } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card } from '../../components/ui/card.tsx';
import { Chip, chipVariants } from '../../components/ui/chip.tsx';
import { CopyText } from '../../components/ui/copy-text.tsx';
import { Count } from '../../components/ui/count.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx';
import { Empty } from '../../components/ui/empty.tsx';
import { Field } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Pagination } from '../../components/ui/pagination.tsx';
import { RadioGroup, RadioOption } from '../../components/ui/radio-group.tsx';
import { Select } from '../../components/ui/select.tsx';
import { plainSiteName, useSite } from '../../components/ui/site.tsx';
import { CountLine, Meta } from '../../components/ui/type.tsx';
import { cn } from '../../lib/utils.ts';
import { MapSlot } from '../maps/MapSlot.tsx';
import { CountsOnlyPanel } from './Activity.tsx';
import { BoardFrame } from './BoardFrame.tsx';
import { boardMetaQuery, boardReportsQuery } from './queries.ts';
import type { BoardSearch } from './queries.ts';
import { ReportAnswers } from './ReportAnswers.tsx';

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
  const site = plainSiteName(useSite().data);
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
    <BoardFrame
      eyebrow={site}
      title="Live report board"
      lede="First-hand accounts a moderator has read and approved for publication, with their reporters’ permission. Published means judged publishable, which is a weaker claim than true."
      actions={
        <>
          <Button asChild size="lg" block className="lg:w-auto">
            <Link to="/submit">Submit a report</Link>
          </Button>
          {/* Beside Submit on a desktop; under the list on a phone. */}
          {csv ? (
            <Button asChild variant="secondary" size="lg" className="hidden lg:inline-flex">
              <a href={csv} download>
                Download these (CSV)
              </a>
            </Button>
          ) : null}
        </>
      }
    >
      <CopyText slot="board_intro" />
      {meta.isPending ? <p role="status">Reading the reports…</p> : null}
      {meta.isError ? (
        <Alert tone="serious" title="The board could not be loaded">
          {meta.error.message}
        </Alert>
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
            <Button asChild variant="secondary" size="lg" block className="lg:hidden">
              <a href={csv} download>
                Download these (CSV)
              </a>
            </Button>
          ) : null}
          {chosen ? null : <CountedNotShown logbooks={meta.data.logbooks} />}
        </>
      ) : null}
    </BoardFrame>
  );
}

/** Publication switched off by the operator: said in a deep panel, in place of the list. */
function PublishingPaused() {
  return (
    <Card variant="deep">
      <p className="font-semibold">
        Publishing is paused. Reports still arrive and are being read.
      </p>
    </Card>
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
    <Card variant="quiet">
      <p className="max-w-prose">
        {`Counted, not shown: ${counted.map((l) => l.title).join(', ')}. Choose one in Filter to see its counts.`}
      </p>
    </Card>
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

function Narrowing({ logbooks, search }: { logbooks: BoardLogbook[]; search: BoardSearch }) {
  const navigate = useNavigate();
  const [q, setQ] = useState(search.q ?? '');
  const [open, setOpen] = useState(false);
  const on = activeFilters(search, logbooks);
  const go = (next: BoardSearch) => {
    void navigate({ to: '/board', search: next });
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        {/* Applies on Enter or with its own button, never per keystroke. */}
        <form
          role="search"
          aria-label="Search the board"
          className="flex min-w-0 grow items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go(searchWith(search, { q: q.trim() || undefined }));
          }}
        >
          <Field className="min-w-0 grow">
            <Label>Search the words</Label>
            <Input
              type="search"
              value={q}
              enterKeyHint="search"
              onChange={(e) => {
                setQ(e.target.value);
              }}
            />
          </Field>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <Button
          type="button"
          variant="secondary"
          className="w-full sm:w-auto"
          aria-haspopup="dialog"
          onClick={() => {
            setOpen(true);
          }}
        >
          Filter
          {on.length ? (
            <Count
              value={on.length}
              label={`${String(on.length)} filter${on.length === 1 ? '' : 's'} on`}
            />
          ) : null}
        </Button>
      </div>
      {on.length ? (
        <ul aria-label="Filters on" className="flex flex-wrap items-center gap-x-1 gap-y-0">
          {on.map((f) => (
            <li key={f.key}>
              <button
                type="button"
                className="inline-flex min-h-11 items-center rounded-control focus-visible:outline-2"
                aria-label={`Remove the filter ${f.words}`}
                onClick={() => {
                  go(f.without);
                }}
              >
                <span className={cn(chipVariants({ tone: 'tag' }), 'gap-1.5')}>
                  {f.words}
                  <span aria-hidden="true">✕</span>
                </span>
              </button>
            </li>
          ))}
          <li>
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                go(searchWith({}, { q: search.q }));
              }}
            >
              Clear all
            </Button>
          </li>
        </ul>
      ) : null}
      <FilterDialog
        open={open}
        onOpenChange={setOpen}
        logbooks={logbooks}
        search={search}
        onShow={(next) => {
          setOpen(false);
          go(next);
        }}
      />
    </div>
  );
}

/**
 * The filter, in a dialog (a sheet from the bottom on a phone). It holds
 * what the operator allowed and nothing more, and changes nothing until
 * "Show reports".
 */
function FilterDialog({
  open,
  onOpenChange,
  logbooks,
  search,
  onShow,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  logbooks: BoardLogbook[];
  search: BoardSearch;
  onShow: (next: BoardSearch) => void;
}) {
  const [logbook, setLogbook] = useState(search.logbook ?? '');
  const [answers, setAnswers] = useState<Record<string, string>>(search.f ?? {});
  const chosen = logbooks.find((l) => l.slug === logbook);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Opening again starts from what the board shows, not a half-made choice.
        if (next) {
          setLogbook(search.logbook ?? '');
          setAnswers(search.f ?? {});
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-sm:top-auto max-sm:bottom-0 max-sm:w-full max-sm:max-w-none max-sm:translate-y-0 max-sm:rounded-b-none">
        <form
          aria-label="Narrow the board"
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            const f = Object.fromEntries(
              Object.entries(answers).filter(
                ([k, v]) => v && chosen?.filters.some((x) => x.key === k),
              ),
            );
            onShow(searchWith(search, { logbook: logbook || undefined, f }));
          }}
        >
          <DialogHeader>
            <DialogTitle>Filter</DialogTitle>
            <DialogDescription>
              Choose a logbook to narrow by the questions its maker allows.
            </DialogDescription>
          </DialogHeader>
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
          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                setLogbook('');
                setAnswers({});
              }}
            >
              Clear all
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  onOpenChange(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit">Show reports</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One operator-chosen filter: choice cards for a short list or a yes-no
 * question, a select for a long list. Only the logbook's own wording.
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
  if (options && options.length <= 6) {
    return (
      <Field>
        <Label>{question.label}</Label>
        <RadioGroup value={value} onValueChange={onChange}>
          <RadioOption value="" label="Any answer" />
          {options.map((o) => (
            <RadioOption key={o.value} value={o.value} label={o.label} />
          ))}
        </RadioGroup>
      </Field>
    );
  }
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
  const query = useQuery(boardReportsQuery(search));
  if (query.isPending) return <p role="status">Reading the reports…</p>;
  if (query.isError) {
    return (
      <Alert tone="serious" title="The reports could not be loaded">
        {query.error.message}
      </Alert>
    );
  }
  if (!query.data.published) return <PublishingPaused />;
  // A thin place: the server sent no reports and no count, so there is
  // nothing to draw but its sentence.
  if ('withheld' in query.data) return <Alert>{query.data.reason}</Alert>;
  const { reports, total, page, page_size: size } = query.data;
  const filters = activeFilters(search, logbooks).length;
  const narrowed = Boolean(search.q) || filters > 0;
  const pages = Math.max(1, Math.ceil(total / size));
  const titles = new Map(logbooks.map((l) => [l.slug, l.title]));

  return (
    <section aria-label="Reports" className="flex flex-col gap-5">
      <CountLine
        role="status"
        parts={[
          `${String(total)} report${total === 1 ? '' : 's'}`,
          filters ? `${String(filters)} filter${filters === 1 ? '' : 's'}` : null,
          search.q ? `“${search.q}”` : null,
          pages > 1 ? `page ${String(page)} of ${String(pages)}` : null,
        ]}
      />
      {total === 0 ? (
        narrowed ? (
          <Empty title="No published report matches that">
            <span className="flex flex-col items-center gap-2">
              Try fewer words, or fewer filters.
              <Button
                type="button"
                variant="quiet"
                onClick={() => {
                  void navigate({ to: '/board', search: {} });
                }}
              >
                Clear all
              </Button>
            </span>
          </Empty>
        ) : (
          <Empty title="Nothing published yet">
            Reports appear here once a moderator has approved them.
          </Empty>
        )
      ) : (
        <ul className="layout-split grid gap-5 lg:grid-cols-2">
          {reports.map((r) => (
            <li key={r.public_ref} className="flex">
              <ReportCard r={r} logbookTitle={titles.get(r.logbook_slug) ?? r.logbook_title} />
            </li>
          ))}
        </ul>
      )}
      <Pagination
        className="justify-center"
        label="Pages of reports"
        page={page}
        pages={pages}
        onPage={(p) => {
          void navigate({ to: '/board', search: { ...search, ...(p > 1 ? { page: p } : {}) } });
          if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
        }}
      />
    </section>
  );
}

/**
 * Where it came from, in the operator's words (Plan E), as a tag: "Unverified
 * public report", or the organization's label. The words are the operator's
 * (site copy), sent with the report.
 */
export function OriginLabel({ r }: { r: Pick<PublicReport, 'origin' | 'label'> }) {
  const long = 'h-auto min-h-6 py-1 whitespace-normal';
  return r.origin === 'organization' ? (
    <Chip tone="tag" className={long} data-copy="origin_organization">
      {r.label}
    </Chip>
  ) : (
    <Chip tone="tag" className={long} data-copy="origin_open_form">
      {r.label}
    </Chip>
  );
}

/**
 * A published report on the board. No "Confirmed" chip and no count of
 * accounts: the public report carries neither (PublicReport), and severity
 * is staff-only (decision 16).
 */
function ReportCard({ r, logbookTitle }: { r: PublicReport; logbookTitle: string }) {
  return (
    <Card heading={<span className="font-mono">{r.public_ref}</span>} className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="label-face text-xs text-ink-alt">{logbookTitle}</p>
        <ReportTags r={r} />
      </div>
      <ReportAnswers slug={r.logbook_slug} answers={r.answers} only={4} pills />
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <Meta>
          {r.public_ref} · {filed(r.received_at)}
        </Meta>
        <Button asChild variant="quiet" className="-mr-2">
          <Link
            to="/board/$ref"
            params={{ ref: r.public_ref }}
            // The visible words first, then which report: an accessible name
            // must start with what is on screen (WCAG 2.5.3).
            aria-label={`Read in full: ${r.public_ref}`}
          >
            Read in full
          </Link>
        </Button>
      </div>
    </Card>
  );
}

/** The facts public data supports, as tags. */
export function ReportTags({ r }: { r: PublicReport }): ReactNode {
  return (
    <ul aria-label="About this report" className="flex flex-wrap gap-1.5">
      <li>
        <OriginLabel r={r} />
      </li>
      {r.third_party ? (
        <li>
          <Chip tone="tag" className="h-auto min-h-6 py-1 whitespace-normal">
            Via {r.third_party.filed_via}
          </Chip>
        </li>
      ) : null}
      {r.corrected ? (
        <li>
          <Chip tone="tag">Corrected</Chip>
        </li>
      ) : null}
      {r.editorial_note ? (
        <li>
          <Chip tone="tag">Archive note</Chip>
        </li>
      ) : null}
    </ul>
  );
}
