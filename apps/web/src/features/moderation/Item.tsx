/**
 * One report under moderation (docs/design/screens/moderation.md section 03):
 * the decision first, everything else as closed rows that show what is set.
 *
 * Every act here records a new row; nothing edits or deletes the report.
 * "Change the decision" is another decision on top, and The record shows
 * them all, oldest first. Every act asks for a reason, except saying a
 * flagged report has been read: the flag is a reading list, and asking people
 * to justify having read something is how a queue stops being cleared.
 *
 * WHO FILED IT (Tier B, decision 58): moderators and administrators may look,
 * as the server's guard already allows. Every look needs a step-up (the API
 * client asks when the server says so), a written reason, and writes an
 * access_log row before anything is shown. Closing the row without a reason
 * sends nothing, so it writes nothing and shows nothing.
 *
 * On a desktop two columns, the Decide panel heading the right one; on a phone
 * one column and a bar at the foot with Approve… and Decline…, each opening
 * the same Decide form in a sheet with that choice made.
 */
import { roleSatisfies } from '@reportlog/access';
import {
  addNoteLink,
  clearThreat,
  linkReportIncident,
  markReportRead,
  openReportContact,
  raiseThreat,
  removeNoteLink,
  restoreReport,
  setNoteState,
  setReportSeverity,
  withdrawReport,
  writeReportNote,
} from '@reportlog/contracts';
import type { QueueItem, ResponseOf, getQueueItem, getReportNote } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { BottomBar } from '@/components/ui/bottom-bar.tsx';
import type { ReactNode } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card } from '../../components/ui/card.tsx';
import { Chip } from '../../components/ui/chip.tsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog.tsx';
import { Field, FieldDescription, FieldError } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { KeyValueList } from '../../components/ui/key-value-list.tsx';
import { Label } from '../../components/ui/label.tsx';
import { RadioGroup, RadioOption } from '../../components/ui/radio-group.tsx';
import { Select } from '../../components/ui/select.tsx';
import { SettingPanels, useSettingPanels } from '../../components/ui/setting-panel.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { ToastProvider, useToast } from '../../components/ui/toast.tsx';
import { call } from '../../lib/api.ts';
import { EvidenceRequests, evidenceSummary } from '../files/staff/EvidenceRequests.tsx';
import { ReportFiles } from '../files/staff/ReportFiles.tsx';
import { evidenceQuery } from '../files/staff/queries.ts';
import { useMe } from '../identity/session.ts';
import { ClosedRow } from './ClosedRow.tsx';
import { ReportWritten } from './Texts.tsx';
import { DECIDED_WORDS, DecideForm, NOTICE_WORDS } from './DecideForm.tsx';
import { Meta } from '../../components/ui/type.tsx';
import type { Decided, Decision } from './DecideForm.tsx';
import { AnswerList, StaffHead, StatusChip, useWide, waited, when } from './parts.tsx';
import { noteQuery, queueItemQuery, queueQuery } from './queries.ts';
import type { QueueSearch } from './queries.ts';
import { ACTION_WORDS, SEVERITIES, SEVERITY_WORDS, STATUS_WORDS } from './words.ts';

type Item = ResponseOf<typeof getQueueItem>;
type Assessment = Item['assessment'];
type History = Item['history'];

/** A mutation that refreshes the queue and the board when it lands. */
function useAct<T>(fn: (input: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['moderation'] });
      await qc.invalidateQueries({ queryKey: ['board'] });
    },
  });
}

function Problem({ error }: { error: Error | null }) {
  return error ? <Alert tone="serious">{error.message}</Alert> : null;
}

/** The last time staff did this to the report: "by mod@example.org, 3 Nov 14:40". */
function lastBy(history: History, action: string): string {
  const h = [...history].reverse().find((x) => x.action === action && x.by === 'staff');
  return h ? ` Set by ${h.actor_email ?? 'staff'}, ${when(h.created_at)}.` : '';
}

export function ItemPage({ threadId, search = {} }: { threadId: string; search?: QueueSearch }) {
  return (
    <ToastProvider>
      <SettingPanels>
        <ItemScreen threadId={threadId} search={search} />
      </SettingPanels>
    </ToastProvider>
  );
}

function ItemScreen({ threadId, search }: { threadId: string; search: QueueSearch }) {
  const query = useQuery(queueItemQuery(threadId));
  const wide = useWide(1024);
  const panels = useSettingPanels();
  const toast = useToast();
  const [decided, setDecided] = useState<Decided | null>(null);
  const [sheet, setSheet] = useState<Decision | null>(null);

  const onDecided = useCallback(
    (d: Decided, ref: string) => {
      setDecided(d);
      setSheet(null);
      toast.show(`${ref} ${DECIDED_WORDS[d.status]}.`);
    },
    [toast],
  );

  const back = (
    <Button asChild variant="quiet" className="-ml-2 self-start">
      <Link to="/moderate" search={search}>
        Back to the queue
      </Link>
    </Button>
  );

  if (query.isPending) return <p role="status">Reading the report…</p>;
  if (query.isError) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <StaffHead title="Not found" />
        <Alert tone="serious">{query.error.message}</Alert>
      </div>
    );
  }
  const { report: r, history, assessment } = query.data;
  const state = r.withdrawn ? STATUS_WORDS.withdrawn : STATUS_WORDS[r.moderation_status];
  const eyebrow =
    r.moderation_status === 'pending' && !r.withdrawn
      ? `${r.logbook_title} · waiting ${waited(r.received_at)}`
      : `${r.logbook_title} · ${state ?? ''}`;

  // The mock-up's order: eyebrow, the reference, the way back, where it
  // stands in one line, then its chips.
  const head = (
    <StaffHead title={r.public_ref} mono>
      {back}
      <Meta>{eyebrow}</Meta>
      <div className="flex flex-wrap gap-1.5">
        <StatusChip r={r} />
        <Chip tone="tag">{r.public ? 'Public' : 'Not public'}</Chip>
        {r.needs_review ? <Chip tone="tag">Second read</Chip> : null}
        {r.reporter_withdrew ? <Chip tone="tag">Withdrawn by its reporter</Chip> : null}
        {r.threat_open ? <Chip tone="serious">Threat to safety</Chip> : null}
      </div>
    </StaffHead>
  );

  const said = (
    <>
      <Said r={r} />
      <ReportWritten threadId={r.thread_id} />
    </>
  );
  const files =
    r.file_count > 0 ? (
      <ReportFiles
        threadId={r.thread_id}
        reportPublic={r.public}
        reportApproved={r.moderation_status === 'valid'}
      />
    ) : null;
  const rows = <Rows r={r} a={assessment} history={history} />;
  const record = <TheRecord r={r} history={history} />;
  const decide = (
    <DecidePanel
      r={r}
      history={history}
      search={search}
      decided={decided}
      onDecided={(d) => {
        onDecided(d, r.public_ref);
      }}
    />
  );

  if (wide) {
    return (
      <div className="flex flex-col gap-6">
        {head}
        <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,4fr)] items-start gap-6">
          <div className="flex min-w-0 flex-col gap-6">
            {said}
            {files}
            {record}
          </div>
          {/* Not sticky, though moderation.md asked for a sticky Decide panel:
              sticky alone, the rows under it slid beneath it and could not be
              pressed; a sticky, self-scrolling column hid its own controls
              from the pointer. The panel heads the column instead. */}
          <div className="flex min-w-0 flex-col gap-6">
            {decide}
            {rows}
          </div>
        </div>
      </div>
    );
  }

  const canDecide = !r.withdrawn;
  return (
    <div className="flex flex-col gap-6">
      {head}
      {r.withdrawn || decided ? decide : null}
      {said}
      {files}
      {rows}
      {record}
      {canDecide && panels.openId === null ? (
        <>
          {/* Room for the bar, so the last row can be scrolled clear of it. */}
          <div aria-hidden="true" className="h-20" />
          <BottomBar
            role="region"
            aria-label="Decide"
            className="fixed inset-x-0 bottom-0 z-30 border-t-[6px] border-brand-on-deep bg-deep text-on-deep print:hidden"
          >
            <div className="mx-auto flex max-w-page items-center gap-2 px-[max(1rem,env(safe-area-inset-left))] py-3">
              <Button
                className="flex-1"
                onClick={() => {
                  setSheet('valid');
                }}
              >
                Approve…
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  setSheet('invalid');
                }}
              >
                Decline…
              </Button>
            </div>
          </BottomBar>
        </>
      ) : null}
      <Dialog
        open={sheet !== null}
        onOpenChange={(on) => {
          if (!on) setSheet(null);
        }}
      >
        {/* A sheet from the foot of the screen, where the thumb already is. */}
        <DialogContent className="top-auto bottom-0 left-0 max-h-[90dvh] w-full max-w-none translate-x-0 translate-y-0 rounded-b-none">
          <DialogHeader>
            <DialogTitle>Decide {r.public_ref}</DialogTitle>
          </DialogHeader>
          <DecideForm
            key={sheet ?? ''}
            report={r}
            initial={sheet ?? undefined}
            onDecided={(d) => {
              onDecided(d, r.public_ref);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── what the reporter said ──────────────────────────────────────────────

function Said({ r }: { r: QueueItem }) {
  return (
    <Card heading="What the reporter said">
      <AnswerList slug={r.logbook_slug} answers={r.answers} />
      <p className="text-sm text-ink-alt">
        Filed {when(r.received_at)}
        {r.versions > 1 ? `, version ${String(r.versions)} (corrected by its reporter)` : ''}
        {r.filed_via ? `, through ${r.filed_via}` : ''}.{' '}
        {r.may_publish
          ? 'Its reporter permitted publication.'
          : 'Its reporter did not permit publication: approving it records the judgement, and it stays off the board.'}
      </p>
    </Card>
  );
}

// ── the decision ───────────────────────────────────────────────────────

function DecidePanel({
  r,
  history,
  search,
  decided,
  onDecided,
}: {
  r: QueueItem;
  history: History;
  search: QueueSearch;
  decided: Decided | null;
  onDecided: (d: Decided) => void;
}) {
  // A new form after each decision, so changing it again starts clean.
  const [round, setRound] = useState(0);
  if (r.reporter_withdrew) {
    const at = [...history].reverse().find((h) => h.by === 'reporter' && h.action === 'withdraw');
    return (
      <Card variant="deep" heading="Withdrawn by its reporter">
        <p>
          {`Withdrawn by its reporter${at ? ` on ${when(at.created_at)}` : ''}. It is off the board and cannot be put back by a moderator.`}
        </p>
      </Card>
    );
  }
  if (r.withdrawn) {
    return (
      <Card variant="deep" heading="Taken off the board">
        <p>
          A moderator took it off the board. Put it back (below) as waiting or with a decision
          before deciding it again.
        </p>
      </Card>
    );
  }
  return (
    <Card heading="Decide">
      {decided ? (
        <>
          <Alert tone="done">
            Recorded. {decided.notice === 'none' ? '' : (NOTICE_WORDS[decided.notice] ?? '')}
          </Alert>
          <NextWaiting current={r.thread_id} search={search} />
        </>
      ) : null}
      {r.moderation_status === 'pending' ? null : (
        <p className="text-sm text-ink-alt">
          Now: {STATUS_WORDS[r.moderation_status]}. A new decision is recorded on top; the earlier
          one stays on the record.
        </p>
      )}
      <DecideForm
        key={round}
        report={r}
        onDecided={(d) => {
          setRound((n) => n + 1);
          onDecided(d);
        }}
      />
    </Card>
  );
}

/** The next waiting report in the queue's own order and filters, or a sentence saying there is none. */
function NextWaiting({ current, search }: { current: string; search: QueueSearch }) {
  const navigate = useNavigate();
  const waiting = { ...search, status: 'pending' as const, page: undefined };
  const query = useQuery(queueQuery(waiting));
  const next = query.data?.reports.find((x) => x.thread_id !== current);
  if (query.isPending) return null;
  if (!next) return <p className="text-sm text-ink-alt">Nothing else is waiting in this queue.</p>;
  return (
    <Button
      variant="secondary"
      block
      onClick={() => {
        void navigate({
          to: '/moderate/$threadId',
          params: { threadId: next.thread_id },
          search,
        });
      }}
    >
      Next waiting report
    </Button>
  );
}

// ── the closed rows ─────────────────────────────────────────────────────

function Rows({ r, a, history }: { r: QueueItem; a: Assessment; history: History }) {
  return (
    <div className="flex flex-col gap-4">
      <SeverityRow r={r} a={a} history={history} />
      <ThreatRow r={r} />
      <IncidentRow r={r} a={a} />
      {r.needs_review ? <SecondReadRow r={r} /> : null}
      <EvidenceRow r={r} />
      {r.notes_enabled ? <NoteRow r={r} /> : null}
      {r.reporter_withdrew ? null : <BoardRow r={r} />}
      {r.has_contact ? <WhoFiledRow r={r} /> : null}
    </div>
  );
}

/**
 * How serious it is. A moderator's judgement, never part of the report's
 * seal. An unrated report opens with nothing chosen, so saving is a
 * deliberate act rather than a default sliding through.
 */
function SeverityRow({ r, a, history }: { r: QueueItem; a: Assessment; history: History }) {
  const [severity, setSeverity] = useState('');
  const [comment, setComment] = useState('');
  const [problem, setProblem] = useState('');
  const save = useAct(() =>
    call(setReportSeverity, { params: { threadId: r.thread_id }, body: { severity, comment } }),
  );
  const reset = useCallback(() => {
    setSeverity('');
    setComment('');
    setProblem('');
    save.reset();
  }, [save]);
  const current = a.severity ? SEVERITY_WORDS[a.severity] : null;
  return (
    <ClosedRow
      id="severity"
      title="Severity"
      action="Edit"
      summary={
        <p>
          {current ? `${current.label}: ${current.hint}.` : 'Not set.'}
          {current ? lastBy(history, 'severity') : ''}
        </p>
      }
      dirty={severity !== '' || comment !== ''}
      onCancel={reset}
      saveLabel="Record the rating"
      onSave={async () => {
        if (!severity) {
          setProblem('Choose a rating, or clear it.');
          return false;
        }
        await save.mutateAsync(undefined);
        reset();
      }}
    >
      <p className="text-sm text-ink-alt">
        A moderator’s judgement, kept beside the report and never part of what was sealed.
      </p>
      <Field>
        <Label>{a.severity ? 'Change it to' : 'Rate it'}</Label>
        <Select
          value={severity}
          onChange={(e) => {
            setSeverity(e.target.value);
            setProblem('');
          }}
        >
          <option value="">Choose…</option>
          {SEVERITIES.map((k) => (
            <option key={k} value={k}>
              {SEVERITY_WORDS[k]?.label} ({SEVERITY_WORDS[k]?.hint})
            </option>
          ))}
          {a.severity ? <option value="none">Clear the rating</option> : null}
        </Select>
        <FieldError>{problem}</FieldError>
      </Field>
      <Field>
        <Label>Why this rating</Label>
        <FieldDescription>Kept on the record with your name. Not shown publicly.</FieldDescription>
        <Textarea
          rows={2}
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
          }}
        />
      </Field>
      <Problem error={save.error} />
    </ClosedRow>
  );
}

/**
 * D5: a threat to life or safety. Its own flag, not the severity rating: this
 * one emails the owner at once and is kept as a record (raising and clearing
 * are both rows). It says what the threat is in a sentence the owner reads.
 */
function ThreatRow({ r }: { r: QueueItem }) {
  const [note, setNote] = useState('');
  const [unsent, setUnsent] = useState(false);
  const act = useAct(async () => {
    const body = { subject_kind: 'report' as const, subject_ref: r.thread_id, note };
    if (r.threat_open) {
      await call(clearThreat, { body });
      setUnsent(false);
      return;
    }
    setUnsent(!(await call(raiseThreat, { body })).owner_emailed);
  });
  const reset = useCallback(() => {
    setNote('');
    act.reset();
  }, [act]);
  return (
    <ClosedRow
      id="threat"
      title="Threat to life or safety"
      action="Edit"
      summary={
        <>
          <p>{r.threat_open ? 'Yes. The owner was emailed when it was flagged.' : 'No.'}</p>
          {unsent ? (
            <Alert tone="serious" className="mt-2">
              The flag is raised, but the email to the owner could not be sent. Tell them another
              way.
            </Alert>
          ) : null}
        </>
      }
      dirty={note !== ''}
      onCancel={reset}
      saveLabel={r.threat_open ? 'Clear the flag' : 'Flag it'}
      onSave={async () => {
        await act.mutateAsync(undefined);
        setNote('');
      }}
    >
      <p className="text-sm text-ink-alt">
        {r.threat_open
          ? 'This report is flagged. The owner was emailed when it was.'
          : 'Flag it if what it describes puts somebody’s life or safety at risk now. The owner is emailed at once. This is not the severity rating.'}
      </p>
      <Field>
        <Label>{r.threat_open ? 'Why is it no longer open?' : 'What is the threat?'}</Label>
        <FieldDescription>
          {r.threat_open ? 'Kept on the record.' : 'The owner reads this. Keep it short.'}
        </FieldDescription>
        <Textarea
          rows={2}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
      </Field>
      <Problem error={act.error} />
    </ClosedRow>
  );
}

/**
 * Reports describing the same real-world incident, linked by hand. Never
 * inferred: a clustering mistake would overstate corroboration, the number
 * most likely to be quoted.
 */
function IncidentRow({ r, a }: { r: QueueItem; a: Assessment }) {
  const [mode, setMode] = useState<'link' | 'unlink'>('link');
  const [ref, setRef] = useState('');
  const [comment, setComment] = useState('');
  const [problem, setProblem] = useState('');
  const link = useAct(() =>
    call(linkReportIncident, {
      params: { threadId: r.thread_id },
      body: { ...(mode === 'unlink' ? {} : { link_to: ref.trim() }), comment },
    }),
  );
  const reset = useCallback(() => {
    setMode('link');
    setRef('');
    setComment('');
    setProblem('');
    link.reset();
  }, [link]);
  const total = a.linked.length + 1;
  const summary = a.incident_id ? (
    <div className="flex flex-col gap-1">
      <p>
        Linked with {a.linked.map((l) => l.public_ref).join(', ')}.{' '}
        {`${String(a.published_accounts)} of the ${String(total)} accounts are published.`}
      </p>
    </div>
  ) : (
    <p>Not linked.</p>
  );
  return (
    <ClosedRow
      id="incident"
      title="Same incident"
      action="Link"
      summary={summary}
      dirty={ref !== '' || comment !== '' || mode !== 'link'}
      onCancel={reset}
      saveLabel={mode === 'unlink' ? 'Unlink it' : 'Link them'}
      onSave={async () => {
        if (mode === 'link' && !ref.trim()) {
          setProblem('Write the other report’s reference.');
          return false;
        }
        await link.mutateAsync(undefined);
        reset();
      }}
    >
      {a.incident_id ? (
        <>
          <p>
            {`Only the ${String(a.published_accounts)} published of these ${String(total)} accounts count as corroboration a reader can check.`}
          </p>
          <ul className="flex flex-col gap-1 text-sm" aria-label="Linked reports">
            {a.linked.map((l) => (
              <li key={l.thread_id}>
                <Link
                  to="/moderate/$threadId"
                  params={{ threadId: l.thread_id }}
                  className="font-mono underline"
                >
                  {l.public_ref}
                </Link>{' '}
                · {l.withdrawn ? STATUS_WORDS.withdrawn : STATUS_WORDS[l.moderation_status]}
                {l.published ? ' · published' : ' · not published'}
              </li>
            ))}
          </ul>
          <Field>
            <Label>What to do</Label>
            <RadioGroup
              value={mode}
              onValueChange={(v) => {
                setMode(v as 'link' | 'unlink');
                setProblem('');
              }}
            >
              <RadioOption value="link" label="Move it to another report’s incident" />
              <RadioOption value="unlink" label="Unlink this report" />
            </RadioGroup>
          </Field>
        </>
      ) : null}
      {mode === 'link' ? (
        <Field>
          <Label>Link it to</Label>
          <FieldDescription>
            The other report’s reference. If it is already linked to others, this one joins them.
          </FieldDescription>
          <Input
            value={ref}
            onChange={(e) => {
              setRef(e.target.value);
              setProblem('');
            }}
          />
          <FieldError>{problem}</FieldError>
        </Field>
      ) : null}
      <Field>
        <Label>
          {mode === 'unlink' ? 'Why it is not the same incident' : 'Why they are the same incident'}
        </Label>
        <FieldDescription>Kept on the record with your name. Not shown publicly.</FieldDescription>
        <Textarea
          rows={2}
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
          }}
        />
      </Field>
      <Problem error={link.error} />
    </ClosedRow>
  );
}

function SecondReadRow({ r }: { r: QueueItem }) {
  const read = useAct(() => call(markReportRead, { params: { threadId: r.thread_id } }));
  const reset = useCallback(() => {
    read.reset();
  }, [read]);
  return (
    <ClosedRow
      id="second-read"
      title="Second read"
      action="Clear"
      summary={<p>{`Asked for by the word list: ${r.review_terms.join(', ')}.`}</p>}
      onCancel={reset}
      saveLabel="I have read it"
      onSave={() => read.mutateAsync(undefined)}
    >
      <p>
        Its words matched: <span className="font-semibold">{r.review_terms.join(', ')}</span>. This
        is a reading list, not a finding about the report or anybody in it. Clearing it says you
        have read the report; no reason is asked.
      </p>
      <Problem error={read.error} />
    </ClosedRow>
  );
}

function EvidenceRow({ r }: { r: QueueItem }) {
  const query = useQuery(evidenceQuery(r.thread_id));
  return (
    <ClosedRow
      id="evidence"
      title="Ask for evidence"
      action="Ask"
      summary={<p>{query.isError ? query.error.message : evidenceSummary(query.data)}</p>}
    >
      <EvidenceRequests threadId={r.thread_id} bare />
    </ClosedRow>
  );
}

function NoteRow({ r }: { r: QueueItem }) {
  const query = useQuery(noteQuery(r.thread_id));
  const me = useMe();
  const isAdmin = me.data?.signedIn ? roleSatisfies(me.data.roles, 'admin') : false;
  const [body, setBody] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const [problem, setProblem] = useState('');
  const write = useAct(() =>
    call(writeReportNote, {
      params: { threadId: r.thread_id },
      body: { body: body ?? '', ...(why.trim() ? { revision_reason: why } : {}) },
    }),
  );
  const reset = useCallback(() => {
    setBody(null);
    setWhy('');
    setProblem('');
    write.reset();
  }, [write]);
  const note = query.data?.note ?? null;
  const links = query.data?.links ?? [];
  const stateWords =
    note?.state === 'under_review'
      ? 'under editorial review'
      : note?.state === 'withdrawn'
        ? 'withdrawn'
        : 'published';
  return (
    <ClosedRow
      id="note"
      title="The archive’s note"
      action={note ? 'Revise' : 'Write'}
      summary={
        <p>
          {query.isError
            ? query.error.message
            : note
              ? `Version ${String(note.versions)}, ${stateWords}. Last written ${when(note.written_at)}.`
              : 'None.'}
        </p>
      }
      dirty={body !== null || why !== ''}
      onCancel={reset}
      saveLabel={note ? 'Publish the revision' : 'Publish the note'}
      onSave={async () => {
        if (!body?.trim()) {
          setProblem(note ? 'Change the note before publishing a revision.' : 'Write the note.');
          return false;
        }
        if (note && !why.trim()) {
          setProblem('Say why it is being revised. Every version stays on the record.');
          return false;
        }
        await write.mutateAsync(undefined);
        reset();
      }}
    >
      <p className="text-sm text-ink-alt">
        Published under the archive’s name, never yours. Every version stays on the record, so a
        revision shows as one.
      </p>
      <Field>
        <Label>{note ? `The note (version ${String(note.versions)})` : 'The note'}</Label>
        <FieldDescription>Plain text. A blank line starts a new paragraph.</FieldDescription>
        <Textarea
          rows={6}
          value={body ?? note?.body ?? ''}
          onChange={(e) => {
            setBody(e.target.value);
            setProblem('');
          }}
        />
      </Field>
      {note ? (
        <Field>
          <Label>Why it is being revised</Label>
          <Input
            value={why}
            onChange={(e) => {
              setWhy(e.target.value);
              setProblem('');
            }}
          />
        </Field>
      ) : null}
      {problem ? <Alert tone="serious">{problem}</Alert> : null}
      <Problem error={write.error} />
      {note ? <Citations threadId={r.thread_id} links={links} /> : null}
      {note && isAdmin ? <NoteState threadId={r.thread_id} current={note.state} /> : null}
    </ClosedRow>
  );
}

function Citations({
  threadId,
  links,
}: {
  threadId: string;
  links: ResponseOf<typeof getReportNote>['links'];
}) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const add = useAct(() => call(addNoteLink, { params: { threadId }, body: { title, url } }));
  const remove = useAct((id: number) => call(removeNoteLink, { params: { threadId, id } }));
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 className="font-semibold">Sources cited</h3>
      {links.length ? (
        <ul className="flex flex-col gap-1">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2">
              <a href={l.url} rel="noopener noreferrer nofollow" className="underline">
                {l.title}
              </a>
              <Button
                variant="quiet"
                aria-label={`Withdraw ${l.title}`}
                onClick={() => {
                  remove.mutate(l.id);
                }}
              >
                Withdraw
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">None yet.</p>
      )}
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate(undefined, {
            onSuccess: () => {
              setTitle('');
              setUrl('');
            },
          });
        }}
      >
        <Field className="flex-1">
          <Label>Title</Label>
          <Input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
        </Field>
        <Field className="flex-1">
          <Label>Address (http or https)</Label>
          <Input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
            }}
          />
        </Field>
        <Button type="submit" variant="secondary" busy={add.isPending} busyLabel="Citing…">
          Cite it
        </Button>
      </form>
      <Problem error={add.error ?? remove.error} />
    </div>
  );
}

function NoteState({ threadId, current }: { threadId: string; current: string }) {
  const [state, setState] = useState(current);
  const [comment, setComment] = useState('');
  const change = useAct(() =>
    call(setNoteState, { params: { threadId }, body: { state, comment } }),
  );
  return (
    <form
      className="flex flex-col gap-2 border-t border-line pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        change.mutate(undefined);
      }}
    >
      <h3 className="font-semibold">The note’s state (administrators)</h3>
      <p className="text-sm text-ink-alt">
        A note is not taken down when its report is withdrawn. Taking it down is a decision recorded
        here.
      </p>
      <Field>
        <Label>State</Label>
        <Select
          value={state}
          onChange={(e) => {
            setState(e.target.value);
          }}
        >
          <option value="published">Published</option>
          <option value="under_review">Under editorial review</option>
          <option value="withdrawn">Withdrawn</option>
        </Select>
      </Field>
      <Field>
        <Label>Why</Label>
        <Input
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
          }}
        />
      </Field>
      <Problem error={change.error} />
      <Button
        type="submit"
        variant="secondary"
        className="self-start"
        busy={change.isPending}
        busyLabel="Changing…"
      >
        Change the state
      </Button>
    </form>
  );
}

function BoardRow({ r }: { r: QueueItem }) {
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState('pending');
  const [problem, setProblem] = useState('');
  const withdraw = useAct(() =>
    call(withdrawReport, { params: { threadId: r.thread_id }, body: { comment } }),
  );
  const restore = useAct(() =>
    call(restoreReport, { params: { threadId: r.thread_id }, body: { status, comment } }),
  );
  const act = r.withdrawn ? restore : withdraw;
  const reset = useCallback(() => {
    setComment('');
    setStatus('pending');
    setProblem('');
    withdraw.reset();
    restore.reset();
  }, [withdraw, restore]);
  const now = r.withdrawn
    ? 'Taken off the board by a moderator.'
    : r.public
      ? 'On the board.'
      : 'Not on the board.';
  return (
    <ClosedRow
      id="board"
      title={r.withdrawn ? 'Put it back' : 'Take it off the board'}
      action={r.withdrawn ? 'Put back' : 'Take off'}
      summary={<p>{now}</p>}
      dirty={comment !== '' || status !== 'pending'}
      onCancel={reset}
      saveLabel={r.withdrawn ? 'Put it back' : 'Withdraw it'}
      onSave={async () => {
        if (!comment.trim()) {
          setProblem('Give a reason. It stays on the record.');
          return false;
        }
        await act.mutateAsync(undefined);
        reset();
      }}
    >
      {r.withdrawn ? (
        <Field>
          <Label>It goes back as</Label>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
            }}
          >
            <option value="pending">Waiting for a moderator</option>
            <option value="valid">Approved</option>
            <option value="invalid">Declined</option>
            <option value="unknown">Unclear</option>
          </Select>
        </Field>
      ) : (
        <p className="text-sm text-ink-alt">
          Nothing is deleted: the report stays in the archive and still verifies.
        </p>
      )}
      <Field>
        <Label>{r.withdrawn ? 'Why it goes back' : 'Why it comes off'}</Label>
        <Textarea
          rows={2}
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
            setProblem('');
          }}
        />
        <FieldError>{problem}</FieldError>
      </Field>
      <Problem error={act.error} />
    </ClosedRow>
  );
}

type Contact = ResponseOf<typeof openReportContact>['contact'];

/**
 * Who filed it (Tier B). Nothing is sent until there is a reason, so closing
 * the row with none writes nothing and shows nothing. The server records the
 * look (access_log) before it opens anything, and asks for the second factor
 * again first; the reporter is later shown the reason and when, never who.
 */
function WhoFiledRow({ r }: { r: QueueItem }) {
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState('');
  const [opened, setOpened] = useState<Contact | null>(null);
  const open = useMutation({
    mutationFn: () =>
      call(openReportContact, {
        params: { threadId: r.thread_id },
        body: { reason: reason.trim() },
      }),
    onSuccess: (d) => {
      setOpened(d.contact);
    },
  });
  const reset = useCallback(() => {
    setReason('');
    setProblem('');
    open.reset();
  }, [open]);
  const summary: ReactNode = opened ? (
    <div className="flex flex-col gap-2">
      {opened.erased ? (
        <p>The reporter had their contact details erased. There is nothing to read.</p>
      ) : (
        <KeyValueList
          items={[
            {
              key:
                opened.filed_by === 'coordinator' ? 'The coordinator who filed it' : 'The reporter',
              value: opened.email,
              mono: true,
            },
            ...(opened.organization ? [{ key: 'For', value: opened.organization }] : []),
          ]}
        />
      )}
      <p className="text-sm text-ink-alt">This look was recorded.</p>
    </div>
  ) : (
    <p>Restricted. Every look is logged with your reason.</p>
  );
  return (
    <ClosedRow
      id="who-filed"
      title="Who filed it"
      action="Look…"
      summary={summary}
      dirty={reason !== ''}
      onCancel={reset}
      saveLabel="Open the details"
      onSave={async () => {
        if (reason.trim().length < 10) {
          setProblem('Say why you need them, in a sentence. The reporter is shown it.');
          return false;
        }
        await open.mutateAsync();
        setReason('');
      }}
    >
      <p className="text-sm text-ink-alt">
        You may be asked for your second factor again first. Nothing is opened until you give a
        reason.
      </p>
      <Field>
        <Label>Why you need them</Label>
        <FieldDescription>
          The reporter is shown this reason, word for word, and when you opened them. Your name is
          not shown to them; it is kept for administrators.
        </FieldDescription>
        <Textarea
          rows={2}
          value={reason}
          maxLength={500}
          onChange={(e) => {
            setReason(e.target.value);
            setProblem('');
          }}
        />
        <FieldError>{problem}</FieldError>
      </Field>
      <Problem error={open.error} />
    </ClosedRow>
  );
}

// ── the record ─────────────────────────────────────────────────────────

/** One line per event, oldest first: sealed, via whom, each decision with who and why. */
function TheRecord({ r, history }: { r: QueueItem; history: History }) {
  return (
    <Card variant="quiet" heading="The record">
      <ol className="flex flex-col gap-2 font-mono text-[0.8125rem] break-words">
        <li>
          {when(r.received_at)} · Sealed{r.versions > 1 ? ` (version ${String(r.versions)})` : ''} ·{' '}
          {r.filed_via
            ? `through ${r.filed_via}`
            : r.origin === 'organization'
              ? 'through an organization'
              : 'through the open form'}
        </li>
        {history.map((h, i) => (
          <li key={i}>
            {when(h.created_at)} · {ACTION_WORDS[h.action] ?? h.action}
            {h.new_status ? `: ${STATUS_WORDS[h.new_status] ?? h.new_status}` : ''} ·{' '}
            {h.by === 'reporter' ? 'the reporter' : (h.actor_email ?? 'staff')}
            {h.comment ? ` · “${h.comment}”` : ''}
          </li>
        ))}
      </ol>
    </Card>
  );
}
