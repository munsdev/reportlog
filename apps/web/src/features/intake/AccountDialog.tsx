/**
 * One account, typed up in a dialog rather than inline: a coordinator works
 * through a stack of paper one sheet at a time, and a long editable list on
 * screen invites typing into the wrong row.
 *
 * Saving never refuses for something missing. Staging is the point: the batch's
 * review says what each account still needs, and nothing is filed until then.
 *
 * Files the person handed over are attached to the account as it is typed
 * up (AccountFiles.tsx), and are sealed into the report when it is filed.
 *
 * The publication answer is what the person the coordinator spoke to said,
 * to the wording coordinators are shown. Its digest comes from the server
 * with that wording and goes back with the answer.
 */
import { updateIntakeDraft } from '@reportlog/contracts';
import type { DraftPayload, IntakeDraft } from '@reportlog/contracts';
import { INTAKE_METHODS, INTAKE_METHOD_LABELS } from '@reportlog/seal';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Btn } from '../../mockup/Btn.tsx';
import { Field, FieldDescription, Input, Label, Select } from '../../mockup/Form.tsx';
import { Modal } from '../../mockup/Modal.tsx';
import { Problem } from '../../mockup/Notice.tsx';
import { rawFromAnswers, toSubmission, withChange } from '@/features/form/walk.ts';
import type { RawAnswers } from '@/features/form/walk.ts';
import { call } from '@/lib/api.ts';
import { AccountFiles } from './AccountFiles.tsx';
import { PublicationChoice, Questions } from './parts.tsx';
import { coordinatorCardQuery, logbookQuery, openLogbooksQuery } from './queries.ts';

export function AccountDialog({
  draft,
  onClose,
  onSaved,
}: {
  draft: IntakeDraft;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const p = draft.payload;
  const logbooks = useQuery(openLogbooksQuery);
  const card = useQuery(coordinatorCardQuery);
  const open = logbooks.data?.logbooks ?? [];
  const [slug, setSlug] = useState(
    () => p.logbook ?? (open.length === 1 && open[0] ? open[0].slug : ''),
  );
  const form = useQuery({ ...logbookQuery(slug), enabled: Boolean(slug) });
  const questions = form.data?.fields ?? [];
  const fileQuestion = questions.find((q) => q.kind === 'file');
  const [sending, setSending] = useState(false);
  // Answers are read back into the controls once the questions are known;
  // until then they are held as they were saved.
  const [raw, setRaw] = useState<RawAnswers | null>(null);
  const shown = raw ?? (questions.length ? rawFromAnswers(questions, p.answers ?? {}) : {});
  const [method, setMethod] = useState(p.intake_method ?? '');
  const [collected, setCollected] = useState(p.collected_on ?? '');
  const [sourceRef, setSourceRef] = useState(p.source_ref ?? '');
  const [publish, setPublish] = useState(
    p.may_publish === true ? 'yes' : p.may_publish === false ? 'no' : '',
  );

  const save = useMutation({
    mutationFn: () => {
      const body: DraftPayload = {
        ...(slug ? { logbook: slug } : {}),
        answers: questions.length ? toSubmission(questions, shown) : (p.answers ?? {}),
        ...(method ? { intake_method: method } : {}),
        ...(collected ? { collected_on: collected } : {}),
        ...(sourceRef.trim() ? { source_ref: sourceRef.trim() } : {}),
        ...(publish && card.data
          ? { may_publish: publish === 'yes', may_publish_digest: card.data.digest }
          : {}),
      };
      return call(updateIntakeDraft, { params: { id: draft.id }, body });
    },
    onSuccess: async () => {
      await onSaved();
      onClose();
    },
  });

  return (
    <Modal
      title={`Account ${String(draft.ordinal)}`}
      description="Type it as it was given to you. Anything missing is listed before the batch is filed."
      open
      onClose={onClose}
      onSubmit={() => {
        if (!save.isPending && !sending) save.mutate();
      }}
      buttons={
        <>
          <Btn sm flat look="ink" type="submit" disabled={save.isPending || sending}>
            {sending ? 'A file is still sending…' : 'Save this account'}
          </Btn>
          <Btn sm flat look="ghost" onClick={onClose}>
            Cancel
          </Btn>
        </>
      }
    >
      <Field>
        <Label>Which logbook</Label>
        <Select
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setRaw({});
          }}
        >
          <option value="">{open.length ? 'Choose one' : 'No logbook is taking reports'}</option>
          {open.map((l) => (
            <option key={l.slug} value={l.slug}>
              {l.title}
            </option>
          ))}
          {slug && !open.some((l) => l.slug === slug) ? (
            <option value={slug}>{slug} (not taking reports)</option>
          ) : null}
        </Select>
      </Field>
      {form.isPending && slug ? <p role="status">Loading the questions…</p> : null}
      <Questions
        idPrefix={`draft-${String(draft.id)}`}
        questions={questions}
        raw={shown}
        onChange={(key, v) => {
          setRaw(withChange(questions, shown, key, v));
        }}
        showProblems={false}
      />
      {slug && fileQuestion ? (
        <AccountFiles
          key={slug}
          draftId={draft.id}
          logbook={slug}
          question={fileQuestion}
          onBusy={setSending}
        />
      ) : null}
      <Field>
        <Label>How it was collected</Label>
        <Select
          value={method}
          onChange={(e) => {
            setMethod(e.target.value);
          }}
        >
          <option value="">Choose one</option>
          {INTAKE_METHODS.map((m) => (
            <option key={m} value={m}>
              {INTAKE_METHOD_LABELS[m]}
            </option>
          ))}
        </Select>
      </Field>
      <Field>
        <Label>The day it was collected</Label>
        <FieldDescription>If you know it.</FieldDescription>
        <Input
          type="date"
          value={collected}
          onChange={(e) => {
            setCollected(e.target.value);
          }}
        />
      </Field>
      <Field>
        <Label>Your own reference for it</Label>
        <FieldDescription>
          Which sheet or call it was, so you can find it again. Never published, and not part of the
          report.
        </FieldDescription>
        <Input
          value={sourceRef}
          onChange={(e) => {
            setSourceRef(e.target.value);
          }}
        />
      </Field>
      <PublicationChoice card={card.data} value={publish} onChange={setPublish} />
      {save.isError ? <Problem title="It was not saved.">{save.error.message}</Problem> : null}
    </Modal>
  );
}
