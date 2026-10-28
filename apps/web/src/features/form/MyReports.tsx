/**
 * "My reports": the reports filed from the signed-in address, and what their
 * reporter can do with them.
 *
 *   correct      answer the logbook again: a new version, the old one kept
 *   permissions  give or take back the three revocable permissions
 *   withdraw     take it off the public board; it stays in the archive
 *   erase        destroy the contact details; the report is not withdrawn
 *
 * The publication answer given at filing is sealed and is not one of the
 * switches: a correction may take it back, never give it.
 */
import {
  correctMyReport,
  eraseMyContact,
  getMyReport,
  listMyReports,
  setMyPermission,
  withdrawMyReport,
} from '@reportlog/contracts';
import type { MyReport, MyReportDetail, MyWritten, Permission } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import type { CSSProperties } from 'react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { SignInPrompt } from '@/features/identity/SignInPrompt.tsx';
import { useMe } from '@/features/identity/session.ts';
import { ContactAccesses } from '@/features/moderation/ContactAccesses.tsx';
import { call } from '@/lib/api.ts';
import { Back } from '../../mockup/Back.tsx';
import { Btn, btnClass } from '@/mockup/Btn.tsx';
import { CheckBox, AreaField } from '@/mockup/Field.tsx';
import { Chip } from '../../mockup/Chip.tsx';
import { Empty } from '../../mockup/Empty.tsx';
import { ErrorLine } from '../../mockup/ErrorLine.tsx';
import { Modal } from '../../mockup/Modal.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Saved } from '../../mockup/Saved.tsx';
import { Switch } from '../../mockup/Switch.tsx';
import { PERMISSION_WORDS } from './permissionWords.ts';
import { WrittenPanel, heldRaw, myWrittenQuery } from './MyWritten.tsx';
import { QuestionControl } from './QuestionControl.tsx';
import {
  askedQuestions,
  cardProblem,
  isHeldKind,
  rawFromAnswers,
  sealedAnswers,
  shownAnswer,
  toSubmission,
  withChange,
} from './walk.ts';
import type { RawAnswers } from './walk.ts';

const ROW_COLS = { '--cols': '180px 1fr auto' } as CSSProperties;

const myReportsQuery = queryOptions({
  queryKey: ['mine', 'reports'],
  queryFn: ({ signal }) => call(listMyReports, { signal }),
});
const myReportQuery = (threadId: string) =>
  queryOptions({
    queryKey: ['mine', 'reports', threadId],
    queryFn: ({ signal }) => call(getMyReport, { params: { threadId }, signal }),
    retry: false,
  });

/** Signed out sees the sign-in prompt; anybody signed in sees their own. */
function SignedIn({ children }: { children: ReactNode }) {
  const me = useMe();
  const { pathname } = useLocation();
  if (me.isPending) return <p role="status">Loading…</p>;
  if (!me.data?.signedIn) return <SignInPrompt next={pathname} />;
  return <>{children}</>;
}

function statusOf(r: MyReport): string {
  if (r.withdrawn) return 'Off the board';
  if (r.moderation_status === 'pending') return 'Waiting for a moderator';
  return 'Read by a moderator';
}

/**
 * The report's state as a chip (account.md §07). Never teal: teal is a
 * moderator's confirmation on the board, and this is the reporter's own
 * list. "Declined" is a plain tag, not the serious colour: the reporter did
 * nothing wrong. "Public" follows the board's own rule (board/published.ts:
 * approved, allowed, not withdrawn); a site that publishes nothing, or a
 * counts-only logbook, still shows the report's own state here, because this
 * list is not told either.
 */
export function stateChip(r: MyReport): { kind: 'ok' | 'wait' | ''; label: string } {
  if (r.withdrawn) return { kind: '', label: 'Off the board' };
  if (r.moderation_status === 'pending') return { kind: 'wait', label: 'Waiting' };
  if (r.moderation_status === 'invalid') return { kind: '', label: 'Declined' };
  if (r.moderation_status === 'valid')
    return r.may_publish ? { kind: 'ok', label: 'Public' } : { kind: '', label: 'Not published' };
  return { kind: '', label: 'Read' };
}

export function MyReportsPage() {
  return (
    <SignedIn>
      <MyReportsList />
    </SignedIn>
  );
}

function MyReportsList() {
  const list = useQuery(myReportsQuery);
  return (
    <StaffPage area="Account" title="My reports" lede="Reports you filed while signed in.">
      {list.isPending ? <p role="status">Loading…</p> : null}
      <ErrorLine error={list.error} />
      {list.data?.reports.length === 0 ? (
        <Empty title="No reports yet">
          There are no reports filed from this address. Reports you file while signed in, or confirm
          from the email, appear here.
        </Empty>
      ) : null}
      {list.data?.reports.length ? (
        <div className="rows">
          {list.data.reports.map((r) => {
            const chip = stateChip(r);
            return (
              /* The whole row opens it: that is all anybody comes to a row to do. */
              <Link
                key={r.thread_id}
                className="row"
                to="/mine/$threadId"
                params={{ threadId: r.thread_id }}
                aria-label={`Open ${r.public_ref}`}
                style={ROW_COLS}
              >
                <span className="mono">{r.public_ref}</span>
                <span>
                  {r.logbook_title} · filed{' '}
                  <time dateTime={r.first_received_at}>
                    {new Date(r.first_received_at).toLocaleDateString()}
                  </time>
                  {r.versions > 1 ? ` · ${String(r.versions)} versions` : ''}
                </span>
                <span>
                  <Chip kind={chip.kind}>{chip.label}</Chip>
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </StaffPage>
  );
}

export function MyReportPage({ threadId }: { threadId: string }) {
  return (
    <SignedIn>
      <MyReportView threadId={threadId} />
    </SignedIn>
  );
}

function MyReportView({ threadId }: { threadId: string }) {
  const report = useQuery(myReportQuery(threadId));
  const written = useQuery(myWrittenQuery(threadId));
  const client = useQueryClient();
  if (report.isPending) return <p role="status">Loading…</p>;
  if (report.isError) {
    return (
      <StaffPage title="Not one of your reports" width="prose">
        <p>{report.error.message}</p>
        <Link to="/mine">Back to your reports</Link>
      </StaffPage>
    );
  }
  const r = report.data;
  return (
    <StaffPage
      area="Account"
      mono
      title={`Report ${r.public_ref}`}
      lede={`${r.logbook_title} · ${statusOf(r)}`}
    >
      <Back to="/mine">All your reports</Back>
      <div className="grid2">
        <div className="col">
          <Answers r={r} />
          {written.data ? (
            <WrittenPanel
              threadId={r.thread_id}
              written={written.data}
              onChanged={async () => {
                await client.invalidateQueries({ queryKey: myReportQuery(threadId).queryKey });
              }}
            />
          ) : null}
          <Permissions r={r} />
          <ContactAccesses threadId={r.thread_id} />
        </div>
        <div className="col">
          {/* A correction carries the words along, so it waits for them. */}
          {written.isPending && r.questions.some((q) => isHeldKind(q.kind)) ? (
            <p role="status">Loading…</p>
          ) : (
            <Correct r={r} written={written.data} />
          )}
          {r.withdrawn ? null : <Withdraw r={r} />}
          <Erase r={r} />
          <Link
            to="/mine/declaration/$threadId"
            params={{ threadId: r.thread_id }}
            className={btnClass({ sm: true, flat: true })}
          >
            Print a signed declaration
          </Link>
        </div>
      </div>
    </StaffPage>
  );
}

function Answers({ r }: { r: MyReportDetail }) {
  const raw = rawFromAnswers(r.questions, r.answers);
  return (
    <Panel title="What it says now">
      <dl className="answers">
        {askedQuestions(r.questions, raw)
          .filter((q) => !isHeldKind(q.kind))
          .map((q) => (
            <div key={q.key}>
              <dt>{q.label}</dt>
              <dd style={{ whiteSpace: 'pre-wrap' }}>{shownAnswer(q, raw, r.questions) ?? '—'}</dd>
            </div>
          ))}
        <div>
          <dt>May it be published?</dt>
          <dd>{r.may_publish ? 'Yes, if a moderator approves it' : 'No'}</dd>
        </div>
      </dl>
    </Panel>
  );
}

function useRefresh(threadId: string) {
  const client = useQueryClient();
  return async () => {
    await client.invalidateQueries({ queryKey: ['mine', 'reports'] });
    await client.invalidateQueries({ queryKey: myReportQuery(threadId).queryKey });
  };
}

function Permissions({ r }: { r: MyReportDetail }) {
  const refresh = useRefresh(r.thread_id);
  const [status, setStatus] = useState<string | null>(null);
  // Switching off file publication takes published files DOWN, at once, so
  // while any are up it asks first. Until the answer is yes nothing is
  // written and the box stays as the server says.
  const [askTakeDown, setAskTakeDown] = useState(false);
  const set = useMutation({
    mutationFn: (v: { permission: Permission; granted: boolean }) =>
      call(setMyPermission, { params: { threadId: r.thread_id }, body: v }),
    onSuccess: async () => {
      setStatus('Saved.');
      await refresh();
    },
    onError: (e) => {
      setStatus(e.message);
    },
  });
  return (
    <Panel title="What you allow">
      <p className="muted">
        You can change these at any time, and every change is kept so you can see it. Only you can
        change them.
      </p>
      {/* Sharing is the switch on "What you wrote", beside the words it is about. */}
      {(Object.keys(PERMISSION_WORDS) as Permission[])
        .filter((p) => p !== 'journalist_sharing')
        .map((p) => (
          <Switch
            key={p}
            label={PERMISSION_WORDS[p].label}
            help={PERMISSION_WORDS[p].hint}
            // Read back from the server, never trusted from the click: the
            // server is where the current value lives.
            checked={r.permissions[p]}
            disabled={set.isPending}
            onChange={(on) => {
              if (p === 'attachment_publication' && !on && r.published_files > 0) {
                setAskTakeDown(true);
                return;
              }
              setStatus('Saving…');
              set.mutate({ permission: p, granted: on });
            }}
          />
        ))}
      {status ? <p role="status">{status}</p> : null}
      <Modal
        open={askTakeDown}
        onClose={() => {
          setAskTakeDown(false);
        }}
        title="Take your files down?"
        text={
          r.published_files === 1
            ? 'One of your files is published on this site. Switching this off takes it down now. It stays part of your report, and nobody can publish it again unless you switch this back on.'
            : `${String(r.published_files)} of your files are published on this site. Switching this off takes them down now. They stay part of your report, and nobody can publish them again unless you switch this back on.`
        }
        buttons={
          <>
            <Btn
              sm
              flat
              look="ghost"
              onClick={() => {
                setAskTakeDown(false);
              }}
            >
              Leave it on
            </Btn>
            <Btn
              sm
              flat
              look="ink"
              onClick={() => {
                setAskTakeDown(false);
                setStatus('Saving…');
                set.mutate({ permission: 'attachment_publication', granted: false });
              }}
            >
              Switch it off
            </Btn>
          </>
        }
      />
      {r.permission_history.length ? (
        <details className="tech">
          <summary>Every change you made</summary>
          <div className="in">
            {r.permission_history.map((h) => (
              <span key={`${h.at}-${h.permission}`}>
                <time dateTime={h.at}>{new Date(h.at).toLocaleString()}</time>:{' '}
                {h.granted ? 'allowed' : 'took back'} “{PERMISSION_WORDS[h.permission].label}”
                {h.reason ? ` (${h.reason})` : ''}
              </span>
            ))}
          </div>
        </details>
      ) : null}
    </Panel>
  );
}

function Correct({ r, written }: { r: MyReportDetail; written: MyWritten | undefined }) {
  const refresh = useRefresh(r.thread_id);
  const [raw, setRaw] = useState<RawAnswers>(() => ({
    ...rawFromAnswers(r.questions, r.answers),
    ...(written ? heldRaw(r.questions, written) : {}),
  }));
  const [comment, setComment] = useState('');
  const [keepOut, setKeepOut] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () =>
      call(correctMyReport, {
        params: { threadId: r.thread_id },
        body: {
          answers: toSubmission(r.questions, raw),
          comment: comment.trim(),
          ...(keepOut ? { may_publish: false } : {}),
        },
      }),
    onSuccess: async (data) => {
      setDone(`Saved as a new version, ${data.public_ref}. A moderator reads it again.`);
      setComment('');
      await refresh();
    },
  });
  const asked = askedQuestions(r.questions, raw);
  return (
    <Panel title="Correct it">
      <p className="muted">
        A correction is a new entry pointing at this one. The original stays in the record, and a
        moderator reads the correction before it is published.
      </p>
      {asked.map((q) => {
        const err = problem ? cardProblem(q, raw, r.questions) : null;
        return (
          <div key={q.key} className="field">
            <p id={`correct-${q.key}`} className="lbl">
              {q.label}
              {q.required ? '' : ' (optional)'}
            </p>
            <QuestionControl
              question={q}
              value={raw[q.key]}
              onChange={(v) => {
                setRaw((x) => withChange(r.questions, x, q.key, v));
              }}
              labelledBy={`correct-${q.key}`}
              invalid={Boolean(err)}
              answers={sealedAnswers(r.questions, raw)}
              raw={raw}
            />
            {err ? <p className="error">{err}</p> : null}
          </div>
        );
      })}
      <AreaField
        label="Why are you correcting it?"
        help="A moderator sees this beside the new version."
        rows={3}
        value={comment}
        onChange={(e) => {
          setComment(e.target.value);
        }}
      />
      {r.may_publish ? (
        <CheckBox
          checked={keepOut}
          onChange={(e) => {
            setKeepOut(e.target.checked);
          }}
        >
          Keep it out of the public archive from now on. (This cannot be undone: a correction can
          take permission to publish back, never give it.)
        </CheckBox>
      ) : null}
      {problem ? <p className="error">{problem}</p> : null}
      {send.isError ? <ErrorLine error={send.error} /> : null}
      {done ? <Saved>{done}</Saved> : null}
      <Btn
        sm
        flat
        look="ink"
        disabled={send.isPending}
        onClick={() => {
          setDone(null);
          const missing = asked.find((q) => cardProblem(q, raw, r.questions));
          if (missing) {
            setProblem(`“${missing.label}” needs a different answer.`);
            return;
          }
          if (!comment.trim()) {
            setProblem('Say why you are correcting it.');
            return;
          }
          setProblem(null);
          send.mutate();
        }}
      >
        Save the correction
      </Btn>
    </Panel>
  );
}

function Withdraw({ r }: { r: MyReportDetail }) {
  const refresh = useRefresh(r.thread_id);
  const [comment, setComment] = useState('');
  const go = useMutation({
    mutationFn: () =>
      call(withdrawMyReport, {
        params: { threadId: r.thread_id },
        body: { comment: comment.trim() },
      }),
    onSuccess: refresh,
  });
  return (
    <Panel
      title="Take it off the board"
      sub="It comes off the public board. The report itself is sealed: it stays in the record, marked as taken off the board, and can’t be deleted."
    >
      <AreaField
        label="Why are you taking it off the board?"
        rows={2}
        value={comment}
        onChange={(e) => {
          setComment(e.target.value);
        }}
      />
      <ErrorLine error={go.error} />
      <Btn
        sm
        flat
        disabled={!comment.trim() || go.isPending}
        onClick={() => {
          go.mutate();
        }}
      >
        Take it off the board
      </Btn>
    </Panel>
  );
}

function Erase({ r }: { r: MyReportDetail }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [sure, setSure] = useState(false);
  const go = useMutation({
    mutationFn: () =>
      call(eraseMyContact, { params: { threadId: r.thread_id }, body: { confirm: true } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['mine', 'reports'] });
      await navigate({ to: '/mine' });
    },
  });
  return (
    <Panel title="Erase your contact details" kind="danger">
      <p className="muted">
        Your email address is destroyed. Your report stays as it is (it never held your address),
        and is published or not exactly as before. Afterwards it no longer appears here, and nobody
        can reach you about it. To take the report off the board, do that first.
      </p>
      <CheckBox
        checked={sure}
        onChange={(e) => {
          setSure(e.target.checked);
        }}
      >
        I understand this cannot be undone.
      </CheckBox>
      <ErrorLine error={go.error} />
      <Btn
        sm
        flat
        look="bad"
        disabled={!sure || go.isPending}
        onClick={() => {
          go.mutate();
        }}
      >
        Erase my details
      </Btn>
    </Panel>
  );
}
