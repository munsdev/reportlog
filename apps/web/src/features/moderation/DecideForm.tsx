/**
 * The Decide form: the same form on the report page, in its phone sheet, and
 * under a queue row's "Decide here", so all three record the same decision
 * row through the same call (`decideReport`).
 *
 * THE CHOICE COMES FIRST. Approve, Decline or Unclear for now, as three
 * of the mock-up's `.choice` rows; the reason the reporter is told appears under Decline, below
 * the answer just given, never above or around it.
 *
 * RATING IS OFFERED AT APPROVAL, NEVER ASKED FOR. Choosing Approve on a
 * report nobody has rated shows the severity choice under it, starting on
 * "Not now" so nothing slides through as a default. A rating chosen here goes
 * with the decision in one request and one transaction (`decideReport`'s
 * `severity`), and needs its own reason, as on the Severity row. Approving in
 * a batch cannot rate; the queue's "Not rated" button lists what is left.
 *
 * APPROVING DECIDES NO ATTACHMENT (decision 83). It puts the report on the
 * counts, the board and the maps, and nothing more: its written accounts,
 * links and files keep their own status and are reviewed on the report page.
 * So nothing here asks about them, and a report holding them approves like
 * any other, alone or in a batch.
 *
 * THE NOTE IS OPTIONAL (decision 64). Written, it goes on the record and is
 * never sent to the reporter; left empty it is stored as none. Only taking a
 * report off the board, or putting it back, still needs a reason
 * (queue.ts, `reasonOf`).
 */
import { REJECTION_REASONS, decideReport } from '@reportlog/contracts';
import type { QueueItem } from '@reportlog/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { Btn } from '../../mockup/Btn.tsx';
import { Choice, Choices } from '@/mockup/Choice.tsx';
import { Field, FieldDescription, Label } from '@/mockup/Field.tsx';
import { Err, Problem } from '../../mockup/Notice.tsx';
import { call } from '../../lib/api.ts';
import { ChangedProblem, isChanged } from './viewing.tsx';
import { SEVERITIES, SEVERITY_WORDS } from './words.ts';

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
  title,
  bare = false,
}: {
  report: Pick<QueueItem, 'thread_id' | 'public_ref' | 'attachments_waiting' | 'seen' | 'severity'>;
  /** A choice already made, by the phone bar's Approve… or Decline…. */
  initial?: Decision | undefined;
  onDecided?: (d: Decided) => void;
  /** Told whenever the form starts or stops holding something unsaved. */
  onDirty?: (dirty: boolean) => void;
  /** Shown as a quiet Cancel beside the button, when the form can be put away. */
  onCancel?: () => void;
  /** Put focus on the first choice when the form appears (a queue row's Decide here). */
  focusOnOpen?: boolean;
  /** A heading for the panel, on the report page; a queue row has none. */
  title?: string;
  /** Without the panel's box, for a form that sits inside a dialog already. */
  bare?: boolean;
}) {
  const qc = useQueryClient();
  const id = useId();
  const [choice, setChoice] = useState<Decision | ''>(initial ?? '');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [severity, setSeverity] = useState('');
  const [severityWhy, setSeverityWhy] = useState('');
  const [problems, setProblems] = useState<{
    choice?: string | undefined;
    severityWhy?: string | undefined;
    reason?: string | undefined;
    note?: string | undefined;
  }>({});
  const choiceRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLSelectElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const severityWhyRef = useRef<HTMLTextAreaElement>(null);

  // Offered only when approving a report nobody has rated: changing a rating
  // is the Severity row's, where the current one is shown beside it.
  const offerRating = choice === 'valid' && report.severity === null;
  const rating = offerRating ? severity : '';

  const dirty =
    choice !== (initial ?? '') ||
    reason !== '' ||
    note.trim() !== '' ||
    severity !== '' ||
    severityWhy.trim() !== '';
  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);

  useEffect(() => {
    if (!focusOnOpen) return;
    choiceRef.current?.querySelector<HTMLElement>('input[type="radio"]')?.focus();
  }, [focusOnOpen]);

  const decide = useMutation({
    mutationFn: (status: Decision) =>
      call(decideReport, {
        params: { threadId: report.thread_id },
        body: {
          status,
          ...(note.trim() ? { comment: note.trim() } : {}),
          ...(status === 'invalid' ? { reason_code: reason } : {}),
          // The version this page showed: refused if somebody acted on it since.
          seen: report.seen,
          ...(status === 'valid' && rating
            ? { severity: rating, severity_comment: severityWhy.trim() }
            : {}),
        },
      }),
    onSuccess: async (out, status) => {
      setNote('');
      setReason('');
      setSeverity('');
      setSeverityWhy('');
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
    // The note is optional (decision 64); only its length is checked.
    if (note.trim().length > 2000) found.note = 'Keep the note under 2000 characters.';
    if (rating && !severityWhy.trim()) {
      found.severityWhy = 'Say why this rating, or set the rating back to "Not now".';
    } else if (severityWhy.trim().length > 2000) {
      found.severityWhy = 'Keep the reason under 2000 characters.';
    }
    setProblems(found);
    if (found.choice) {
      choiceRef.current?.querySelector<HTMLElement>('input[type="radio"]')?.focus();
      return;
    }
    if (found.reason) {
      reasonRef.current?.focus();
      return;
    }
    if (found.severityWhy) {
      severityWhyRef.current?.focus();
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
      className={bare ? 'col' : 'panel'}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {title ? <h2>{title}</h2> : null}
      <div ref={choiceRef} role="radiogroup" aria-labelledby={`${id}-decision`}>
        <span className="lbl" id={`${id}-decision`}>
          Your decision
        </span>
        <Choices>
          {(
            [
              ['valid', 'Approve'],
              ['invalid', 'Decline'],
              ['unknown', 'Unclear for now'],
            ] as const
          ).map(([v, label]) => (
            <Choice
              key={v}
              name={`${id}-decision`}
              value={v}
              checked={choice === v}
              onChange={() => {
                setChoice(v);
                setProblems((p) => ({ ...p, choice: undefined }));
              }}
            >
              {label}
            </Choice>
          ))}
        </Choices>
        <Err>{problems.choice}</Err>
      </div>
      {choice === 'invalid' ? (
        <>
          <Field controlId={`${id}-reason`}>
            <Label>The reason the reporter is told</Label>
            <FieldDescription>
              They are emailed this reason and a link to the terms, if their address can still be
              read. They are never sent what you write below.
            </FieldDescription>
            <select
              ref={reasonRef}
              id={`${id}-reason`}
              className="sel"
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
            </select>
          </Field>
          <Err>{problems.reason}</Err>
        </>
      ) : null}
      {offerRating ? (
        <>
          <Field controlId={`${id}-severity`}>
            <Label>Rate its severity (optional)</Label>
            <FieldDescription>
              A moderator’s judgement, kept beside the report and never part of what was sealed.
              Staff only. You can rate it later on the Severity row instead.
            </FieldDescription>
            <select
              id={`${id}-severity`}
              className="sel"
              value={severity}
              onChange={(e) => {
                setSeverity(e.target.value);
                setProblems((p) => ({ ...p, severityWhy: undefined }));
              }}
            >
              <option value="">Not now</option>
              {SEVERITIES.map((k) => (
                <option key={k} value={k}>
                  {SEVERITY_WORDS[k]?.label} ({SEVERITY_WORDS[k]?.hint})
                </option>
              ))}
            </select>
          </Field>
          {severity ? (
            <>
              <Field controlId={`${id}-severity-why`}>
                <Label>Why this rating</Label>
                <FieldDescription>
                  Kept on the record with your name. Not shown publicly.
                </FieldDescription>
                <textarea
                  ref={severityWhyRef}
                  id={`${id}-severity-why`}
                  className="textarea"
                  rows={2}
                  value={severityWhy}
                  maxLength={2000}
                  onChange={(e) => {
                    setSeverityWhy(e.target.value);
                    setProblems((p) => ({ ...p, severityWhy: undefined }));
                  }}
                />
              </Field>
              <Err>{problems.severityWhy}</Err>
            </>
          ) : null}
        </>
      ) : null}
      {choice === 'valid' && report.attachments_waiting > 0 ? (
        <p className="m">
          Approving puts it on the counts, the board and the maps. Its{' '}
          {report.attachments_waiting === 1
            ? 'attachment still waiting is'
            : `${String(report.attachments_waiting)} attachments still waiting are`}{' '}
          reviewed on their own and stay hidden until then.
        </p>
      ) : null}
      <Field controlId={`${id}-note`}>
        <Label>Note for the record (never sent)</Label>
        <FieldDescription>Kept on the record with your name. Not shown publicly.</FieldDescription>
        <textarea
          ref={noteRef}
          id={`${id}-note`}
          className="textarea"
          rows={3}
          value={note}
          maxLength={2000}
          onChange={(e) => {
            setNote(e.target.value);
            setProblems((p) => ({ ...p, note: undefined }));
          }}
        />
      </Field>
      <Err>{problems.note}</Err>
      {decide.isError ? (
        isChanged(decide.error) ? (
          <ChangedProblem threadId={report.thread_id} error={decide.error} />
        ) : (
          <Problem>{decide.error.message}</Problem>
        )
      ) : null}
      <div className="acts">
        <Btn sm flat look="ink" type="submit" disabled={decide.isPending}>
          {decide.isPending ? 'Recording…' : 'Record the decision'}
        </Btn>
        {onCancel ? (
          <Btn sm flat look="ghost" onClick={onCancel}>
            Cancel
          </Btn>
        ) : null}
      </div>
    </form>
  );
}
