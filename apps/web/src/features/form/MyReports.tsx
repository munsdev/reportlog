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
import type { MyReport, MyReportDetail, Permission } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Field, FieldDescription } from '@/components/ui/field.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Page } from '@/components/ui/page.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { SignInPrompt } from '@/features/identity/SignInPrompt.tsx';
import { useMe } from '@/features/identity/session.ts';
import { ContactAccesses } from '@/features/moderation/ContactAccesses.tsx';
import { call } from '@/lib/api.ts';
import { PERMISSION_WORDS } from './permissionWords.ts';
import { QuestionControl } from './QuestionControl.tsx';
import { askedQuestions, cardProblem, rawFromAnswers, shownAnswer, toSubmission } from './walk.ts';
import type { RawAnswers } from './walk.ts';

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
  if (r.withdrawn) return 'Withdrawn';
  if (r.moderation_status === 'pending') return 'Waiting for a moderator';
  return 'Read by a moderator';
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
    <Page
      title="My reports"
      lede="The reports filed from the address you signed in with."
      width="prose"
    >
      {list.isPending ? <p role="status">Loading…</p> : null}
      {list.isError ? <Alert tone="serious" title={list.error.message} /> : null}
      {list.data?.reports.length === 0 ? (
        <p>There are no reports filed from this address.</p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {list.data?.reports.map((r) => (
          <li key={r.thread_id} className="rounded-card border border-line bg-surface p-4">
            <p className="text-sm text-ink-alt">{r.logbook_title}</p>
            <p className="font-mono font-semibold">{r.public_ref}</p>
            <p className="text-sm">
              {statusOf(r)} · filed{' '}
              <time dateTime={r.first_received_at}>
                {new Date(r.first_received_at).toLocaleDateString()}
              </time>
              {r.versions > 1 ? ` · ${String(r.versions)} versions` : ''}
            </p>
            <Link
              to="/mine/$threadId"
              params={{ threadId: r.thread_id }}
              className="underline"
              aria-label={`Open ${r.public_ref}`}
            >
              Open
            </Link>
          </li>
        ))}
      </ul>
    </Page>
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
  if (report.isPending) return <p role="status">Loading…</p>;
  if (report.isError) {
    return (
      <Page title="Not one of your reports" width="prose">
        <p>{report.error.message}</p>
        <Link to="/mine" className="underline">
          Back to your reports
        </Link>
      </Page>
    );
  }
  const r = report.data;
  return (
    <Page
      title={`Report ${r.public_ref}`}
      lede={`${r.logbook_title} · ${statusOf(r)}`}
      width="prose"
    >
      <Link to="/mine" className="underline">
        All your reports
      </Link>
      <Answers r={r} />
      <Permissions r={r} />
      <ContactAccesses threadId={r.thread_id} />
      <Correct r={r} />
      {r.withdrawn ? null : <Withdraw r={r} />}
      <Erase r={r} />
    </Page>
  );
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

function Answers({ r }: { r: MyReportDetail }) {
  const raw = rawFromAnswers(r.questions, r.answers);
  return (
    <Section title="What it says now">
      <dl className="flex flex-col gap-3">
        {askedQuestions(r.questions, raw).map((q) => (
          <div key={q.key}>
            <dt className="text-sm font-semibold text-ink-alt">{q.label}</dt>
            <dd className="whitespace-pre-wrap">{shownAnswer(q, raw) ?? '—'}</dd>
          </div>
        ))}
        <div>
          <dt className="text-sm font-semibold text-ink-alt">May it be published?</dt>
          <dd>{r.may_publish ? 'Yes, if a moderator approves it' : 'No'}</dd>
        </div>
      </dl>
    </Section>
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
    <Section title="What you allow">
      <p className="text-ink-alt">
        You can change these at any time, and every change is kept so you can see it. Only you can
        change them.
      </p>
      {(Object.keys(PERMISSION_WORDS) as Permission[]).map((p) => (
        <div key={p} className="flex items-start gap-3">
          <Checkbox
            id={`perm-${p}`}
            // Read back from the server, never trusted from the click: the
            // server is where the current value lives.
            checked={r.permissions[p]}
            disabled={set.isPending}
            onCheckedChange={(on) => {
              if (p === 'attachment_publication' && on !== true && r.published_files > 0) {
                setAskTakeDown(true);
                return;
              }
              setStatus('Saving…');
              set.mutate({ permission: p, granted: on === true });
            }}
            aria-describedby={`perm-${p}-hint`}
          />
          <div className="flex flex-col">
            <Label htmlFor={`perm-${p}`} className="font-normal">
              {PERMISSION_WORDS[p].label}
            </Label>
            <span id={`perm-${p}-hint`} className="text-sm text-ink-alt">
              {PERMISSION_WORDS[p].hint}
            </span>
          </div>
        </div>
      ))}
      {status ? <p role="status">{status}</p> : null}
      <Dialog open={askTakeDown} onOpenChange={setAskTakeDown}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Take your files down?</DialogTitle>
            <DialogDescription>
              {r.published_files === 1
                ? 'One of your files is published on this site. Switching this off takes it down now. It stays part of your report, and nobody can publish it again unless you switch this back on.'
                : `${String(r.published_files)} of your files are published on this site. Switching this off takes them down now. They stay part of your report, and nobody can publish them again unless you switch this back on.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Leave it on
              </Button>
            </DialogClose>
            <Button
              type="button"
              onClick={() => {
                setAskTakeDown(false);
                setStatus('Saving…');
                set.mutate({ permission: 'attachment_publication', granted: false });
              }}
            >
              Switch it off
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {r.permission_history.length ? (
        <details>
          <summary className="cursor-pointer underline">Every change you made</summary>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {r.permission_history.map((h) => (
              <li key={`${h.at}-${h.permission}`}>
                <time dateTime={h.at}>{new Date(h.at).toLocaleString()}</time>:{' '}
                {h.granted ? 'allowed' : 'took back'} “{PERMISSION_WORDS[h.permission].label}”
                {h.reason ? ` (${h.reason})` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Section>
  );
}

function Correct({ r }: { r: MyReportDetail }) {
  const refresh = useRefresh(r.thread_id);
  const [raw, setRaw] = useState<RawAnswers>(() => rawFromAnswers(r.questions, r.answers));
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
    <Section title="Correct it">
      <p className="text-ink-alt">
        A correction is a new version of the report. The one before it is kept, and both can be
        checked.
      </p>
      {asked.map((q) => {
        const err = problem ? cardProblem(q, raw) : null;
        return (
          <div key={q.key} className="flex flex-col gap-2">
            <p id={`correct-${q.key}`} className="font-semibold">
              {q.label}
              {q.required ? '' : ' (optional)'}
            </p>
            <QuestionControl
              question={q}
              value={raw[q.key]}
              onChange={(v) => {
                setRaw((x) => ({ ...x, [q.key]: v }));
              }}
              labelledBy={`correct-${q.key}`}
              invalid={Boolean(err)}
            />
            {err ? <p className="text-sm font-semibold text-serious">{err}</p> : null}
          </div>
        );
      })}
      <Field>
        <Label>Why are you correcting it?</Label>
        <FieldDescription>A moderator sees this beside the new version.</FieldDescription>
        <Textarea
          rows={3}
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
          }}
        />
      </Field>
      {r.may_publish ? (
        <div className="flex items-start gap-3">
          <Checkbox
            id="keep-out"
            checked={keepOut}
            onCheckedChange={(on) => {
              setKeepOut(on === true);
            }}
          />
          <Label htmlFor="keep-out" className="font-normal">
            Keep it out of the public archive from now on. (This cannot be undone: a correction can
            take permission to publish back, never give it.)
          </Label>
        </div>
      ) : null}
      {problem ? <Alert tone="serious" title={problem} /> : null}
      {send.isError ? (
        <Alert tone="serious" title="It was not saved">
          {send.error.message}
        </Alert>
      ) : null}
      {done ? <Alert tone="confirmed" title={done} /> : null}
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={send.isPending}
          onClick={() => {
            setDone(null);
            const missing = asked.find((q) => cardProblem(q, raw));
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
        </Button>
      </div>
    </Section>
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
    <Section title="Withdraw it">
      <p className="text-ink-alt">
        It comes off the public board. It stays in the archive, sealed, because nothing in it can be
        deleted.
      </p>
      <Field>
        <Label>Why are you withdrawing it?</Label>
        <Textarea
          rows={2}
          value={comment}
          onChange={(e) => {
            setComment(e.target.value);
          }}
        />
      </Field>
      {go.isError ? <Alert tone="serious" title={go.error.message} /> : null}
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={!comment.trim() || go.isPending}
          onClick={() => {
            go.mutate();
          }}
        >
          Withdraw it
        </Button>
      </div>
    </Section>
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
    <Section title="Erase your contact details">
      <p className="text-ink-alt">
        Your email address is destroyed. Your report is not withdrawn: it stays as it is, sealed (it
        never held your address), and is published or not exactly as before. Afterwards it no longer
        appears here, and nobody can reach you about it. To take the report down, withdraw it first.
      </p>
      <div className="flex items-start gap-3">
        <Checkbox
          id="erase-sure"
          checked={sure}
          onCheckedChange={(on) => {
            setSure(on === true);
          }}
        />
        <Label htmlFor="erase-sure" className="font-normal">
          I understand this cannot be undone.
        </Label>
      </div>
      {go.isError ? <Alert tone="serious" title={go.error.message} /> : null}
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={!sure || go.isPending}
          onClick={() => {
            go.mutate();
          }}
        >
          Erase my details
        </Button>
      </div>
    </Section>
  );
}
