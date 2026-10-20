/**
 * The moderation queue. Waiting reports first by default; a moderator's
 * search spans every state, because finding the declined ones is part of
 * the job. Contact details are never on this page: they open one report at a
 * time, with a reason the reporter is shown.
 *
 * A flagged report says which words asked for a second read. That is a
 * reading list, not a finding, and it is never shown to the public.
 */
import type { QueueItem } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
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
import { corroborationQuery, queueQuery } from './queries.ts';
import type { QueueSearch, QueueSeverity, QueueStatus } from './queries.ts';
import { SEVERITIES, SEVERITY_WORDS, STATUS_WORDS } from './words.ts';

const STATUSES: QueueStatus[] = ['pending', 'valid', 'unknown', 'invalid', 'withdrawn', 'all'];

export function QueuePage({ search }: { search: QueueSearch }) {
  const query = useQuery(queueQuery(search));
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
          <ul className="flex flex-col gap-3" aria-label="Reports">
            {query.data.reports.map((r) => (
              <li key={r.thread_id}>
                <Row r={r} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Corroboration />
    </Page>
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
  return (
    <form
      aria-label="Narrow the queue"
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void navigate({
          to: '/moderate',
          search: {
            status,
            ...(q.trim() ? { q: q.trim() } : {}),
            ...(flagged ? { flagged: true } : {}),
            ...(severity ? { severity } : {}),
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
      <Button type="submit">Show</Button>
    </form>
  );
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
      </span>
      <span className="line-clamp-2">{first}</span>
      <span className="text-sm font-semibold">
        {r.withdrawn ? STATUS_WORDS.withdrawn : STATUS_WORDS[r.moderation_status]}
        {r.public ? ' · on the board' : ''}
        {!r.may_publish ? ' · its reporter did not permit publishing' : ''}
        {r.needs_review ? ` · second read asked for: ${r.review_terms.join(', ')}` : ''}
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
