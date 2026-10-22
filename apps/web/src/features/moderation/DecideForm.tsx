/**
 * The Decide form: the same form on the report page, in its phone sheet, and
 * under a queue row's "Decide here", so all three record the same decision
 * row through the same call (`decideReport`).
 *
 * THE CHOICE COMES FIRST. Approve, Decline or Unclear for now, as three
 * choice cards; the reason the reporter is told appears under Decline, below
 * the answer just given, never above or around it.
 *
 * THE NOTE IS REQUIRED. The design drew it as optional; the server keeps
 * every decision with a written reason (queue.ts, `reasonOf`), and that rule
 * has its own test. So the form asks for it, and says it is never sent.
 */
import { REJECTION_REASONS, decideReport } from '@reportlog/contracts';
import type { QueueItem } from '@reportlog/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Field, FieldDescription, FieldError } from '../../components/ui/field.tsx';
import { Label } from '../../components/ui/label.tsx';
import { RadioGroup, RadioOption } from '../../components/ui/radio-group.tsx';
import { Select } from '../../components/ui/select.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { call } from '../../lib/api.ts';

export type Decision = 'valid' | 'invalid' | 'unknown';

/** What became of the email a decline sends. Said, so nobody assumes a reporter was told. */
export const NOTICE_WORDS: Record<string, string> = {
  sent: 'The reporter was emailed the reason.',
  no_key:
    'The reporter erased their address, so nobody could be told. That is recorded; the decision stands.',
  failed: 'The email could not be sent. That is recorded.',
  not_configured: 'This site has no contact key set, so no email could be sent.',
};

/** "approved", "declined", "marked unclear": for the toast after a decision. */
export const DECIDED_WORDS: Record<Decision, string> = {
  valid: 'approved',
  invalid: 'declined',
  unknown: 'marked unclear',
};

export interface Decided {
  status: Decision;
  notice: string;
}

export function DecideForm({
  report,
  initial,
  onDecided,
  onDirty,
  onCancel,
  focusOnOpen = false,
}: {
  report: Pick<QueueItem, 'thread_id' | 'public_ref'>;
  /** A choice already made, by the phone bar's Approve… or Decline…. */
  initial?: Decision | undefined;
  onDecided?: (d: Decided) => void;
  /** Told whenever the form starts or stops holding something unsaved. */
  onDirty?: (dirty: boolean) => void;
  /** Shown as a quiet Cancel beside the button, when the form can be put away. */
  onCancel?: () => void;
  /** Put focus on the first choice when the form appears (a queue row's Decide here). */
  focusOnOpen?: boolean;
}) {
  const qc = useQueryClient();
  const id = useId();
  const [choice, setChoice] = useState<Decision | ''>(initial ?? '');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [problems, setProblems] = useState<{
    choice?: string | undefined;
    reason?: string | undefined;
    note?: string | undefined;
  }>({});
  const choiceRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLSelectElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const dirty = choice !== (initial ?? '') || reason !== '' || note.trim() !== '';
  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);

  useEffect(() => {
    if (!focusOnOpen) return;
    choiceRef.current?.querySelector<HTMLElement>('[role="radio"]')?.focus();
  }, [focusOnOpen]);

  const decide = useMutation({
    mutationFn: (status: Decision) =>
      call(decideReport, {
        params: { threadId: report.thread_id },
        body: {
          status,
          comment: note.trim(),
          ...(status === 'invalid' ? { reason_code: reason } : {}),
        },
      }),
    onSuccess: async (out, status) => {
      setNote('');
      setReason('');
      onDirty?.(false);
      onDecided?.({ status, notice: out.notice });
      await qc.invalidateQueries({ queryKey: ['moderation'] });
      await qc.invalidateQueries({ queryKey: ['board'] });
    },
  });

  const submit = () => {
    const found: typeof problems = {};
    if (!choice) found.choice = 'Choose approve, decline or unclear for now.';
    if (choice === 'invalid' && !reason) found.reason = 'Choose the reason the reporter is told.';
    if (!note.trim()) found.note = 'Write a note for the record. It is never sent to anybody.';
    else if (note.trim().length > 2000) found.note = 'Keep the note under 2000 characters.';
    setProblems(found);
    if (found.choice) {
      choiceRef.current?.querySelector<HTMLElement>('[role="radio"]')?.focus();
      return;
    }
    if (found.reason) {
      reasonRef.current?.focus();
      return;
    }
    if (found.note) {
      noteRef.current?.focus();
      return;
    }
    if (choice) decide.mutate(choice);
  };

  return (
    <form
      aria-label={`Decide ${report.public_ref}`}
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field>
        <Label>Your decision</Label>
        <RadioGroup
          ref={choiceRef}
          value={choice}
          onValueChange={(v) => {
            setChoice(v as Decision);
            setProblems((p) => ({ ...p, choice: undefined }));
          }}
          aria-invalid={problems.choice ? true : undefined}
        >
          <RadioOption
            id={`${id}-valid`}
            value="valid"
            label="Approve"
            hint="Publishes the text. Files only if the reporter allowed it."
          />
          <RadioOption
            id={`${id}-invalid`}
            value="invalid"
            label="Decline"
            hint="The reporter is told one reason from the list."
          />
          <RadioOption
            id={`${id}-unknown`}
            value="unknown"
            label="Unclear for now"
            hint="Stays out of the public archive; you or another moderator decide later."
          />
        </RadioGroup>
        <FieldError>{problems.choice}</FieldError>
      </Field>
      {choice === 'invalid' ? (
        <Field>
          <Label>The reason the reporter is told</Label>
          <FieldDescription>
            They are emailed this reason and a link to the terms, if their address can still be
            read. They are never sent what you write below.
          </FieldDescription>
          <Select
            ref={reasonRef}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setProblems((p) => ({ ...p, reason: undefined }));
            }}
          >
            <option value="">Choose a reason</option>
            {REJECTION_REASONS.map((x) => (
              <option key={x.code} value={x.code}>
                {x.label}
              </option>
            ))}
          </Select>
          <FieldError>{problems.reason}</FieldError>
        </Field>
      ) : null}
      <Field>
        <Label>Note for the record (never sent)</Label>
        <FieldDescription>Kept on the record with your name. Not shown publicly.</FieldDescription>
        <Textarea
          ref={noteRef}
          rows={3}
          value={note}
          maxLength={2000}
          onChange={(e) => {
            setNote(e.target.value);
            setProblems((p) => ({ ...p, note: undefined }));
          }}
        />
        <FieldError>{problems.note}</FieldError>
      </Field>
      {decide.isError ? <Alert tone="serious">{decide.error.message}</Alert> : null}
      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" block busy={decide.isPending} busyLabel="Recording…">
          Record the decision
        </Button>
        {onCancel ? (
          <Button type="button" variant="quiet" className="self-end" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
