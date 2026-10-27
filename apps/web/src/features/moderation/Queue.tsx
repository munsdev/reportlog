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
import { Btn } from '../../mockup/Btn.tsx';
import { Check } from '../../mockup/Choices.tsx';
import { Empty } from '../../mockup/Empty.tsx';
import { Note } from '../../mockup/Note.tsx';
import { Modal } from '../../mockup/Modal.tsx';
import { Err, Problem } from '../../mockup/Notice.tsx';
import { Pager } from '../../mockup/Pager.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Seg } from '../../mockup/Seg.tsx';
import { ToastProvider, useToast } from '../../components/ui/toast.tsx';
import { call } from '../../lib/api.ts';
import { floodQuery, laneQuery } from '../flood/queries.ts';
import { Chip } from '../../mockup/Chip.tsx';
import { DECIDED_WORDS, DecideForm, NOTICE_WORDS } from './DecideForm.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { AnswerLine, SeverityChip, StatusChip, useWide, when } from './parts.tsx';
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
    <StaffPage
      title="Reports queue"
      lede="Read each report against the moderation standard. Approving publishes it; declining keeps it in the record, unpublished."
    >
      {query.data && !query.data.archive_published ? (
        <Problem title="The public archive is switched off.">
          Approving a report records the decision, but nothing is shown publicly until an
          administrator switches the archive back on.
        </Problem>
      ) : null}

      <StatusButtons search={search} data={query.data} go={go} />
      {/* Keyed by the search, so a new search starts the tools afresh. The
          prefix matters: the list below is keyed by the same search, and two
          siblings with one key leave React unable to remove the old one. */}
      <Tools key={`tools:${JSON.stringify(search)}`} search={search} data={query.data} go={go} />

      {query.isPending ? <p role="status">Reading the queue…</p> : null}
      {query.isError ? <Problem>{query.error.message}</Problem> : null}
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
    </StaffPage>
  );
}

/** Drop empty values, so the address carries only the filters in force. */
function clean(s: QueueSearch): QueueSearch {
  return Object.fromEntries(
    Object.entries(s).filter(([, v]) => v !== undefined && v !== '' && v !== false),
  );
}

// ── the status buttons ──────────────────────────────────────────────────

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
  // One row, as the mock-up draws it: the statuses, then "Only second reads"
  // (not a status: it narrows whichever status is showing).
  return (
    <Seg
      label="Show"
      options={[
        ...STATUS_BUTTONS.map((b) => {
          const n = data?.counts[b.value];
          return {
            key: b.value,
            label: b.label,
            n,
            words: n === undefined ? undefined : b.counted(n),
            pressed: status === b.value,
            onClick: () => {
              go({ status: b.value });
            },
          };
        }),
        {
          key: 'flagged',
          label: 'Only second reads',
          n: data?.open_flags,
          words:
            data === undefined ? undefined : `${String(data.open_flags)} waiting for a second read`,
          pressed: Boolean(search.flagged),
          onClick: () => {
            go({ flagged: search.flagged ? undefined : true });
          },
        },
      ]}
    />
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
  const qId = useId();
  return (
    <>
      <form
        className="toolbar"
        role="search"
        aria-label="Search the queue"
        onSubmit={(e) => {
          e.preventDefault();
          go({ q: q.trim() || undefined });
        }}
      >
        <div className="search grow">
          <label className="vh" htmlFor={qId}>
            Search words or a reference
          </label>
          <input
            id={qId}
            type="search"
            placeholder="Search words or a reference"
            value={q}
            maxLength={200}
            onChange={(e) => {
              setQ(e.target.value);
            }}
          />
          <Btn sm flat type="submit">
            Search
          </Btn>
        </div>
        <Btn
          sm
          flat
          aria-expanded={filtering}
          aria-controls={wide && filtering ? panelId : undefined}
          onClick={() => {
            setFiltering((f) => !f);
          }}
        >
          Filter
          {on ? (
            <>
              <span aria-hidden="true"> · {on}</span>
              <span className="sr-only">{`, ${String(on)} filter${on === 1 ? '' : 's'} on`}</span>
            </>
          ) : null}
        </Btn>
        <label className="select">
          <span className="vh">Order</span>
          <select
            value={sort}
            onChange={(e) => {
              go({ sort: e.target.value as 'newest' | 'oldest' });
            }}
          >
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
          </select>
        </label>
      </form>
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
      <p className="m" aria-live="polite">
        {[
          total === undefined
            ? null
            : (STATUS_BUTTONS.find((b) => b.value === status)?.counted(total) ?? null),
          words.length
            ? `${String(words.length)} filter${words.length === 1 ? '' : 's'}: ${words.join(', ')}`
            : null,
          sort === 'oldest' ? 'oldest first' : 'newest first',
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </>
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

  const uid = useId();
  const fields = (
    <>
      <div className="field">
        <label htmlFor={`${uid}-logbook`}>Logbook</label>
        <select
          id={`${uid}-logbook`}
          className="sel"
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
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${uid}-severity`}>Severity</label>
        <select
          id={`${uid}-severity`}
          className="sel"
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
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${uid}-from`}>Arrived from</label>
        <input
          id={`${uid}-from`}
          className="input"
          type="datetime-local"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
          }}
        />
      </div>
      <div className="field">
        <label htmlFor={`${uid}-to`}>Arrived until</label>
        <input
          id={`${uid}-to`}
          className="input"
          type="datetime-local"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
          }}
        />
      </div>
      <div className="field">
        <label htmlFor={`${uid}-place`}>State or county code</label>
        <input
          id={`${uid}-place`}
          className="input"
          value={place}
          maxLength={16}
          aria-describedby={`${uid}-place-help`}
          aria-invalid={placeProblem ? true : undefined}
          onChange={(e) => {
            setPlace(e.target.value);
            setPlaceProblem('');
          }}
        />
        <span className="help" id={`${uid}-place-help`}>
          US-AZ takes its counties too; US-AZ-04013 is one county.
        </span>
        <Err>{placeProblem}</Err>
      </div>
      <div className="field">
        <label htmlFor={`${uid}-lane`}>Filed</label>
        <select
          id={`${uid}-lane`}
          className="sel"
          value={laneChoice}
          onChange={(e) => {
            setLane(e.target.value as typeof laneChoice);
          }}
        >
          <option value="">Either way</option>
          <option value="organization">By an organization</option>
          <option value="open_form">Through the open form</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${uid}-org`}>Organization</label>
        <select
          id={`${uid}-org`}
          className="sel"
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
        </select>
      </div>
      {answerSet ? (
        <div className="field">
          <span className="lbl">Identical answers</span>
          <p>One set of identical answers, chosen on the flood screen.</p>
          <div className="acts">
            <Btn
              sm
              flat
              look="ghost"
              onClick={() => {
                setAnswerSet('');
              }}
            >
              Stop narrowing to that set
            </Btn>
          </div>
        </div>
      ) : null}
      <Check
        checked={flagged}
        onChange={(e) => {
          setFlagged(e.target.checked);
        }}
      >
        Only reports waiting for a second read
      </Check>
    </>
  );

  const actions = (
    <>
      <Btn sm flat look="ink" type="submit">
        Apply
      </Btn>
      <Btn sm flat onClick={onClose}>
        Cancel
      </Btn>
      <Btn sm flat look="ghost" onClick={clearAll}>
        Clear all
      </Btn>
    </>
  );

  if (asDialog) {
    return (
      <Modal
        title="Filter the queue"
        description="Nothing changes until you press Apply."
        open
        onClose={onClose}
        buttons={actions}
        onSubmit={apply}
      >
        {fields}
      </Modal>
    );
  }
  return (
    <form
      aria-label="Filter the queue"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <Panel title="Filter the queue" id={id}>
        {fields}
        <div className="acts">{actions}</div>
      </Panel>
    </form>
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
  const listRef = useRef<HTMLDivElement>(null);

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
    <>
      {result}
      <div ref={listRef} className="qlist2" role="list" aria-label="Reports">
        {data.reports.map((r, i) => (
          <QueueRow
            key={r.thread_id}
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
        ))}
      </div>
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
      <Pager label="Pages of the queue" page={data.page} pages={data.pages} onPage={onPage} />
      <Modal
        title="Leave this decision unfinished?"
        description="Nothing is recorded until you press Record the decision. If you leave it, what you chose and wrote is lost."
        open={asking !== null}
        onClose={() => {
          setAsking(null);
        }}
        buttons={
          <>
            <Btn
              sm
              flat
              onClick={() => {
                openDirty.current = false;
                setOpen(asking === '' ? null : asking);
                setAsking(null);
              }}
            >
              Leave it
            </Btn>
            <Btn
              sm
              flat
              look="ink"
              onClick={() => {
                setAsking(null);
              }}
            >
              Keep deciding
            </Btn>
          </>
        }
      />
    </>
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
    <article className="qrow" role="listitem">
      {blocked ? (
        <label className="qsel">
          <input
            type="checkbox"
            aria-label={`Select ${r.public_ref}`}
            aria-describedby={whyId}
            checked={false}
            disabled
          />
        </label>
      ) : onPick ? (
        <label className="qsel">
          <input
            type="checkbox"
            aria-label={`Select ${r.public_ref}`}
            checked={picked}
            onChange={(e) => {
              onPick(e.target.checked);
            }}
          />
        </label>
      ) : (
        <span aria-hidden="true" className="qsel" />
      )}
      <div className="qbody">
        <div className="chips">
          <StatusChip r={r} />
          <SeverityChip severity={r.severity} />
          {r.threat_open ? <span className="st bad">Threat to safety</span> : null}
          {r.needs_review ? <Chip kind="flag">Second read</Chip> : null}
          {r.origin === 'organization' ? <Chip kind="off">Organization</Chip> : null}
          {r.public ? <Chip kind="ok">Public</Chip> : null}
        </div>
        {blocked ? (
          <p id={whyId} className="m">
            {WRITTEN_WHY}
          </p>
        ) : null}
        <AnswerLine slug={r.logbook_slug} answers={r.answers} />
        <p className="m">
          {r.public_ref} · {r.logbook_title} · arrived {when(r.received_at)}
          {r.versions > 1 ? ` · version ${String(r.versions)}` : ''} ·{' '}
          {r.origin === 'organization' ? `via ${r.filed_via ?? 'an organization'}` : 'open form'}
        </p>
        {r.needs_review ? (
          <p className="m">Second read asked for: {r.review_terms.join(', ')}</p>
        ) : null}
        {!r.may_publish ? <p className="m">Its reporter did not permit publishing.</p> : null}
        {r.incident_size > 1 ? <p className="m">{corroborationWords(r)}</p> : null}
        <div className="acts">
          {r.withdrawn ? null : (
            <Btn
              sm
              flat
              look="ink"
              data-decide={r.thread_id}
              aria-expanded={open}
              aria-controls={open ? formId : undefined}
              onClick={onToggle}
            >
              Decide here
            </Btn>
          )}
          <Link
            className="btn sm flat"
            to="/moderate/$threadId"
            params={{ threadId: r.thread_id }}
            search={search}
            aria-label={`Open ${r.public_ref}`}
          >
            Open
          </Link>
        </div>
        {open ? (
          <div id={formId}>
            <DecideForm
              report={r}
              focusOnOpen
              onDirty={onDirty}
              onDecided={onDecided}
              onCancel={onToggle}
            />
          </div>
        ) : null}
      </div>
    </article>
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
          <Note>
            <span>
              <b>{`Approved ${String(out.approved.length)}.`}</b> Left alone:{' '}
              {out.skipped.map((x) => x.why).join(' ')}
            </span>
          </Note>
        ) : null,
      );
      await qc.invalidateQueries({ queryKey: ['moderation'] });
      await qc.invalidateQueries({ queryKey: ['board'] });
    },
  });
  return (
    <>
      <div className="bulkbar" role="region" aria-label="Selected reports">
        <span role="status">{`${String(picked.size)} selected`}</span>
        <div className="acts">
          {picked.size < pickable ? (
            <Btn sm flat onClick={onSelectAll}>{`Select all ${String(pickable)}`}</Btn>
          ) : null}
          <Btn sm flat look="ghost" onClick={onClear}>
            Select none
          </Btn>
          <Btn
            sm
            flat
            look="ink"
            disabled={approve.isPending}
            onClick={() => {
              approve.mutate();
            }}
          >
            {approve.isPending
              ? 'Approving…'
              : picked.size > MAX_BATCH
                ? `Approve the first ${String(MAX_BATCH)}`
                : 'Approve selected'}
          </Btn>
          <Btn
            sm
            flat
            onClick={() => {
              setDeclining(true);
            }}
          >
            Decline selected…
          </Btn>
        </div>
      </div>
      {approve.isError ? <Problem>{approve.error.message}</Problem> : null}
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
  const uid = useId();
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
          <Note>
            <span>
              <b>{`Declined ${String(out.declined.length)}.`}</b> Left alone:{' '}
              {out.skipped.map((x) => x.why).join(' ')}
            </span>
          </Note>
        ) : null,
      );
      await qc.invalidateQueries({ queryKey: ['moderation'] });
      await qc.invalidateQueries({ queryKey: ['board'] });
    },
  });
  return (
    <Modal
      title={`Decline ${n} selected`}
      description="Nobody is emailed when you decline in bulk."
      open={open}
      onClose={onClose}
      onSubmit={() => {
        if (!reason) {
          setProblem('Choose the reason. Each report is counted under it.');
          return;
        }
        decline.mutate();
      }}
      buttons={
        <>
          {/* Not the action colour: declining a page of reports is rarely what somebody came for. */}
          <Btn sm flat look="ink" type="submit" disabled={decline.isPending}>
            {decline.isPending ? 'Declining…' : `Decline ${n}`}
          </Btn>
          <Btn sm flat look="ghost" onClick={onClose}>
            Cancel
          </Btn>
        </>
      }
    >
      <p className="muted">
        Each report gets its own decision on the record, with your name and the time, and is counted
        publicly under this reason.
      </p>
      <div className="field">
        <label htmlFor={`${uid}-reason`}>Reason</label>
        <select
          id={`${uid}-reason`}
          className="sel"
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
        </select>
        <Err>{problem}</Err>
      </div>
      <div className="field">
        <label htmlFor={`${uid}-note`}>Note (optional, never sent)</label>
        <textarea
          id={`${uid}-note`}
          className="textarea"
          value={comment}
          maxLength={2000}
          onChange={(e) => {
            setComment(e.target.value);
          }}
        />
      </div>
      {decline.isError ? <Problem>{decline.error.message}</Problem> : null}
    </Modal>
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
    <Panel kind="quiet" title="Across the published reports">
      <p className="m">
        {String(d.published)} published. Reports count as corroborated only when a moderator linked
        them as the same incident, and only published ones are counted.
      </p>
      <div className="stats">
        {rows.map(([k, v]) => (
          <div className="mini-stat" key={k}>
            <b>{String(v)}</b>
            <span>{k}</span>
          </div>
        ))}
        {[...SEVERITIES, 'none' as const].map((k) => (
          <div className="mini-stat" key={k}>
            <b>{String(d.by_severity[k] ?? 0)}</b>
            <span>Rated: {SEVERITY_WORDS[k]?.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** "Linked with 2 other reports, 2 accounts published": never one bare number. */
export function corroborationWords(r: Pick<QueueItem, 'incident_size' | 'corroboration'>) {
  const others = r.incident_size - 1;
  return `Linked with ${String(others)} other report${others === 1 ? '' : 's'} · ${String(r.corroboration)} of the ${String(r.incident_size)} published`;
}
