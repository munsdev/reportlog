/**
 * One report in the queue, and every decision a moderator can make about it.
 *
 * Each decision is its own section with its own button, and nothing on the
 * page changes until that button is pressed. Every decision asks for a
 * reason, except saying a flagged report has been read: the flag is a
 * reading list, and asking people to justify having read something is how a
 * queue stops being cleared.
 *
 * Contact details open only here, one report at a time, with a reason the
 * reporter is shown. Opening them is logged before anything is read.
 */
import { roleSatisfies } from '@reportlog/access';
import {
  addNoteLink,
  decideReport,
  linkReportIncident,
  markReportRead,
  openReportContact,
  removeNoteLink,
  restoreReport,
  setNoteState,
  setReportSeverity,
  withdrawReport,
  writeReportNote,
} from '@reportlog/contracts';
import type { QueueItem, ResponseOf, getQueueItem, getReportNote } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useId, useState } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Field, FieldDescription } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Page } from '../../components/ui/page.tsx';
import { Select } from '../../components/ui/select.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { call } from '../../lib/api.ts';
import { ReportAnswers } from '../board/ReportAnswers.tsx';
import { EvidenceRequests } from '../files/staff/EvidenceRequests.tsx';
import { ReportFiles } from '../files/staff/ReportFiles.tsx';
import { useMe } from '../identity/session.ts';
import { noteQuery, queueItemQuery } from './queries.ts';
import { ACTION_WORDS, SEVERITIES, SEVERITY_WORDS, STATUS_WORDS } from './words.ts';

type Assessment = ResponseOf<typeof getQueueItem>['assessment'];

/** A mutation that refreshes the queue and the board when it lands. */
function useAct<T>(fn: (input: T) => Promise<unknown>, onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      onDone?.();
      await qc.invalidateQueries({ queryKey: ['moderation'] });
      await qc.invalidateQueries({ queryKey: ['board'] });
    },
  });
}

function Problem({ error }: { error: Error | null }) {
  return error ? <Alert tone="serious">{error.message}</Alert> : null;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5"
    >
      <h2 id={id} className="font-display text-xl font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ItemPage({ threadId }: { threadId: string }) {
  const query = useQuery(queueItemQuery(threadId));
  if (query.isPending) return <p role="status">Loading…</p>;
  if (query.isError) {
    return (
      <Page title="Not found" width="prose">
        <Alert tone="serious">{query.error.message}</Alert>
        <Link to="/moderate" className="underline">
          Back to the queue
        </Link>
      </Page>
    );
  }
  const { report: r, history, assessment } = query.data;
  const state = r.withdrawn ? STATUS_WORDS.withdrawn : STATUS_WORDS[r.moderation_status];
  return (
    <Page
      title={`Report ${r.public_ref}`}
      lede={`${r.logbook_title} · ${state ?? ''}${r.public ? ' · on the board now' : ' · not public'}`}
      width="prose"
    >
      <Link to="/moderate" className="underline">
        Back to the queue
      </Link>
      <Section title="What the reporter said">
        <ReportAnswers slug={r.logbook_slug} answers={r.answers} />
        <p className="text-sm text-ink-alt">
          Filed {new Date(r.received_at).toLocaleString()}
          {r.versions > 1 ? `, version ${String(r.versions)} (corrected by its reporter)` : ''}
          {r.filed_via ? `, through ${r.filed_via}` : ''}.{' '}
          {r.may_publish
            ? 'Its reporter permitted publication.'
            : 'Its reporter did NOT permit publication: approving it records the judgement, and it stays off the board.'}
        </p>
      </Section>
      {r.needs_review ? <SecondRead r={r} /> : null}
      {r.withdrawn ? null : <Decide r={r} />}
      <Severity r={r} a={assessment} />
      <Incident r={r} a={assessment} />
      {/* Workstream F2's components: one question per card, publishing offered
          only while the reporter's consent allows it. */}
      {r.file_count > 0 ? <ReportFiles threadId={r.thread_id} reportPublic={r.public} /> : null}
      <EvidenceRequests threadId={r.thread_id} />
      <OffTheBoard r={r} />
      {r.has_contact ? <Contact r={r} /> : null}
      {r.notes_enabled ? <Note r={r} /> : null}
      <Section title="What happened to it">
        {history.length === 0 ? (
          <p>Nothing yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {history.map((h, i) => (
              <li key={i} className="text-sm">
                <span className="font-semibold">
                  {ACTION_WORDS[h.action] ?? h.action}
                  {h.new_status ? `: ${STATUS_WORDS[h.new_status] ?? h.new_status}` : ''}
                </span>{' '}
                by {h.by === 'reporter' ? 'the reporter' : (h.actor_email ?? 'staff')},{' '}
                {new Date(h.created_at).toLocaleString()}
                {h.comment ? ` — ${h.comment}` : ''}
              </li>
            ))}
          </ol>
        )}
      </Section>
    </Page>
  );
}

function SecondRead({ r }: { r: QueueItem }) {
  const read = useAct(() => call(markReportRead, { params: { threadId: r.thread_id } }));
  return (
    <Section title="Asks for a second read">
      <p>
        Its words matched: <span className="font-semibold">{r.review_terms.join(', ')}</span>. This
        is a reading list, not a finding about the report or anybody in it.
      </p>
      <Problem error={read.error} />
      <Button
        variant="secondary"
        className="self-start"
        disabled={read.isPending}
        onClick={() => {
          read.mutate(undefined);
        }}
      >
        I have read it
      </Button>
    </Section>
  );
}

function Decide({ r }: { r: QueueItem }) {
  const [status, setStatus] = useState(
    r.moderation_status === 'pending' ? '' : r.moderation_status,
  );
  const [comment, setComment] = useState('');
  const decide = useAct(
    () => call(decideReport, { params: { threadId: r.thread_id }, body: { status, comment } }),
    () => {
      setComment('');
    },
  );
  return (
    <Section title="Decide">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          decide.mutate(undefined);
        }}
      >
        <Field>
          <Label>Decision</Label>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
            }}
          >
            <option value="">Choose…</option>
            <option value="valid">Approve for publication</option>
            <option value="invalid">Decline</option>
            <option value="unknown">Unclear for now</option>
          </Select>
        </Field>
        <Field>
          <Label>Why</Label>
          <Textarea
            rows={3}
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
            }}
          />
          <FieldDescription>
            Kept on the record with your name. Not shown publicly.
          </FieldDescription>
        </Field>
        <Problem error={decide.error} />
        {decide.isSuccess ? <Alert tone="confirmed">Recorded.</Alert> : null}
        <Button type="submit" className="self-start" disabled={decide.isPending}>
          Record the decision
        </Button>
      </form>
    </Section>
  );
}

/**
 * How serious it is. A moderator's judgement, never part of the report's
 * seal. An unrated report opens with nothing chosen, so saving is a
 * deliberate act rather than a default sliding through.
 */
function Severity({ r, a }: { r: QueueItem; a: Assessment }) {
  const [severity, setSeverity] = useState('');
  const [comment, setComment] = useState('');
  const save = useAct(
    () =>
      call(setReportSeverity, {
        params: { threadId: r.thread_id },
        body: { severity, comment },
      }),
    () => {
      setComment('');
      setSeverity('');
    },
  );
  const current = a.severity ? SEVERITY_WORDS[a.severity] : null;
  return (
    <Section title="Severity">
      <p>
        {current ? (
          <>
            Rated <span className="font-semibold">{current.label}</span>: {current.hint}.
          </>
        ) : (
          'Nobody has rated it yet.'
        )}{' '}
        A moderator’s judgement, kept beside the report and never part of what was sealed.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Field>
          <Label>{a.severity ? 'Change it to' : 'Rate it'}</Label>
          <Select
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value);
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
        </Field>
        <Field>
          <Label>Why this rating</Label>
          <Textarea
            rows={2}
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
            }}
          />
          <FieldDescription>
            Kept on the record with your name. Not shown publicly.
          </FieldDescription>
        </Field>
        <Problem error={save.error} />
        {save.isSuccess ? <Alert tone="confirmed">Recorded.</Alert> : null}
        <Button
          type="submit"
          variant="secondary"
          className="self-start"
          disabled={save.isPending || !severity}
        >
          Record the rating
        </Button>
      </form>
    </Section>
  );
}

/**
 * Reports describing the same real-world incident, linked by hand. Never
 * inferred: a clustering mistake would overstate corroboration, the number
 * most likely to be quoted.
 */
function Incident({ r, a }: { r: QueueItem; a: Assessment }) {
  const [ref, setRef] = useState('');
  const [comment, setComment] = useState('');
  const [unlinking, setUnlinking] = useState(false);
  const link = useAct(
    () =>
      call(linkReportIncident, {
        params: { threadId: r.thread_id },
        body: { ...(unlinking ? {} : { link_to: ref.trim() }), comment },
      }),
    () => {
      setRef('');
      setComment('');
    },
  );
  const total = a.linked.length + 1;
  return (
    <Section title="Same incident">
      {a.incident_id ? (
        <>
          <p>
            Linked with {String(a.linked.length)} other report{a.linked.length === 1 ? '' : 's'}.{' '}
            {String(a.published_accounts)} of the {String(total)} accounts are published, and only
            those count as corroboration a reader can check.
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
        </>
      ) : (
        <p>Not linked to any other report.</p>
      )}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          link.mutate(undefined);
        }}
      >
        <Field>
          <Label>{a.incident_id ? 'Move it to the incident of' : 'Link it to'}</Label>
          <Input
            value={ref}
            placeholder="A report’s reference"
            onChange={(e) => {
              setRef(e.target.value);
            }}
          />
          <FieldDescription>
            The other report’s reference. If it is already linked to others, this one joins them.
          </FieldDescription>
        </Field>
        <Field>
          <Label>Why they are the same incident</Label>
          <Textarea
            rows={2}
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
            }}
          />
          <FieldDescription>
            Kept on the record with your name. Not shown publicly.
          </FieldDescription>
        </Field>
        <Problem error={link.error} />
        {link.isSuccess ? <Alert tone="confirmed">Recorded.</Alert> : null}
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            variant="secondary"
            disabled={link.isPending || !ref.trim()}
            onClick={() => {
              setUnlinking(false);
            }}
          >
            Link them
          </Button>
          {a.incident_id ? (
            <Button
              type="submit"
              variant="secondary"
              disabled={link.isPending}
              onClick={() => {
                setUnlinking(true);
              }}
            >
              Unlink this report
            </Button>
          ) : null}
        </div>
      </form>
    </Section>
  );
}

function OffTheBoard({ r }: { r: QueueItem }) {
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState('pending');
  const clear = () => {
    setComment('');
  };
  const withdraw = useAct(
    () => call(withdrawReport, { params: { threadId: r.thread_id }, body: { comment } }),
    clear,
  );
  const restore = useAct(
    () => call(restoreReport, { params: { threadId: r.thread_id }, body: { status, comment } }),
    clear,
  );
  if (r.withdrawn && r.reporter_withdrew) {
    return (
      <Section title="Withdrawn by its reporter">
        <p>
          Its reporter withdrew this report. Only they can decide it goes back; nothing here can do
          that for them.
        </p>
      </Section>
    );
  }
  const act = r.withdrawn ? restore : withdraw;
  return (
    <Section title={r.withdrawn ? 'Put it back' : 'Take it off the board'}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          act.mutate(undefined);
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
            }}
          />
        </Field>
        <Problem error={act.error} />
        <Button type="submit" variant="secondary" className="self-start" disabled={act.isPending}>
          {r.withdrawn ? 'Put it back' : 'Withdraw it'}
        </Button>
      </form>
    </Section>
  );
}

function Contact({ r }: { r: QueueItem }) {
  const [reason, setReason] = useState('');
  const [opened, setOpened] = useState<ResponseOf<typeof openReportContact>['contact'] | null>(
    null,
  );
  const open = useMutation({
    mutationFn: () =>
      call(openReportContact, { params: { threadId: r.thread_id }, body: { reason } }),
    onSuccess: (d) => {
      setOpened(d.contact);
    },
  });
  return (
    <Section title="How to reach the reporter">
      {opened ? (
        opened.erased ? (
          <p>The reporter had their contact details erased. There is nothing to read.</p>
        ) : (
          <dl className="flex flex-col gap-1">
            <dt className="text-sm font-semibold text-ink-alt">
              {opened.filed_by === 'coordinator' ? 'The coordinator who filed it' : 'The reporter'}
            </dt>
            <dd className="font-mono">{opened.email}</dd>
            {opened.organization ? (
              <>
                <dt className="text-sm font-semibold text-ink-alt">For</dt>
                <dd>{opened.organization}</dd>
              </>
            ) : null}
          </dl>
        )
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            open.mutate();
          }}
        >
          <Field>
            <Label>Why you need them</Label>
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
            <FieldDescription>
              The reporter is shown this reason, word for word, and when you opened them. Your name
              is not shown to them; it is kept for administrators.
            </FieldDescription>
          </Field>
          <Problem error={open.error} />
          <Button
            type="submit"
            variant="secondary"
            className="self-start"
            disabled={open.isPending}
          >
            Open the contact details
          </Button>
        </form>
      )}
    </Section>
  );
}

function Note({ r }: { r: QueueItem }) {
  const query = useQuery(noteQuery(r.thread_id));
  const me = useMe();
  const isAdmin = me.data?.signedIn ? roleSatisfies(me.data.role, 'admin') : false;
  const [body, setBody] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const write = useAct(
    () =>
      call(writeReportNote, {
        params: { threadId: r.thread_id },
        body: { body: body ?? '', ...(why.trim() ? { revision_reason: why } : {}) },
      }),
    () => {
      setBody(null);
      setWhy('');
    },
  );
  if (query.isPending) return null;
  if (query.isError) return <Alert tone="serious">{query.error.message}</Alert>;
  const { note, links } = query.data;
  const text = body ?? note?.body ?? '';
  return (
    <Section title="The archive’s note">
      <p className="text-sm text-ink-alt">
        Published under the archive’s name, never yours. Every version stays on the record, so a
        revision shows as one.
      </p>
      {note && note.state !== 'published' ? (
        <Alert>
          {note.state === 'under_review'
            ? 'This note is under editorial review.'
            : 'This note is withdrawn.'}
        </Alert>
      ) : null}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          write.mutate(undefined);
        }}
      >
        <Field>
          <Label>{note ? `The note (version ${String(note.versions)})` : 'Write a note'}</Label>
          <Textarea
            rows={5}
            value={text}
            onChange={(e) => {
              setBody(e.target.value);
            }}
          />
          <FieldDescription>Plain text. A blank line starts a new paragraph.</FieldDescription>
        </Field>
        {note ? (
          <Field>
            <Label>Why it is being revised</Label>
            <Input
              value={why}
              onChange={(e) => {
                setWhy(e.target.value);
              }}
            />
          </Field>
        ) : null}
        <Problem error={write.error} />
        <Button type="submit" className="self-start" disabled={write.isPending || body === null}>
          {note ? 'Publish the revision' : 'Publish the note'}
        </Button>
      </form>
      {note ? <Citations threadId={r.thread_id} links={links} /> : null}
      {note && isAdmin ? <NoteState threadId={r.thread_id} current={note.state} /> : null}
    </Section>
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
  const add = useAct(
    () => call(addNoteLink, { params: { threadId }, body: { title, url } }),
    () => {
      setTitle('');
      setUrl('');
    },
  );
  const remove = useAct((id: number) => call(removeNoteLink, { params: { threadId, id } }));
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-semibold">Sources cited</h3>
      {links.length ? (
        <ul className="flex flex-col gap-1">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2">
              <a href={l.url} rel="noopener noreferrer nofollow" className="underline">
                {l.title}
              </a>
              <Button
                size="sm"
                variant="quiet"
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
          add.mutate(undefined);
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
        <Button type="submit" variant="secondary" disabled={add.isPending}>
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
      className="flex flex-col gap-2 border-t border-line pt-3"
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
      <Button type="submit" variant="secondary" className="self-start" disabled={change.isPending}>
        Change the state
      </Button>
    </form>
  );
}
