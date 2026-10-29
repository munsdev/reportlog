/**
 * The Decide form: the same form on the report page, in its phone sheet, and
 * under a queue row's "Decide here", so all three record the same decision
 * row through the same call (`decideReport`).
 *
 * THE CHOICE COMES FIRST. Approve, Decline or Unclear for now, as three
 * of the mock-up's `.choice` rows; the reason the reporter is told appears under Decline, below
 * the answer just given, never above or around it.
 *
 * THE NOTE IS OPTIONAL (decision 64); only its length is checked.
 *
 * JOURNALIST SHARING IS PART OF THE DECISION (docs/design/moderation-unified.md).
 * Approving a report whose written account nobody has decided offers, for
 * each one the reporter allowed journalists to read, "Write a note for
 * journalists" beside "Leave it with the report (staff only)", which is
 * already chosen: ignoring it is doing nothing wrong. One the reporter did not
 * allow is not asked about at all; it is left with the report. Only "Illegal"
 * asks for a reason. A link nobody has judged is judged here, once for every
 * copy, with no reason asked.
 */
import {
  LINK_REASONS,
  REJECTION_REASONS,
  TEXT_ERASE_REASONS,
  decideReport,
  getReportWritten,
} from '@reportlog/contracts';
import type { LinkReason } from '@reportlog/contracts';
import type { QueueItem } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { Btn } from '../../mockup/Btn.tsx';
import { Choice, Choices } from '@/mockup/Choice.tsx';
import { CheckBox, Field, FieldDescription, Label, Select, Textarea } from '@/mockup/Field.tsx';
import { Err, Problem } from '../../mockup/Notice.tsx';
import { call } from '../../lib/api.ts';
import { Hotlines } from './LinkVerdict.tsx';
import { ChangedProblem, isChanged } from './viewing.tsx';
import { ERASE_WORDS, LEFT_WHY, NOTE_WHY, WHY_MAX, WHY_MIN } from './Written.tsx';

/** The mock-up's labelled controls, one line each. */
function SelectField({
  label,
  help,
  children,
  ...rest
}: { label: ReactNode; help?: ReactNode } & ComponentProps<'select'>) {
  return (
    <Field>
      <Label>{label}</Label>
      {help ? <FieldDescription>{help}</FieldDescription> : null}
      <Select {...rest}>{children}</Select>
    </Field>
  );
}
function AreaField({
  label,
  help,
  ...rest
}: { label: ReactNode; help?: ReactNode } & ComponentProps<'textarea'>) {
  return (
    <Field>
      <Label>{label}</Label>
      {help ? <FieldDescription>{help}</FieldDescription> : null}
      <Textarea {...rest} />
    </Field>
  );
}

/** On the record for a link judged here: the decision asks no reason but illegal's. */
const LINK_WHY = 'Judged when the report was approved.';

interface WrittenChoice {
  /** Empty: not chosen. A written account starts at "withheld" (leave it). */
  outcome: string;
  /** Illegal only: the reason for the record. */
  why: string;
  /** Illegal only: the category. */
  reason: string;
  /** Illegal only: the tick that says it cannot be undone. */
  sure: boolean;
  /** The note for journalists, when the choice is to write one. */
  note: string;
}
const EMPTY_CHOICE: WrittenChoice = { outcome: '', why: '', reason: '', sure: false, note: '' };

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
  report: Pick<QueueItem, 'thread_id' | 'public_ref' | 'has_undecided_written' | 'seen'>;
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
  const [written, setWritten] = useState<Record<string, WrittenChoice>>({});
  const [problems, setProblems] = useState<{
    choice?: string | undefined;
    reason?: string | undefined;
    note?: string | undefined;
    written?: string | undefined;
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
    choiceRef.current?.querySelector<HTMLElement>('input[type="radio"]')?.focus();
  }, [focusOnOpen]);

  // Approving a report that holds a written account or link nobody has
  // decided settles each in this same step: the server asks it (approval.ts).
  const needsWritten = choice === 'valid' && report.has_undecided_written;
  const panel = useQuery({
    queryKey: ['written', report.thread_id],
    queryFn: ({ signal }) =>
      call(getReportWritten, { params: { threadId: report.thread_id }, signal }),
    enabled: needsWritten,
  });
  const undecided = needsWritten
    ? [
        ...(panel.data?.texts ?? [])
          .filter((t) => t.outcome === null)
          .map((t) => ({ ref: t.ref, isLink: false, shared: t.shared })),
        ...(panel.data?.links ?? [])
          .filter((l) => l.outcome === null && l.group_id !== null)
          .map((l) => ({ ref: l.ref, isLink: true, shared: false })),
      ]
    : [];
  // An account the reporter did not share has nothing to decide: it is left
  // with the report. So is one the moderator did not touch.
  const asked = undecided.filter((u) => u.isLink || u.shared);
  const choiceOf = (u: { ref: string; isLink: boolean }) =>
    written[u.ref] ?? (u.isLink ? EMPTY_CHOICE : { ...EMPTY_CHOICE, outcome: 'withheld' });
  const setChoiceOf = (u: { ref: string; isLink: boolean }, patch: Partial<WrittenChoice>) => {
    setWritten((w) => ({ ...w, [u.ref]: { ...choiceOf(u), ...patch } }));
  };
  const writtenReady = undecided.every((u) => {
    const c = choiceOf(u);
    return (
      c.outcome !== '' &&
      (c.outcome !== 'redacted' || c.note.trim() !== '') &&
      (c.outcome !== 'illegal' ||
        (c.reason !== '' &&
          c.sure &&
          c.why.trim().length >= WHY_MIN &&
          c.why.trim().length <= WHY_MAX))
    );
  });

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
          ...(status === 'valid' && undecided.length
            ? {
                written: undecided.map((u) => {
                  const c = choiceOf(u);
                  // Only illegal asks for a reason; the server keeps one with
                  // every decision, so the others carry what was done.
                  const why =
                    c.outcome === 'illegal'
                      ? c.why.trim()
                      : u.isLink
                        ? LINK_WHY
                        : c.outcome === 'redacted'
                          ? NOTE_WHY
                          : LEFT_WHY;
                  return {
                    ref: u.ref,
                    outcome: c.outcome,
                    why,
                    ...(c.outcome === 'illegal' ? { reason: c.reason } : {}),
                    ...(c.outcome === 'redacted' ? { note: c.note.trim() } : {}),
                  };
                }),
              }
            : {}),
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
    // The note is optional (decision 64); only its length is checked.
    if (note.trim().length > 2000) found.note = 'Keep the note under 2000 characters.';
    setProblems(found);
    if (found.choice) {
      choiceRef.current?.querySelector<HTMLElement>('input[type="radio"]')?.focus();
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
    if (needsWritten && (panel.isPending || !writtenReady)) {
      setProblems((p) => ({
        ...p,
        written:
          'Judge each link below. A note needs its words; erasing as illegal needs a category, a reason of 10 to 500 characters and the tick.',
      }));
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
      {needsWritten && (panel.isPending || asked.length) ? (
        <div className="col" role="group" aria-labelledby={`${id}-written`}>
          <h3 id={`${id}-written`}>Its written account and links</h3>
          <p className="m">
            Read them on this page first if you need to. A written account stays with the report,
            for staff only, unless you choose otherwise.
          </p>
          {panel.isPending ? <p role="status">Reading what the report holds…</p> : null}
          {panel.isError ? <Problem>{panel.error.message}</Problem> : null}
          {asked.map((u) => {
            const c = choiceOf(u);
            const same = asked.filter((x) => x.isLink === u.isLink);
            const base = u.isLink ? 'Link' : 'Written account';
            const name = same.length > 1 ? `${base} ${String(same.indexOf(u) + 1)}` : base;
            // A link keeps its own verdicts (a link is not prose), judged
            // once for every copy. A written account is never passed on as
            // it was written: a moderator may write a note about it.
            const options: [string, string][] = u.isLink
              ? [
                  ['checked', 'Passes: vetted journalists may see it'],
                  ['withheld', 'Withheld: journalists never see it'],
                  ['illegal', 'Illegal: erase every copy now'],
                ]
              : [
                  ['withheld', 'Leave it with the report (staff only)'],
                  ['redacted', 'Write a note for journalists'],
                  ['illegal', 'Illegal: erase it now'],
                ];
            return (
              <div key={u.ref} className="col" role="radiogroup" aria-label={name}>
                <span className="lbl">{name}</span>
                <Choices>
                  {options.map(([v, label]) => (
                    <Choice
                      key={v}
                      name={`${id}-${u.ref}`}
                      value={v}
                      checked={c.outcome === v}
                      onChange={() => {
                        setChoiceOf(u, { outcome: v });
                      }}
                    >
                      {label}
                    </Choice>
                  ))}
                </Choices>
                {c.outcome === 'redacted' ? (
                  <AreaField
                    label={`${name}: note for journalists`}
                    help="Write it in your own words. Put anything you quote in quotation marks."
                    rows={4}
                    value={c.note}
                    onChange={(e) => {
                      setChoiceOf(u, { note: e.target.value });
                    }}
                  />
                ) : null}
                {c.outcome === 'illegal' ? (
                  <>
                    {u.isLink ? <Hotlines /> : null}
                    <SelectField
                      label="Why it is illegal"
                      value={c.reason}
                      onChange={(e) => {
                        setChoiceOf(u, { reason: e.target.value });
                      }}
                    >
                      <option value="">Choose one</option>
                      {u.isLink
                        ? (Object.keys(LINK_REASONS) as LinkReason[]).map((r) => (
                            <option key={r} value={r}>
                              {LINK_REASONS[r]}
                            </option>
                          ))
                        : TEXT_ERASE_REASONS.map((r) => (
                            <option key={r} value={r}>
                              {ERASE_WORDS[r]}
                            </option>
                          ))}
                    </SelectField>
                    <AreaField
                      label={`${name}: your reason (for the record)`}
                      help="10 to 500 characters. Only staff can read it. Describe the kind of thing, not the words."
                      rows={2}
                      value={c.why}
                      maxLength={WHY_MAX}
                      onChange={(e) => {
                        setChoiceOf(u, { why: e.target.value });
                      }}
                    />
                    <CheckBox
                      checked={c.sure}
                      onChange={(e) => {
                        setChoiceOf(u, { sure: e.target.checked });
                      }}
                    >
                      {u.isLink
                        ? 'I have followed the procedure above. Every copy will be erased and cannot be brought back.'
                        : 'The words will be erased now and cannot be brought back. A marker stays.'}
                    </CheckBox>
                  </>
                ) : null}
              </div>
            );
          })}
          <Err>{problems.written}</Err>
        </div>
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
