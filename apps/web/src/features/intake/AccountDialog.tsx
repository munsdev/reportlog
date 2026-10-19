/**
 * One account, typed up in a dialog rather than inline: a coordinator works
 * through a stack of paper one sheet at a time, and a long editable list on
 * screen invites typing into the wrong row.
 *
 * Saving never refuses for something missing. Staging is the point: the batch's
 * review says what each account still needs, and nothing is filed until then.
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
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Field, FieldDescription } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Select } from '@/components/ui/select.tsx';
import { rawFromAnswers, toSubmission } from '@/features/form/walk.ts';
import type { RawAnswers } from '@/features/form/walk.ts';
import { call } from '@/lib/api.ts';
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
    <Dialog
      open
      onOpenChange={(on) => {
        if (!on) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>Account {draft.ordinal}</DialogTitle>
        <DialogDescription>
          Type it as it was given to you. Anything missing is listed before the batch is filed.
        </DialogDescription>
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
            setRaw({ ...shown, [key]: v });
          }}
          showProblems={false}
        />
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
            Which sheet or call it was, so you can find it again. Never published, and not part of
            the report.
          </FieldDescription>
          <Input
            value={sourceRef}
            onChange={(e) => {
              setSourceRef(e.target.value);
            }}
          />
        </Field>
        <PublicationChoice card={card.data} value={publish} onChange={setPublish} />
        {save.isError ? (
          <Alert tone="serious" title="It was not saved">
            {save.error.message}
          </Alert>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            Save this account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
