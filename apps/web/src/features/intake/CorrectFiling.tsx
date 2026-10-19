/**
 * Correcting an account you filed, as your own act.
 *
 * Not the reporter's "My reports": nothing here gives or takes back a
 * permission. A correction is a new version of the report, attested by you
 * as the batch was; the one before it is kept, and both can be checked.
 */
import { correctIntakeFiling } from '@reportlog/contracts';
import type { IntakeFiling } from '@reportlog/contracts';
import { INTAKE_METHODS, INTAKE_METHOD_LABELS } from '@reportlog/seal';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { Field, FieldDescription } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Page } from '@/components/ui/page.tsx';
import { Select } from '@/components/ui/select.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { askedQuestions, cardProblem, rawFromAnswers, toSubmission } from '@/features/form/walk.ts';
import type { RawAnswers } from '@/features/form/walk.ts';
import { call } from '@/lib/api.ts';
import { CORRECTION_STATEMENT, PublicationChoice, Questions } from './parts.tsx';
import { coordinatorCardQuery, filingQuery, useIntakeRefresh } from './queries.ts';

export function CorrectFiling({ threadId }: { threadId: string }) {
  const filing = useQuery(filingQuery(threadId));
  // Here, not in the form: the form starts again on the new version.
  const [done, setDone] = useState<string | null>(null);
  if (filing.isPending) return <p role="status">Loading…</p>;
  if (filing.isError) {
    return (
      <Page title="Not an account you filed" width="prose">
        <p>{filing.error.message}</p>
        <Link to="/intake" className="underline">
          All your batches
        </Link>
      </Page>
    );
  }
  // Keyed by the version, so a new version starts the form from what it says.
  return <CorrectForm key={filing.data.public_ref} f={filing.data} done={done} setDone={setDone} />;
}

function CorrectForm({
  f,
  done,
  setDone,
}: {
  f: IntakeFiling;
  done: string | null;
  setDone: (s: string | null) => void;
}) {
  const refresh = useIntakeRefresh();
  const card = useQuery(coordinatorCardQuery);
  const [raw, setRaw] = useState<RawAnswers>(() => rawFromAnswers(f.questions, f.answers));
  const [method, setMethod] = useState(f.intake_method);
  const [collected, setCollected] = useState(f.collected_on ?? '');
  const [publish, setPublish] = useState(f.may_publish ? 'yes' : 'no');
  const [comment, setComment] = useState('');
  const [attested, setAttested] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () =>
      call(correctIntakeFiling, {
        params: { threadId: f.thread_id },
        body: {
          answers: toSubmission(f.questions, raw),
          comment: comment.trim(),
          intake_method: method,
          collected_on: collected,
          ...(f.may_publish && publish === 'no' ? { may_publish: false } : {}),
          attested: true,
        },
      }),
    onSuccess: async (out) => {
      setDone(`Filed as a new version, ${out.public_ref}. A moderator reads it again.`);
      await refresh();
    },
  });
  const asked = askedQuestions(f.questions, raw);

  return (
    <Page
      title={`Correct ${f.public_ref}`}
      lede={`${f.logbook_title} · filed through ${f.filed_via} · ${f.moderation_status === 'pending' ? 'waiting for a moderator' : 'read by a moderator'}`}
      width="prose"
    >
      <Link to="/intake/$id" params={{ id: String(f.batch_id) }} className="underline">
        Back to the batch
      </Link>
      {done ? <Alert tone="confirmed" title={done} /> : null}

      <section
        aria-labelledby="the-correction"
        className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5"
      >
        <h2 id="the-correction" className="font-display text-xl font-bold">
          The correction
        </h2>
        <p className="text-ink-alt">
          A correction is a new version of the report. The one before it is kept, and both can be
          checked. It is recorded as yours; the organization is shown publicly, you are not.
        </p>
        <Questions
          idPrefix="fix"
          questions={f.questions}
          raw={raw}
          onChange={(key, v) => {
            setRaw((x) => ({ ...x, [key]: v }));
          }}
          showProblems={Boolean(problem)}
        />
        <Field>
          <Label>How it was collected</Label>
          <Select
            value={method}
            onChange={(e) => {
              setMethod(e.target.value);
            }}
          >
            {INTAKE_METHODS.map((m) => (
              <option key={m} value={m}>
                {INTAKE_METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field>
          <Label>The day it was collected</Label>
          <FieldDescription>Clear it if the day is not known.</FieldDescription>
          <Input
            type="date"
            value={collected}
            onChange={(e) => {
              setCollected(e.target.value);
            }}
          />
        </Field>
        {f.may_publish ? (
          <PublicationChoice card={card.data} value={publish} onChange={setPublish} />
        ) : (
          <p>
            The person asked for this to be kept out of the public archive. A correction cannot
            change that.
          </p>
        )}
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
        <div className="flex items-start gap-3">
          <Checkbox
            id="attest-correction"
            checked={attested}
            onCheckedChange={(on) => {
              setAttested(on === true);
            }}
          />
          <Label htmlFor="attest-correction" className="font-normal">
            {CORRECTION_STATEMENT}
          </Label>
        </div>
        {f.may_publish && publish === 'no' ? (
          <Alert tone="note" title="Keeping it out cannot be undone">
            A correction can take permission to publish back, never give it.
          </Alert>
        ) : null}
        {problem ? <Alert tone="serious" title={problem} /> : null}
        {send.isError ? (
          <Alert tone="serious" title="Nothing was filed">
            {send.error.message}
          </Alert>
        ) : null}
        <div>
          <Button
            type="button"
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
              if (!attested) {
                setProblem('Tick the statement first.');
                return;
              }
              setProblem(null);
              send.mutate();
            }}
          >
            File the correction
          </Button>
        </div>
      </section>

      <section aria-labelledby="history" className="flex flex-col gap-2">
        <h2 id="history" className="font-display text-xl font-bold">
          What has been done to it
        </h2>
        <ul className="flex flex-col gap-2">
          {f.history.map((h) => (
            <li key={h.public_ref} className="text-sm">
              <time dateTime={h.at}>{new Date(h.at).toLocaleString()}</time> ·{' '}
              {h.action === 'filed' ? 'Filed' : 'Corrected'} as{' '}
              <span className="font-mono">{h.public_ref}</span> by {h.by}
              {h.comment ? `: ${h.comment}` : ''}
            </li>
          ))}
        </ul>
      </section>
    </Page>
  );
}
