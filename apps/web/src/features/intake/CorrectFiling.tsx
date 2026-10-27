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
import { useState } from 'react';
import { Back } from '../../mockup/Back.tsx';
import { Btn } from '../../mockup/Btn.tsx';
import { CheckBox, Field, FieldDescription, Input, Label, Select, Textarea } from '@/mockup/Field.tsx';
import { Note } from '../../mockup/Note.tsx';
import { Problem } from '../../mockup/Notice.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import {
  askedQuestions,
  cardProblem,
  rawFromAnswers,
  toSubmission,
  withChange,
} from '@/features/form/walk.ts';
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
      <StaffPage area="Your organization" title="Not an account you filed">
        <p>{filing.error.message}</p>
        <Back to="/intake">All your batches</Back>
      </StaffPage>
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
    <StaffPage
      area="Your organization"
      title={`Correct ${f.public_ref}`}
      mono
      lede={`${f.logbook_title} · filed through ${f.filed_via} · ${f.moderation_status === 'pending' ? 'waiting for a moderator' : 'read by a moderator'}`}
    >
      <Back to={`/intake/${String(f.batch_id)}`}>Back to the batch</Back>
      {done ? (
        <Note>
          <b>{done}</b>
        </Note>
      ) : null}

      <Panel title="The correction">
        <p className="muted">
          A correction is a new version of the report. The one before it is kept, and both can be
          checked. It is recorded as yours; the organization is shown publicly, you are not.
        </p>
        <Questions
          idPrefix="fix"
          questions={f.questions}
          raw={raw}
          onChange={(key, v) => {
            setRaw((x) => withChange(f.questions, x, key, v));
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
        <CheckBox
          id="attest-correction"
          checked={attested}
          onChange={(e) => {
            setAttested(e.target.checked);
          }}
        >
          {CORRECTION_STATEMENT}
        </CheckBox>
        {f.may_publish && publish === 'no' ? (
          <Note>
            <b>Keeping it out cannot be undone.</b> A correction can take permission to publish
            back, never give it.
          </Note>
        ) : null}
        {problem ? <Problem>{problem}</Problem> : null}
        {send.isError ? <Problem title="Nothing was filed.">{send.error.message}</Problem> : null}
        <div className="acts">
          <Btn
            sm
            flat
            look="ink"
            disabled={send.isPending}
            onClick={() => {
              setDone(null);
              const missing = asked.find((q) => cardProblem(q, raw, f.questions));
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
          </Btn>
        </div>
      </Panel>

      <Panel title="What has been done to it">
        <div className="code">
          {f.history
            .map(
              (h) =>
                `${new Date(h.at).toLocaleString()} · ${h.action === 'filed' ? 'Filed' : 'Corrected'} as ${h.public_ref} by ${h.by}${h.comment ? `: ${h.comment}` : ''}`,
            )
            .join('\n')}
        </div>
      </Panel>
    </StaffPage>
  );
}
