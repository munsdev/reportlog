/**
 * The moderation queue. Waiting reports first by default; a moderator's
 * search spans every state, because finding the declined ones is part of
 * the job. Contact details are never on this page: they open one report at a
 * time, with a reason the reporter is shown.
 *
 * A flagged report says which words asked for a second read. That is a
 * reading list, not a finding, and it is never shown to the public.
 */
import { REJECTION_REASONS, batchApproveReports, bulkDeclineReports } from '@reportlog/contracts';
import type { QueueItem } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { Field } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Page } from '../../components/ui/page.tsx';
import { Select } from '../../components/ui/select.tsx';
import { call } from '../../lib/api.ts';
import { corroborationQuery, queueQuery } from './queries.ts';
import type { QueueSearch, QueueSeverity, QueueStatus } from './queries.ts';
import { SEVERITIES, SEVERITY_WORDS, STATUS_WORDS } from './words.ts';

const STATUSES: QueueStatus[] = ['pending', 'valid', 'unknown', 'invalid', 'withdrawn', 'all'];

export function QueuePage({ search }: { search: QueueSearch }) {
  const query = useQuery(queueQuery(search));
  const client = useQueryClient();
  // M2: batch approval. Only reports that can be approved are offered a box.
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const batch = useMutation({
    mutationFn: () => call(batchApproveReports, { body: { thread_ids: [...picked] } }),
    onSuccess: async () => {
      setPicked(new Set());
      await client.invalidateQueries({ queryKey: ['moderation'] });
      await client.invalidateQueries({ queryKey: ['board'] });
    },
  });
  return (
    <Page
      title="Moderation"
      lede="Nothing is public until it is approved here, and only if its reporter permitted it. Every decision needs a reason, and every one can be revisited."
    >
      <QueueFilters key={JSON.stringify(search)} search={search} />
      {query.isPending ? <p role="status">Reading the queue…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data ? (
        <>
          {!query.data.archive_published ? (
            <Alert title="The public archive is switched off">
              Approving a report records the decision, but nothing is shown publicly until an
              administrator switches the archive back on.
            </Alert>
          ) : null}
          <p role="status">
            {query.data.reports.length === 0
              ? 'Nothing here.'
              : `${String(query.data.reports.length)} report${query.data.reports.length === 1 ? '' : 's'}`}
            {query.data.open_flags
              ? ` · ${String(query.data.open_flags)} waiting for a second read across the queue`
              : ''}
          </p>
          {picked.size ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                disabled={batch.isPending}
                onClick={() => {
                  batch.mutate();
                }}
              >
                {`Approve ${String(picked.size)} selected`}
              </Button>
              <span className="text-sm text-ink-alt">
                Each approval is recorded on its own report. No reason is asked: approving is the
                standard applied.
              </span>
            </div>
          ) : null}
          {query.data.reports.some(selectable) ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setPicked(new Set(query.data.reports.filter(selectable).map((r) => r.thread_id)));
                }}
              >
                Select all of these
              </Button>
              {picked.size ? (
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => {
                    setPicked(new Set());
                  }}
                >
                  Select none
                </Button>
              ) : null}
            </div>
          ) : null}
          <BulkDecline
            picked={picked}
            search={search}
            onDone={() => {
              setPicked(new Set());
            }}
          />
          {batch.isError ? <Alert tone="serious">{batch.error.message}</Alert> : null}
          {batch.data ? (
            <Alert tone={batch.data.skipped.length ? 'note' : 'confirmed'}>
              {`Approved ${String(batch.data.approved.length)}.`}
              {batch.data.skipped.length
                ? ` Left alone: ${batch.data.skipped.map((x) => x.why).join(' ')}`
                : ''}
            </Alert>
          ) : null}
          <ul className="flex flex-col gap-3" aria-label="Reports">
            {query.data.reports.map((r) => (
              <li key={r.thread_id} className="flex items-start gap-3">
                {selectable(r) ? (
                  <Checkbox
                    aria-label={`Select ${r.public_ref}`}
                    className="mt-4"
                    checked={picked.has(r.thread_id)}
                    onCheckedChange={(on) => {
                      setPicked((was) => {
                        const next = new Set(was);
                        if (on === true) next.add(r.thread_id);
                        else next.delete(r.thread_id);
                        return next;
                      });
                    }}
                  />
                ) : (
                  <span className="mt-4 size-6 shrink-0" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <Row r={r} />
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Corroboration />
    </Page>
  );
}

const selectable = (r: QueueItem) => r.moderation_status !== 'valid' && !r.withdrawn;

/**
 * Decline what is selected with one reason (Plan E). Each report still gets
 * its own decision row with who and when; no email is sent, because a
 * flood's addresses are whatever the flood typed. Asked twice: a reason,
 * then "Decline N", so one click never declines a page.
 *
 * The server asks for the second factor again (step-up); the API client
 * shows the prompt and sends this once more (lib/api.ts).
 */
function BulkDecline({
  picked,
  search,
  onDone,
}: {
  picked: ReadonlySet<string>;
  search: QueueSearch;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const decline = useMutation({
    mutationFn: () =>
      call(bulkDeclineReports, {
        body: {
          thread_ids: [...picked],
          reason_code: reason,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
          filter: Object.fromEntries(
            Object.entries(search).map(([k, v]) => [k, String(v)] as const),
          ),
        },
      }),
    onSuccess: async () => {
      onDone();
      await client.invalidateQueries({ queryKey: ['moderation'] });
      await client.invalidateQueries({ queryKey: ['board'] });
    },
  });
  // What was done stays on the screen after the selection empties.
  const result = decline.data ? (
    <Alert tone="confirmed">
      {`Declined ${String(decline.data.declined.length)}.`}
      {decline.data.skipped.length
        ? ` Left alone: ${decline.data.skipped.map((x) => x.why).join(' ')}`
        : ''}
    </Alert>
  ) : null;
  if (!picked.size) return result;
  return (
    <form
      aria-label="Decline the selected reports"
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        decline.mutate();
      }}
    >
      <h2 className="font-display text-lg font-bold">{`Decline ${String(picked.size)} selected`}</h2>
      <p className="text-sm text-ink-alt">
        One reason for all of them. Each report gets its own decision on the record, with your name
        and the time, and is counted publicly under this reason. No email is sent.
      </p>
      <Field>
        <Label>The reason</Label>
        <Select
          value={reason}
          required
          onChange={(e) => {
            setReason(e.target.value);
          }}
        >
          <option value="">Choose a reason</option>
          {REJECTION_REASONS.map((x) => (
            <option key={x.code} value={x.code}>
              {x.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field>
        <Label>For the record (optional, never sent)</Label>
        <Input
          value={comment}
          maxLength={2000}
          onChange={(e) => {
            setComment(e.target.value);
          }}
        />
      </Field>
      <Button type="submit" disabled={!reason || decline.isPending} className="self-start">
        {`Decline ${String(picked.size)}`}
      </Button>
      {decline.isError ? <Alert tone="serious">{decline.error.message}</Alert> : null}
      {result}
    </form>
  );
}

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
    <section
      aria-label="Corroboration"
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5"
    >
      <h2 className="font-display text-xl font-bold">Across the published reports</h2>
      <p className="text-sm text-ink-alt">
        {String(d.published)} published. Reports count as corroborated only when a moderator linked
        them as the same incident, and only published ones are counted.
      </p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt>{k}</dt>
            <dd className="text-right font-semibold">{String(v)}</dd>
          </div>
        ))}
        {[...SEVERITIES, 'none' as const].map((k) => (
          <div key={k} className="contents">
            <dt>Rated: {SEVERITY_WORDS[k]?.label}</dt>
            <dd className="text-right font-semibold">{String(d.by_severity[k] ?? 0)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function QueueFilters({ search }: { search: QueueSearch }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<QueueStatus>(search.status ?? 'pending');
  const [q, setQ] = useState(search.q ?? '');
  const [flagged, setFlagged] = useState(Boolean(search.flagged));
  const [severity, setSeverity] = useState<QueueSeverity | ''>(search.severity ?? '');
  const [from, setFrom] = useState(local(search.from));
  const [to, setTo] = useState(local(search.to));
  const [place, setPlace] = useState(search.place ?? '');
  const [lane, setLane] = useState<'' | 'organization' | 'open_form'>(search.lane ?? '');
  return (
    <form
      aria-label="Narrow the queue"
      className="flex flex-col flex-wrap gap-4 rounded-card border border-line bg-surface p-4 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void navigate({
          to: '/moderate',
          search: {
            status,
            ...(q.trim() ? { q: q.trim() } : {}),
            ...(flagged ? { flagged: true } : {}),
            ...(severity ? { severity } : {}),
            ...(from ? { from: new Date(from).toISOString() } : {}),
            ...(to ? { to: new Date(to).toISOString() } : {}),
            ...(place.trim() ? { place: place.trim().toUpperCase() } : {}),
            ...(lane ? { lane } : {}),
            // Kept from the flood screen's links until cleared.
            ...(search.answer_set ? { answer_set: search.answer_set } : {}),
            ...(search.organization ? { organization: search.organization } : {}),
          },
        });
      }}
    >
      <Field>
        <Label>Showing</Label>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as QueueStatus);
          }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_WORDS[s]}
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
          <option value="">Any</option>
          {[...SEVERITIES, 'none' as const].map((k) => (
            <option key={k} value={k}>
              {SEVERITY_WORDS[k]?.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field className="flex-1">
        <Label>Search the words or a reference</Label>
        <Input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
          }}
        />
      </Field>
      <div className="flex items-center gap-2 pb-2">
        <Checkbox
          id="only-flagged"
          checked={flagged}
          onCheckedChange={(v) => {
            setFlagged(v === true);
          }}
        />
        <Label htmlFor="only-flagged">Only those waiting for a second read</Label>
      </div>
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
        <Input
          value={place}
          placeholder="US-AZ or US-AZ-04013"
          maxLength={16}
          onChange={(e) => {
            setPlace(e.target.value);
          }}
        />
      </Field>
      <Field>
        <Label>Filed</Label>
        <Select
          value={lane}
          onChange={(e) => {
            setLane(e.target.value as typeof lane);
          }}
        >
          <option value="">Either way</option>
          <option value="organization">By an organization</option>
          <option value="open_form">Through the open form</option>
        </Select>
      </Field>
      {search.answer_set || search.organization ? (
        <p className="text-sm">
          {search.answer_set ? 'Showing one identical answer set. ' : ''}
          {search.organization ? 'Showing one organization’s reports. ' : ''}
          <Link
            to="/moderate"
            search={{ status: search.status ?? 'pending' }}
            className="underline"
          >
            Clear
          </Link>
        </p>
      ) : null}
      <Button type="submit">Show</Button>
    </form>
  );
}

/** An ISO time as a datetime-local input's value, in this browser's zone. */
function local(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Row({ r }: { r: QueueItem }) {
  const first = Object.values(r.answers).find((v): v is string => typeof v === 'string') ?? '';
  return (
    <Link
      to="/moderate/$threadId"
      params={{ threadId: r.thread_id }}
      className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4 hover:bg-paper-alt"
    >
      {/* Named by everything it shows, "Open" first: an aria-label of its own
          would hide the visible words from somebody who says them (WCAG 2.5.3). */}
      <span className="sr-only">Open </span>
      <span className="text-sm text-ink-alt">
        <span className="font-mono">{r.public_ref}</span> · {r.logbook_title} ·{' '}
        {new Date(r.received_at).toLocaleString()}
        {r.versions > 1 ? ` · version ${String(r.versions)}` : ''}
        {r.origin === 'organization'
          ? ` · filed by ${r.filed_via ?? 'an organization'}`
          : ' · open form'}
      </span>
      <span className="line-clamp-2">{first}</span>
      <span className="text-sm font-semibold">
        {r.withdrawn ? STATUS_WORDS.withdrawn : STATUS_WORDS[r.moderation_status]}
        {r.public ? ' · on the board' : ''}
        {!r.may_publish ? ' · its reporter did not permit publishing' : ''}
        {r.needs_review ? ` · second read asked for: ${r.review_terms.join(', ')}` : ''}
        {r.threat_open ? ' · FLAGGED: threat to life or safety' : ''}
      </span>
      {r.severity || r.incident_size > 1 ? (
        <span className="text-sm">
          {r.severity ? `Severity: ${SEVERITY_WORDS[r.severity]?.label ?? r.severity}` : ''}
          {r.severity && r.incident_size > 1 ? ' · ' : ''}
          {r.incident_size > 1 ? corroborationWords(r) : ''}
        </span>
      ) : null}
    </Link>
  );
}

/** "Linked with 2 other reports, 2 accounts published": never one bare number. */
export function corroborationWords(r: Pick<QueueItem, 'incident_size' | 'corroboration'>) {
  const others = r.incident_size - 1;
  return `Linked with ${String(others)} other report${others === 1 ? '' : 's'} · ${String(r.corroboration)} of the ${String(r.incident_size)} published`;
}
