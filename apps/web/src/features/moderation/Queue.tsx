/**
 * The moderation queue (docs/design/screens/moderation.md section 02). Work
 * through reports without leaving the list, or open one to read it closely.
 *
 * Waiting reports first by default, oldest first; a moderator's search spans
 * every state, because finding the declined ones is part of the job. Search
 * is applied on Enter or with its own button, never on each keystroke
 * (decision 59), and lives in the address so a filtered queue can be
 * bookmarked and Back works.
 *
 * "Decide here" opens the report page's own Decide form under the row, so a
 * decision made here is the same call, and the same row on the record, as
 * one made on the report page.
 *
 * Contact details are never on this page: they open one report at a time,
 * with a reason the reporter is shown. A flagged report says which words
 * asked for a second read; that is a reading list, not a finding, and it is
 * never shown to the public.
 */
import {
  MAX_BATCH,
  REJECTION_REASONS,
  batchApproveReports,
  bulkDeclineReports,
} from '@reportlog/contracts';
import type { QueueItem, ResponseOf, listQueue } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BottomBar } from '@/components/ui/bottom-bar.tsx';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card } from '../../components/ui/card.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { CheckOption } from '../../components/ui/choice.tsx';
import { Chip } from '../../components/ui/chip.tsx';
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
import { Field, FieldDescription, FieldError } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Pagination } from '../../components/ui/pagination.tsx';
import { Select } from '../../components/ui/select.tsx';
import { ToastProvider, useToast } from '../../components/ui/toast.tsx';
import { CountLine, Meta } from '../../components/ui/type.tsx';
import { call } from '../../lib/api.ts';
import { floodQuery, laneQuery } from '../flood/queries.ts';
import { DECIDED_WORDS, DecideForm, NOTICE_WORDS } from './DecideForm.tsx';
import { AnswerLine, SeverityChip, StaffHead, StatusChip, useWide, when } from './parts.tsx';
import { corroborationQuery, queueQuery, sortOf } from './queries.ts';
import type { QueueSearch, QueueSeverity, QueueStatus } from './queries.ts';
import { SEVERITIES, SEVERITY_WORDS } from './words.ts';

type Queue = ResponseOf<typeof listQueue>;

/** The status buttons, in the order the design gives them. */
const STATUS_BUTTONS: { value: QueueStatus; label: string; counted: (n: number) => string }[] = [
  { value: 'pending', label: 'Waiting', counted: (n) => `${String(n)} waiting` },
  { value: 'valid', label: 'Approved', counted: (n) => `${String(n)} approved` },
  { value: 'invalid', label: 'Declined', counted: (n) => `${String(n)} declined` },
  { value: 'unknown', label: 'Unclear', counted: (n) => `${String(n)} unclear` },
  { value: 'withdrawn', label: 'Withdrawn', counted: (n) => `${String(n)} withdrawn` },
  {
    value: 'all',
    label: 'All',
    counted: (n) => `${String(n)} report${n === 1 ? '' : 's'}`,
  },
];

/** The filters the Filter panel holds, besides the second-read toggle. */
const PANEL_KEYS = [
  'logbook',
  'severity',
  'from',
  'to',
  'place',
  'answer_set',
  'lane',
  'organization',
] as const;

export function QueuePage({ search }: { search: QueueSearch }) {
  return (
    <ToastProvider>
      <QueueScreen search={search} />
    </ToastProvider>
  );
}

function QueueScreen({ search }: { search: QueueSearch }) {
  const navigate = useNavigate();
  const query = useQuery(queueQuery(search));
  const status = search.status ?? 'pending';

  /** Go to the queue with some filters changed. Any change but a page starts at page one. */
  const go = useCallback(
    (patch: Partial<QueueSearch>) => {
      const next: QueueSearch = { ...search, page: undefined, ...patch };
      void navigate({ to: '/moderate', search: clean(next) });
    },
    [navigate, search],
  );

  return (
    <div className="flex flex-col gap-6">
      <StaffHead
        title="Reports queue"
        lede="Read each report against the moderation standard. Approving publishes it; declining keeps it in the record, unpublished."
      >
        {query.data && !query.data.archive_published ? (
          <Alert tone="warning" title="The public archive is switched off" className="mt-2">
            Approving a report records the decision, but nothing is shown publicly until an
            administrator switches the archive back on.
          </Alert>
        ) : null}
      </StaffHead>

      <StatusButtons search={search} data={query.data} go={go} />
      {/* Keyed by the search, so a new search starts the tools afresh. The
          prefix matters: the list below is keyed by the same search, and two
          siblings with one key leave React unable to remove the old one. */}
      <Tools key={`tools:${JSON.stringify(search)}`} search={search} data={query.data} go={go} />

      {query.isPending ? <p role="status">Reading the queue…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data ? (
        <QueueList
          // A new filter or page is a new list: nothing stays ticked or open across it.
          key={`list:${JSON.stringify(search)}`}
          search={search}
          status={status}
          data={query.data}
          onPage={(page) => {
            go({ page });
          }}
        />
      ) : null}
      <Corroboration />
    </div>
  );
}

/** Drop empty values, so the address carries only the filters in force. */
function clean(s: QueueSearch): QueueSearch {
  return Object.fromEntries(
    Object.entries(s).filter(([, v]) => v !== undefined && v !== '' && v !== false),
  );
}

// ── the status buttons ──────────────────────────────────────────────────

/**
 * The mock-up's status pills: round, flat, and the one in force filled dark.
 * Pressed is the state, as before (aria-pressed); only the dress changed.
 */
const PILL =
  'group shrink-0 rounded-pill border-[1.5px] px-4 shadow-none active:shadow-none aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-paper';
const PILL_COUNT = 'group-aria-pressed:bg-paper group-aria-pressed:text-ink';

function StatusButtons({
  search,
  data,
  go,
}: {
  search: QueueSearch;
  data: Queue | undefined;
  go: (patch: Partial<QueueSearch>) => void;
}) {
  const status = search.status ?? 'pending';
  return (
    // On a phone the buttons wrap rather than scroll sideways as
    // moderation.md first asked: a phone's browser counted the scrolled-off
    // width as the page's, laid the whole page out at over 1000px and zoomed
    // out to fit, so nothing below could be tapped where it was drawn.
    <div className="flex flex-wrap items-center gap-3 pt-1 pb-2">
      <div role="group" aria-label="Show reports that are" className="flex flex-wrap gap-2">
        {STATUS_BUTTONS.map((b) => {
          const n = data?.counts[b.value];
          return (
            <Button
              key={b.value}
              type="button"
              variant="secondary"
              aria-pressed={status === b.value}
              className={PILL}
              onClick={() => {
                go({ status: b.value });
              }}
            >
              {b.label}
              {n === undefined ? null : (
                <Count value={n} label={b.counted(n)} className={PILL_COUNT} />
              )}
            </Button>
          );
        })}
      </div>
      {/* Not a status: it narrows whichever status is showing, so it stands apart. */}
      <span aria-hidden="true" className="h-8 w-px shrink-0 bg-ink-alt" />
      <Button
        type="button"
        variant="secondary"
        aria-pressed={Boolean(search.flagged)}
        className={PILL}
        onClick={() => {
          go({ flagged: search.flagged ? undefined : true });
        }}
      >
        Only second reads
        {data ? (
          <Count
            value={data.open_flags}
            label={`${String(data.open_flags)} waiting for a second read`}
            className={PILL_COUNT}
          />
        ) : null}
      </Button>
    </div>
  );
}

// ── search, filter, order ──────────────────────────────────────────────

function Tools({
  search,
  data,
  go,
}: {
  search: QueueSearch;
  data: Queue | undefined;
  go: (patch: Partial<QueueSearch>) => void;
}) {
  const [q, setQ] = useState(search.q ?? '');
  const [filtering, setFiltering] = useState(false);
  const wide = useWide();
  const panelId = useId();
  const on = PANEL_KEYS.filter((k) => Boolean(search[k])).length;
  const status = search.status ?? 'pending';
  const sort = sortOf(search);
  const words = filterWords(search, data);
  const total = data?.total;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <form
          role="search"
          aria-label="Search the queue"
          className="flex min-w-0 flex-1 items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: q.trim() || undefined });
          }}
        >
          <Field className="min-w-0 flex-1">
            <Label className="sr-only">Search words or a reference</Label>
            <FieldDescription className="sr-only">Press Enter to search.</FieldDescription>
            <Input
              type="search"
              placeholder="Search words or a reference"
              value={q}
              maxLength={200}
              onChange={(e) => {
                setQ(e.target.value);
              }}
            />
          </Field>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <div className="flex flex-wrap items-end gap-2">
          <Button
            type="button"
            variant="secondary"
            aria-expanded={filtering}
            aria-controls={wide && filtering ? panelId : undefined}
            onClick={() => {
              setFiltering((f) => !f);
            }}
          >
            Filter
            {on ? (
              <Count value={on} label={`${String(on)} filter${on === 1 ? '' : 's'} on`} />
            ) : null}
          </Button>
          <Field>
            <Label className="sr-only">Order</Label>
            <Select
              value={sort}
              onChange={(e) => {
                go({ sort: e.target.value as 'newest' | 'oldest' });
              }}
            >
              <option value="oldest">Oldest first</option>
              <option value="newest">Newest first</option>
            </Select>
          </Field>
        </div>
      </div>
      {filtering ? (
        <FilterPanel
          id={panelId}
          asDialog={!wide}
          search={search}
          onClose={() => {
            setFiltering(false);
          }}
          go={go}
        />
      ) : null}
      <CountLine
        parts={[
          total === undefined
            ? null
            : (STATUS_BUTTONS.find((b) => b.value === status)?.counted(total) ?? null),
          words.length
            ? `${String(words.length)} filter${words.length === 1 ? '' : 's'}: ${words.join(', ')}`
            : null,
          sort === 'oldest' ? 'oldest first' : 'newest first',
        ]}
      />
    </div>
  );
}

/** Every filter in force, in words, for the count line. */
export function filterWords(s: QueueSearch, data?: Queue): string[] {
  const out: string[] = [];
  if (s.q) out.push(`matching “${s.q}”`);
  if (s.flagged) out.push('only second reads');
  if (s.logbook) {
    const title = data?.reports.find((r) => r.logbook_slug === s.logbook)?.logbook_title;
    out.push(`logbook: ${title ?? s.logbook}`);
  }
  if (s.severity) out.push(`rated: ${SEVERITY_WORDS[s.severity]?.label ?? s.severity}`);
  if (s.from) out.push(`arrived from ${when(s.from)}`);
  if (s.to) out.push(`arrived until ${when(s.to)}`);
  if (s.place) out.push(`place: ${s.place}`);
  if (s.answer_set) out.push('one set of identical answers');
  if (s.lane === 'organization') out.push('filed by an organization');
  if (s.lane === 'open_form') out.push('filed through the open form');
  if (s.organization) out.push('one organization’s reports');
  return out;
}

/** An ISO time as a datetime-local input's value, in this browser's zone. */
function local(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Every filter the queue takes, in one place: a panel dropping under the
 * tools on a desktop, a dialog on a phone. Nothing applies until Apply.
 */
function FilterPanel({
  id,
  asDialog,
  search,
  onClose,
  go,
}: {
  id: string;
  asDialog: boolean;
  search: QueueSearch;
  onClose: () => void;
  go: (patch: Partial<QueueSearch>) => void;
}) {
  const flood = useQuery(floodQuery);
  const lane = useQuery(laneQuery);
  const [logbook, setLogbook] = useState(search.logbook ?? '');
  const [severity, setSeverity] = useState<QueueSeverity | ''>(search.severity ?? '');
  const [from, setFrom] = useState(local(search.from));
  const [to, setTo] = useState(local(search.to));
  const [place, setPlace] = useState(search.place ?? '');
  const [answerSet, setAnswerSet] = useState(search.answer_set ?? '');
  const [laneChoice, setLane] = useState<'' | 'organization' | 'open_form'>(search.lane ?? '');
  const [organization, setOrganization] = useState(search.organization ?? '');
  const [flagged, setFlagged] = useState(Boolean(search.flagged));
  const [placeProblem, setPlaceProblem] = useState('');

  const logbooks = flood.data?.totals.by_logbook ?? [];
  const organizations = lane.data?.organizations ?? [];

  const apply = () => {
    const code = place.trim().toUpperCase();
    if (code && !/^[A-Z]{2}(-[A-Z0-9]{1,3}(-\d{5})?)?$/.test(code)) {
      setPlaceProblem('Write a state code like US-AZ, or a county code like US-AZ-04013.');
      return;
    }
    go({
      logbook: logbook || undefined,
      severity: severity || undefined,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(to).toISOString() : undefined,
      place: code || undefined,
      answer_set: answerSet || undefined,
      lane: laneChoice || undefined,
      organization: organization || undefined,
      flagged: flagged || undefined,
    });
    onClose();
  };
  const clearAll = () => {
    setLogbook('');
    setSeverity('');
    setFrom('');
    setTo('');
    setPlace('');
    setAnswerSet('');
    setLane('');
    setOrganization('');
    setFlagged(false);
    setPlaceProblem('');
  };

  const fields = (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field>
        <Label>Logbook</Label>
        <Select
          value={logbook}
          onChange={(e) => {
            setLogbook(e.target.value);
          }}
        >
          <option value="">Every logbook</option>
          {logbook && !logbooks.some((l) => l.slug === logbook) ? (
            <option value={logbook}>{logbook}</option>
          ) : null}
          {logbooks.map((l) => (
            <option key={l.slug} value={l.slug}>
              {l.title}
            </option>
          ))}
        </Select>
      </Field>
      <Field>
        <Label>Severity</Label>
        <Select
          value={severity}
          onChange={(e) => {
            setSeverity(e.target.value as QueueSeverity | '');
          }}
        >
          <option value="">Any rating, or none</option>
          {[...SEVERITIES, 'none' as const].map((k) => (
            <option key={k} value={k}>
              {k === 'none' ? 'Nobody has rated it' : SEVERITY_WORDS[k]?.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field>
        <Label>Arrived from</Label>
        <Input
          type="datetime-local"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
          }}
        />
      </Field>
      <Field>
        <Label>Arrived until</Label>
        <Input
          type="datetime-local"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
          }}
        />
      </Field>
      <Field>
        <Label>State or county code</Label>
        <FieldDescription>
          US-AZ takes its counties too; US-AZ-04013 is one county.
        </FieldDescription>
        <Input
          value={place}
          maxLength={16}
          onChange={(e) => {
            setPlace(e.target.value);
            setPlaceProblem('');
          }}
        />
        <FieldError>{placeProblem}</FieldError>
      </Field>
      <Field>
        <Label>Filed</Label>
        <Select
          value={laneChoice}
          onChange={(e) => {
            setLane(e.target.value as typeof laneChoice);
          }}
        >
          <option value="">Either way</option>
          <option value="organization">By an organization</option>
          <option value="open_form">Through the open form</option>
        </Select>
      </Field>
      <Field>
        <Label>Organization</Label>
        <Select
          value={organization}
          onChange={(e) => {
            setOrganization(e.target.value);
          }}
        >
          <option value="">Any organization</option>
          {organization && !organizations.some((o) => String(o.id) === organization) ? (
            <option value={organization}>The organization chosen on the flood screen</option>
          ) : null}
          {organizations.map((o) => (
            <option key={o.id} value={String(o.id)}>
              {o.name}
            </option>
          ))}
        </Select>
      </Field>
      {answerSet ? (
        <div className="flex flex-col gap-1.5">
          <p className="label-face text-sm">Identical answers</p>
          <p className="text-sm">One set of identical answers, chosen on the flood screen.</p>
          <Button
            type="button"
            variant="quiet"
            className="self-start"
            onClick={() => {
              setAnswerSet('');
            }}
          >
            Stop narrowing to that set
          </Button>
        </div>
      ) : null}
      <CheckOption
        label="Only reports waiting for a second read"
        className="sm:col-span-2"
        checked={flagged}
        onCheckedChange={(v) => {
          setFlagged(v === true);
        }}
      />
    </div>
  );

  const actions = (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
      <Button type="button" variant="quiet" className="self-start" onClick={clearAll}>
        Clear all
      </Button>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Apply</Button>
      </div>
    </div>
  );

  const form = (
    <form
      aria-label="Filter the queue"
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      {fields}
      {actions}
    </form>
  );

  if (asDialog) {
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Filter the queue</DialogTitle>
            <DialogDescription>Nothing changes until you press Apply.</DialogDescription>
          </DialogHeader>
          {form}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Card id={id} heading="Filter the queue">
      {form}
    </Card>
  );
}

// ── the list ────────────────────────────────────────────────────────────

const selectable = (r: QueueItem) => r.moderation_status !== 'valid' && !r.withdrawn;

/** Why a row's batch box is off. Shown on the row, not hidden. */
const WRITTEN_WHY = 'It has a written account, which needs its own look.';
const needsOwnLook = (r: QueueItem) => selectable(r) && r.has_undecided_written;

function QueueList({
  search,
  status,
  data,
  onPage,
}: {
  search: QueueSearch;
  status: QueueStatus;
  data: Queue;
  onPage: (page: number) => void;
}) {
  const toast = useToast();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const openDirty = useRef(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [focusNext, setFocusNext] = useState<string | null>(null);
  const [result, setResult] = useState<ReactNode>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // After a decision the list is read again; focus moves to the "Decide here"
  // of the report that followed the decided one, or the first left.
  useEffect(() => {
    if (focusNext === null) return;
    const list = listRef.current;
    if (!list) return;
    const target =
      list.querySelector<HTMLElement>(`[data-decide="${focusNext}"]`) ??
      list.querySelector<HTMLElement>('[data-decide]');
    target?.focus();
    setFocusNext(null);
  }, [data, focusNext]);

  const choose = (threadId: string | null) => {
    if (open && threadId !== open && openDirty.current) {
      setAsking(threadId ?? '');
      return;
    }
    openDirty.current = false;
    setOpen(threadId);
  };

  const pickable = data.reports.filter((r) => selectable(r) && !needsOwnLook(r));
  const filtered =
    Boolean(search.q) || Boolean(search.flagged) || PANEL_KEYS.some((k) => Boolean(search[k]));

  if (data.reports.length === 0) {
    return (
      <>
        {result}
        {status === 'pending' && !filtered ? (
          <Empty title="Nothing waiting">
            New reports appear here as they arrive. This page does not refresh by itself; reload to
            check.
          </Empty>
        ) : (
          <Empty title="Nothing matches">
            Nothing here under this search and these filters. Try another status, or clear the
            filters.
          </Empty>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {result}
      {picked.size ? (
        <SelectionBar
          picked={picked}
          pickable={pickable.length}
          search={search}
          onSelectAll={() => {
            setPicked(new Set(pickable.map((r) => r.thread_id)));
          }}
          onClear={() => {
            setPicked(new Set());
          }}
          onDone={(message, alert) => {
            setPicked(new Set());
            toast.show(message);
            setResult(alert);
          }}
        />
      ) : null}
      <ul ref={listRef} className="flex flex-col gap-4" aria-label="Reports">
        {data.reports.map((r, i) => (
          <li key={r.thread_id}>
            <QueueRow
              r={r}
              search={search}
              picked={picked.has(r.thread_id)}
              onPick={
                selectable(r) && !needsOwnLook(r)
                  ? (on) => {
                      setPicked((was) => {
                        const next = new Set(was);
                        if (on) next.add(r.thread_id);
                        else next.delete(r.thread_id);
                        return next;
                      });
                    }
                  : null
              }
              open={open === r.thread_id}
              onToggle={() => {
                choose(open === r.thread_id ? null : r.thread_id);
              }}
              onDirty={(d) => {
                if (open === r.thread_id) openDirty.current = d;
              }}
              onDecided={(d) => {
                const after = data.reports[i + 1] ?? data.reports[i - 1];
                openDirty.current = false;
                setOpen(null);
                setFocusNext(after?.thread_id ?? '');
                const notice = d.notice === 'none' ? '' : ` ${NOTICE_WORDS[d.notice] ?? ''}`;
                toast.show(`${r.public_ref} ${DECIDED_WORDS[d.status]}.${notice}`);
              }}
            />
          </li>
        ))}
      </ul>
      <Pagination label="Pages of the queue" page={data.page} pages={data.pages} onPage={onPage} />
      <Dialog
        open={asking !== null}
        onOpenChange={(on) => {
          if (!on) setAsking(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave this decision unfinished?</DialogTitle>
            <DialogDescription>
              Nothing is recorded until you press Record the decision. If you leave it, what you
              chose and wrote is lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                openDirty.current = false;
                setOpen(asking === '' ? null : asking);
                setAsking(null);
              }}
            >
              Leave it
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setAsking(null);
              }}
            >
              Keep deciding
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function QueueRow({
  r,
  search,
  picked,
  onPick,
  open,
  onToggle,
  onDirty,
  onDecided,
}: {
  r: QueueItem;
  search: QueueSearch;
  picked: boolean;
  onPick: ((on: boolean) => void) | null;
  open: boolean;
  onToggle: () => void;
  onDirty: (dirty: boolean) => void;
  onDecided: (d: { status: 'valid' | 'invalid' | 'unknown'; notice: string }) => void;
}) {
  const formId = useId();
  const whyId = useId();
  const blocked = needsOwnLook(r);
  return (
    <Card className="flex-row items-start gap-3 p-4 sm:gap-4 sm:p-5">
      {blocked ? (
        <span className="-m-2.5 flex size-11 shrink-0 items-center justify-center">
          <Checkbox
            aria-label={`Select ${r.public_ref}`}
            aria-describedby={whyId}
            checked={false}
            disabled
          />
        </span>
      ) : onPick ? (
        // The box is small; an edge drawn around it, inside the control, makes
        // the 44px target.
        <span className="-m-2.5 flex size-11 shrink-0 items-center justify-center">
          <Checkbox
            aria-label={`Select ${r.public_ref}`}
            className="relative before:absolute before:-inset-2.5 before:content-['']"
            checked={picked}
            onCheckedChange={(on) => {
              onPick(on === true);
            }}
          />
        </span>
      ) : (
        <span aria-hidden="true" className="-m-2.5 size-11 shrink-0" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              <StatusChip r={r} />
              <SeverityChip severity={r.severity} />
              {r.threat_open ? <Chip tone="serious">Threat to safety</Chip> : null}
              {r.needs_review ? <Chip tone="tag">Second read</Chip> : null}
              {r.origin === 'organization' ? <Chip tone="tag">Organization</Chip> : null}
              {r.public ? <Chip tone="tag">Public</Chip> : null}
            </div>
            {blocked ? (
              <p id={whyId} className="text-sm text-ink-alt">
                {WRITTEN_WHY}
              </p>
            ) : null}
            <AnswerLine slug={r.logbook_slug} answers={r.answers} />
            <Meta>
              {r.public_ref} · {r.logbook_title} · arrived {when(r.received_at)}
              {r.versions > 1 ? ` · version ${String(r.versions)}` : ''} ·{' '}
              {r.origin === 'organization'
                ? `via ${r.filed_via ?? 'an organization'}`
                : 'open form'}
            </Meta>
            {r.needs_review ? (
              <p className="text-sm text-ink-alt">
                Second read asked for: {r.review_terms.join(', ')}
              </p>
            ) : null}
            {!r.may_publish ? (
              <p className="text-sm text-ink-alt">Its reporter did not permit publishing.</p>
            ) : null}
            {r.incident_size > 1 ? (
              <p className="text-sm text-ink-alt">{corroborationWords(r)}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {r.withdrawn ? null : (
              <Button
                type="button"
                variant="secondary"
                className="bg-ink text-paper hover:bg-ink"
                data-decide={r.thread_id}
                aria-expanded={open}
                aria-controls={open ? formId : undefined}
                onClick={onToggle}
              >
                Decide here
              </Button>
            )}
            <Button asChild variant="secondary">
              <Link
                to="/moderate/$threadId"
                params={{ threadId: r.thread_id }}
                search={search}
                aria-label={`Open ${r.public_ref}`}
              >
                Open
              </Link>
            </Button>
          </div>
        </div>
        {open ? (
          <Card id={formId} variant="quiet" className="p-4">
            <DecideForm
              report={r}
              focusOnOpen
              onDirty={onDirty}
              onDecided={onDecided}
              onCancel={onToggle}
            />
          </Card>
        ) : null}
      </div>
    </Card>
  );
}

// ── selected reports ────────────────────────────────────────────────────

function SelectionBar({
  picked,
  pickable,
  search,
  onSelectAll,
  onClear,
  onDone,
}: {
  picked: ReadonlySet<string>;
  pickable: number;
  search: QueueSearch;
  onSelectAll: () => void;
  onClear: () => void;
  onDone: (toast: string, alert: ReactNode) => void;
}) {
  const qc = useQueryClient();
  const [declining, setDeclining] = useState(false);
  const ids = [...picked];
  const approve = useMutation({
    mutationFn: () => call(batchApproveReports, { body: { thread_ids: ids.slice(0, MAX_BATCH) } }),
    onSuccess: async (out) => {
      onDone(
        `Approved ${String(out.approved.length)}.`,
        out.skipped.length ? (
          <Alert tone="note" title={`Approved ${String(out.approved.length)}.`}>
            Left alone: {out.skipped.map((x) => x.why).join(' ')}
          </Alert>
        ) : null,
      );
      await qc.invalidateQueries({ queryKey: ['moderation'] });
      await qc.invalidateQueries({ queryKey: ['board'] });
    },
  });
  return (
    <>
      <BottomBar className="z-30 max-md:fixed max-md:inset-x-0 max-md:bottom-0 md:sticky md:top-2">
        <Card
          variant="deep"
          className="flex-row flex-wrap items-center gap-3 px-4 py-3 max-md:rounded-none"
        >
          <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 label-face text-sm">
            <span role="status">{`${String(picked.size)} selected`}</span>
            {picked.size < pickable ? (
              <Button variant="quiet" className="text-on-deep" onClick={onSelectAll}>
                {`Select all ${String(pickable)}`}
              </Button>
            ) : null}
            <Button variant="quiet" className="text-on-deep" onClick={onClear}>
              Select none
            </Button>
          </p>
          <Button
            busy={approve.isPending}
            busyLabel="Approving…"
            onClick={() => {
              approve.mutate();
            }}
          >
            {picked.size > MAX_BATCH
              ? `Approve the first ${String(MAX_BATCH)}`
              : 'Approve selected'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setDeclining(true);
            }}
          >
            Decline selected…
          </Button>
        </Card>
      </BottomBar>
      {approve.isError ? <Alert tone="serious">{approve.error.message}</Alert> : null}
      <BulkDecline
        open={declining}
        ids={ids}
        search={search}
        onClose={() => {
          setDeclining(false);
        }}
        onDone={onDone}
      />
    </>
  );
}

/**
 * Decline what is selected with one reason from the fixed list (Plan E,
 * decision 51). Each report still gets its own decision row with who, when
 * and the reason, and is counted publicly under it; NOBODY IS EMAILED, because
 * a flood's addresses are whatever the flood typed.
 *
 * The server asks for the second factor again (step-up); the API client
 * shows the prompt and sends this once more (lib/api.ts).
 */
function BulkDecline({
  open,
  ids,
  search,
  onClose,
  onDone,
}: {
  open: boolean;
  ids: string[];
  search: QueueSearch;
  onClose: () => void;
  onDone: (toast: string, alert: ReactNode) => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [problem, setProblem] = useState('');
  const n = String(ids.length);
  const decline = useMutation({
    mutationFn: () =>
      call(bulkDeclineReports, {
        body: {
          thread_ids: ids,
          reason_code: reason,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
          filter: Object.fromEntries(
            Object.entries(clean(search)).map(([k, v]) => [k, String(v)] as const),
          ),
        },
      }),
    onSuccess: async (out) => {
      onClose();
      onDone(
        `Declined ${String(out.declined.length)}. Nobody was emailed.`,
        out.skipped.length ? (
          <Alert tone="note" title={`Declined ${String(out.declined.length)}.`}>
            Left alone: {out.skipped.map((x) => x.why).join(' ')}
          </Alert>
        ) : null,
      );
      await qc.invalidateQueries({ queryKey: ['moderation'] });
      await qc.invalidateQueries({ queryKey: ['board'] });
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(on) => {
        if (!on) onClose();
      }}
    >
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason) {
              setProblem('Choose the reason. Each report is counted under it.');
              return;
            }
            decline.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{`Decline ${n} selected`}</DialogTitle>
            <DialogDescription>Nobody is emailed when you decline in bulk.</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-ink-alt">
            Each report gets its own decision on the record, with your name and the time, and is
            counted publicly under this reason.
          </p>
          <Field>
            <Label>The reason</Label>
            <Select
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setProblem('');
              }}
            >
              <option value="">Choose a reason</option>
              {REJECTION_REASONS.map((x) => (
                <option key={x.code} value={x.code}>
                  {x.label}
                </option>
              ))}
            </Select>
            <FieldError>{problem}</FieldError>
          </Field>
          <Field>
            <Label>Note for the record (optional, never sent)</Label>
            <Input
              value={comment}
              maxLength={2000}
              onChange={(e) => {
                setComment(e.target.value);
              }}
            />
          </Field>
          {decline.isError ? <Alert tone="serious">{decline.error.message}</Alert> : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            {/* Not the action colour: declining a page of reports is rarely what somebody came for. */}
            <Button
              type="submit"
              variant="secondary"
              busy={decline.isPending}
              busyLabel="Declining…"
            >
              {`Decline ${n}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── below the list ─────────────────────────────────────────────────────

/**
 * Legacy's "By the numbers" panels for staff: corroboration and severity
 * across PUBLISHED reports, each broken out. No single headline figure: a
 * bare "N incidents" is the number that gets quoted without the caveat that
 * these are reviewed accounts, not verified facts.
 */
function Corroboration() {
  const query = useQuery(corroborationQuery);
  if (!query.data) return null;
  const d = query.data;
  const rows: [string, number][] = [
    ['Accounts corroborated by at least one other', d.corroborated_accounts],
    ['Single accounts', d.single_accounts],
    ['Incidents with more than one account', d.incidents_with_several_accounts],
  ];
  return (
    <Card variant="quiet" heading="Across the published reports">
      <p className="text-sm text-ink-alt">
        {String(d.published)} published. Reports count as corroborated only when a moderator linked
        them as the same incident, and only published ones are counted.
      </p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt>{k}</dt>
            <dd className="text-right font-mono">{String(v)}</dd>
          </div>
        ))}
        {[...SEVERITIES, 'none' as const].map((k) => (
          <div key={k} className="contents">
            <dt>Rated: {SEVERITY_WORDS[k]?.label}</dt>
            <dd className="text-right font-mono">{String(d.by_severity[k] ?? 0)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** "Linked with 2 other reports, 2 accounts published": never one bare number. */
export function corroborationWords(r: Pick<QueueItem, 'incident_size' | 'corroboration'>) {
  const others = r.incident_size - 1;
  return `Linked with ${String(others)} other report${others === 1 ? '' : 's'} · ${String(r.corroboration)} of the ${String(r.incident_size)} published`;
}
