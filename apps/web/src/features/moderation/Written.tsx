/**
 * A written account (W4): what a reporter wrote in their own words, or what a
 * tip described, on the page of the report or list entry that holds it. These
 * panels replaced the Written accounts page (docs/design/moderation-unified.md):
 * a moderator decides it where they read the rest.
 *
 *   Reveal         the words, only when asked, each opening logged
 *   WrittenPanel   one account: its status, and what can be done with it
 *   Attachments    a report's attachments (accounts, links, files), on its page
 *
 * NOTHING HERE IS PUBLISHED, and a link is text, never an anchor.
 *
 * EACH ATTACHMENT HAS ITS OWN STATUS (decision 83): waiting, shown to
 * journalists, or kept back. Approving the report decides none of them, and
 * declining it keeps all of them back (reportValues/onDesk.ts), whatever they
 * were decided as.
 *
 * WHAT GOES TO JOURNALISTS IS NOT A MODERATOR'S CHORE. When the reporter
 * allowed it, a moderator MAY write a note for journalists, quoting what they
 * choose; otherwise the account stays with the report, for staff only, and
 * nobody has done anything wrong. When the reporter did not allow it, there
 * is nothing to decide and the only act offered is erasing it as illegal. The
 * server refuses a note the reporter did not allow (`NOT_SHARED`) whatever
 * this page offers.
 *
 * ONLY ILLEGAL ASKS FOR A REASON: a category, a reason and a tick, because it
 * erases the words now and cannot be undone. "Leave it" and "Write a note"
 * ask for none, and the server no longer requires one (decision 83).
 */
import {
  TEXT_ERASE_REASONS,
  checkText,
  getReportWritten,
  getText,
  openText,
  redactText,
  reviewRedaction,
} from '@reportlog/contracts';
import type { TextOutcome } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Btn } from '../../mockup/Btn.tsx';
import {
  CheckBox,
  Field,
  FieldDescription,
  FieldError,
  Label,
  Select,
  Textarea,
} from '@/mockup/Field.tsx';
import { Modal } from '../../mockup/Modal.tsx';
import { Note } from '../../mockup/Note.tsx';
import { Problem } from '../../mockup/Notice.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { call } from '../../lib/api.ts';
import { LinkVerdict } from './LinkVerdict.tsx';
import { AttachmentChip, when } from './parts.tsx';
import type { AttachmentState } from './parts.tsx';

export const ERASE_WORDS: Record<(typeof TEXT_ERASE_REASONS)[number], string> = {
  'child-sexual-abuse': 'Child sexual abuse material',
  'terrorist-content': 'Terrorist content',
  'non-consensual-intimate-imagery': 'Intimate images shared without consent',
  'incitement-or-threats': 'Incitement or threats',
  'other-illegal': 'Other illegal content',
  'personal-data': 'Personal data that must not be kept',
};

export const WHY_MIN = 10;
export const WHY_MAX = 500;

/** The state of an account, in words. */
const STATE: Record<TextOutcome, string> = {
  redacted: 'A note for journalists is written',
  withheld: 'Left here, for staff only',
  illegal: 'Erased as illegal',
};

/** Characters, said as a count of them. */
const characters = (n: number) => `${String(n)} ${n === 1 ? 'character' : 'characters'}`;

/** Everything that shows a written account or its state. */
function useWrittenRefresh() {
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries({ queryKey: ['texts'] });
    await qc.invalidateQueries({ queryKey: ['written'] });
    await qc.invalidateQueries({ queryKey: ['moderation'] });
    await qc.invalidateQueries({ queryKey: ['list-review'] });
  };
}

/**
 * The words are not on the page until somebody presses the button, and each
 * press writes an entry in "Who opened protected data" before the words are
 * sent. Opened once, the words stay in front of that person until they leave.
 */
export function Reveal({
  textRef,
  label = 'Show the written account',
  mono = false,
  onOpened,
}: {
  textRef: string;
  label?: string;
  mono?: boolean;
  onOpened?: (text: string) => void;
}) {
  const open = useMutation({
    mutationFn: () => call(openText, { params: { ref: textRef } }),
    onSuccess: (out) => {
      onOpened?.(out.text);
    },
  });
  if (open.data) {
    return (
      <p className={mono ? 'mono break-all whitespace-pre-wrap' : 'whitespace-pre-wrap'}>
        {open.data.text}
      </p>
    );
  }
  return (
    <div className="col">
      <div className="acts">
        <Btn
          sm
          flat
          disabled={open.isPending}
          onClick={() => {
            open.mutate();
          }}
        >
          {open.isPending ? 'Opening…' : label}
        </Btn>
      </div>
      <p className="m">Opening it is recorded with your name.</p>
      {open.isError ? <Problem>{open.error.message}</Problem> : null}
    </div>
  );
}

// ── one account ────────────────────────────────────────────────────────

/**
 * A written account's status. Waiting only while somebody could still show
 * journalists a note about it: the reporter allows it and nobody decided.
 * One the reporter did not allow is kept back by them, and nothing waits.
 */
export function textStatus(
  outcome: TextOutcome | null,
  shared: boolean,
  declined = false,
): AttachmentState {
  if (declined || outcome === 'illegal' || outcome === 'withheld') return 'kept';
  if (outcome === 'redacted') return shared ? 'shown' : 'kept';
  return shared ? 'waiting' : 'kept';
}

/** A link's status, by its group's verdict, under the same ceiling. */
export function linkStatus(
  outcome: 'checked' | 'withheld' | 'illegal' | null,
  shared: boolean,
  declined = false,
): AttachmentState {
  if (declined || !shared) return 'kept';
  if (outcome === null) return 'waiting';
  return outcome === 'checked' ? 'shown' : 'kept';
}

export function WrittenPanel({
  textRef,
  shared,
  outcome,
  length,
  on = 'report',
  title = 'Written account · not published',
  reveal = true,
  declined = false,
}: {
  textRef: string;
  /** The reporter allows journalists now (a tip always does). */
  shared: boolean;
  outcome: TextOutcome | null;
  length?: number | undefined;
  /** What holds it, for the words of "leave it". */
  on?: 'report' | 'entry';
  title?: string;
  /** False where the words are on the page already (a list entry's answers). */
  reveal?: boolean;
  /** Its report is declined, which keeps every attachment back. */
  declined?: boolean;
}) {
  const refresh = useWrittenRefresh();
  const [writing, setWriting] = useState(false);
  const [erasing, setErasing] = useState(false);
  const leave = useMutation({
    mutationFn: () =>
      call(checkText, {
        params: { ref: textRef },
        body: { outcome: 'withheld' },
      }),
    onSuccess: refresh,
  });
  const holder = on === 'report' ? 'report' : 'entry';
  const state = outcome
    ? STATE[outcome]
    : shared
      ? `No note. It stays with the ${holder}, for staff only, unless somebody writes one`
      : `It stays with the ${holder}, for staff only`;
  const status = textStatus(outcome, shared, declined);
  return (
    <Panel title={title} aria-label={title}>
      <div className="chips">
        <AttachmentChip state={status} />
      </div>
      {declined && outcome !== 'illegal' ? (
        <p className="m">The report is declined, so this is kept back whatever is decided.</p>
      ) : null}
      {reveal ? <Reveal textRef={textRef} /> : null}
      <p className="m">
        {length === undefined ? '' : `${characters(length)} · `}
        {shared
          ? on === 'report'
            ? 'The reporter allows vetted journalists to read a note about it'
            : 'A tip may reach vetted journalists through a note about it'
          : 'The reporter did not allow journalists to read it'}{' '}
        · {state}.
      </p>
      {outcome === 'illegal' ? null : (
        <>
          <div className="acts">
            {shared ? (
              <Btn
                sm
                flat
                aria-expanded={writing}
                onClick={() => {
                  setWriting((w) => !w);
                }}
              >
                {outcome === 'redacted'
                  ? 'Read or change the note'
                  : 'Write a note for journalists'}
              </Btn>
            ) : null}
            {shared && outcome === null ? (
              <Btn
                sm
                flat
                look="ghost"
                disabled={leave.isPending}
                onClick={() => {
                  leave.mutate();
                }}
              >
                {`Leave it with the ${holder} (staff only)`}
              </Btn>
            ) : null}
            <Btn
              sm
              flat
              look="ghost"
              onClick={() => {
                setErasing(true);
              }}
            >
              Erase as illegal…
            </Btn>
          </div>
          {leave.isError ? <Problem>{leave.error.message}</Problem> : null}
          {writing ? <NoteEditor textRef={textRef} /> : null}
          {outcome === 'redacted' && !writing ? <NoteReview textRef={textRef} /> : null}
          <EraseIllegal
            textRef={textRef}
            open={erasing}
            onClose={() => {
              setErasing(false);
            }}
          />
        </>
      )}
    </Panel>
  );
}

/**
 * Erasing words as illegal: a category, a reason for the record, and a tick,
 * because the words are gone the moment it is recorded.
 */
function EraseIllegal({
  textRef,
  open,
  onClose,
}: {
  textRef: string;
  open: boolean;
  onClose: () => void;
}) {
  const refresh = useWrittenRefresh();
  const id = useId();
  const [reason, setReason] = useState('');
  const [why, setWhy] = useState('');
  const [sure, setSure] = useState(false);
  const [problem, setProblem] = useState('');
  const erase = useMutation({
    mutationFn: () =>
      call(checkText, {
        params: { ref: textRef },
        body: { outcome: 'illegal', reason, why: why.trim() },
      }),
    onSuccess: async () => {
      onClose();
      await refresh();
    },
  });
  const close = () => {
    setReason('');
    setWhy('');
    setSure(false);
    setProblem('');
    erase.reset();
    onClose();
  };
  return (
    <Modal
      title="Erase this written account as illegal?"
      description="The words are erased now and cannot be brought back. A marker that something was erased stays."
      open={open}
      onClose={close}
      onSubmit={() => {
        if (!reason) {
          setProblem('Choose why it is illegal.');
          return;
        }
        const n = why.trim().length;
        if (n < WHY_MIN || n > WHY_MAX) {
          setProblem('Say why, in 10 to 500 characters.');
          return;
        }
        if (!sure) {
          setProblem('Tick the box to say you understand it cannot be undone.');
          return;
        }
        erase.mutate();
      }}
      buttons={
        <>
          <Btn sm flat look="ink" type="submit" disabled={erase.isPending}>
            {erase.isPending ? 'Erasing…' : 'Erase it now'}
          </Btn>
          <Btn sm flat look="ghost" onClick={close}>
            Cancel
          </Btn>
        </>
      }
    >
      <Field controlId={`${id}-reason`}>
        <Label>Why it is illegal</Label>
        <Select
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setProblem('');
          }}
        >
          <option value="">Choose one</option>
          {TEXT_ERASE_REASONS.map((r) => (
            <option key={r} value={r}>
              {ERASE_WORDS[r]}
            </option>
          ))}
        </Select>
      </Field>
      <Field controlId={`${id}-why`}>
        <Label>Your reason (for the record)</Label>
        <FieldDescription>
          10 to 500 characters. Kept with your name; only staff can read it. Describe the kind of
          thing, not the words.
        </FieldDescription>
        <Textarea
          rows={2}
          value={why}
          maxLength={WHY_MAX}
          onChange={(e) => {
            setWhy(e.target.value);
            setProblem('');
          }}
        />
      </Field>
      <CheckBox
        id={`${id}-sure`}
        checked={sure}
        onChange={(e) => {
          setSure(e.target.checked);
          setProblem('');
        }}
      >
        The words will be erased now and cannot be brought back. A marker stays.
      </CheckBox>
      <FieldError>{problem}</FieldError>
      {erase.isError ? <Problem>{erase.error.message}</Problem> : null}
    </Modal>
  );
}

// ── the note for journalists ───────────────────────────────────────────

const textQuery = (textRef: string) => ({
  queryKey: ['texts', 'one', textRef],
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    call(getText, { params: { ref: textRef }, signal }),
});

/**
 * The original beside the note journalists read. The original is shown only
 * after this person presses Show (which is logged); the note never starts
 * from it: it starts blank, or as it was saved.
 */
function NoteEditor({ textRef }: { textRef: string }) {
  const refresh = useWrittenRefresh();
  const q = useQuery(textQuery(textRef));
  const [body, setBody] = useState<string | null>(null);
  const originalBox = useRef<HTMLDivElement>(null);
  const noteBox = useRef<HTMLTextAreaElement>(null);
  const [shown, setShown] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const id = useId();
  const save = useMutation({
    mutationFn: (copy: string) =>
      call(redactText, { params: { ref: textRef }, body: { body: copy } }),
    onSuccess: refresh,
  });
  const copy = body ?? q.data?.redacted ?? '';
  // Insert what is selected in the original, inside quotation marks, at the
  // cursor (or the end). Only a selection inside the original counts.
  const quote = () => {
    const sel = window.getSelection();
    const picked = sel?.toString().trim() ?? '';
    const inside =
      sel !== null &&
      sel.rangeCount > 0 &&
      originalBox.current?.contains(sel.getRangeAt(0).commonAncestorContainer) === true;
    if (!picked || !inside) {
      setQuoteError('Select some of the original text first.');
      return;
    }
    setQuoteError('');
    const at = noteBox.current?.selectionStart ?? copy.length;
    const end = noteBox.current?.selectionEnd ?? at;
    setBody(`${copy.slice(0, at)}"${picked}"${copy.slice(end)}`);
  };
  if (q.isPending) return <p role="status">Reading it…</p>;
  if (q.isError) return <Problem>{q.error.message}</Problem>;
  return (
    <div className="grid2 even">
      <Panel kind="quiet" title="The original · kept, never changed" headingLevel={3}>
        <div ref={originalBox}>
          <Reveal
            textRef={textRef}
            onOpened={() => {
              setShown(true);
            }}
          />
        </div>
        {shown ? (
          <>
            <div className="acts">
              <Btn
                sm
                flat
                onMouseDown={(e) => {
                  // Keep the selection while the button is pressed.
                  e.preventDefault();
                }}
                onClick={quote}
              >
                Quote selection
              </Btn>
            </div>
            {quoteError ? <Problem>{quoteError}</Problem> : null}
          </>
        ) : null}
      </Panel>
      <div className="col">
        <Field controlId={`${id}-note`}>
          <Label>The note journalists read</Label>
          <Textarea
            ref={noteBox}
            rows={7}
            value={copy}
            onChange={(e) => {
              setBody(e.target.value);
            }}
          />
          <FieldDescription>
            Write it in your own words. Journalists never see the original; they see only what you
            quote here.
          </FieldDescription>
        </Field>
        {save.isError ? <Problem>{save.error.message}</Problem> : null}
        {save.isSuccess ? <p role="status">Saved. Journalists can now read this note.</p> : null}
        <div className="acts">
          <Btn
            sm
            flat
            look="ink"
            disabled={save.isPending || copy.trim() === ''}
            onClick={() => {
              save.mutate(copy);
            }}
          >
            Save the note
          </Btn>
        </div>
        <NoteReview textRef={textRef} />
      </div>
    </div>
  );
}

/** Another moderator, or the owner, reviews a note; returning it deletes it. */
function NoteReview({ textRef }: { textRef: string }) {
  const refresh = useWrittenRefresh();
  const q = useQuery(textQuery(textRef));
  const review = useMutation({
    mutationFn: (verdict: 'approved' | 'returned') =>
      call(reviewRedaction, { params: { ref: textRef }, body: { verdict } }),
    onSuccess: refresh,
  });
  const red = q.data?.item.redaction;
  if (!red) return null;
  return (
    <Panel kind="quiet" title="Review of the note" headingLevel={3}>
      <p>
        Written by {red.redacted_by}, {when(red.redacted_at)}.
      </p>
      {red.review_verdict ? (
        <p>
          {red.review_verdict === 'approved' ? 'Approved' : 'Returned'} by{' '}
          {red.reviewed_by ?? 'a reviewer'}
          {red.reviewed_at ? `, ${when(red.reviewed_at)}` : ''}.
        </p>
      ) : (
        <>
          <p className="muted">
            Another moderator, or the owner, reviews it. Returning it deletes the note, and the
            account stays for staff only until somebody writes another.
          </p>
          {review.isError ? <Problem>{review.error.message}</Problem> : null}
          <div className="acts">
            <Btn
              sm
              flat
              look="ink"
              disabled={review.isPending}
              onClick={() => {
                review.mutate('approved');
              }}
            >
              Approve the note
            </Btn>
            <Btn
              sm
              flat
              disabled={review.isPending}
              onClick={() => {
                review.mutate('returned');
              }}
            >
              Return it
            </Btn>
          </div>
        </>
      )}
    </Panel>
  );
}

// ── a report's own page ─────────────────────────────────────────────────

/**
 * Everything attached to one report, under what the reporter said: its
 * written accounts, its links, and (passed in, read by workstream F's own
 * panel) its files. Each says where it stands. A link's verdict is its
 * group's, so judging it here judges every copy.
 */
export function Attachments({
  threadId,
  declined,
  files,
}: {
  threadId: string;
  declined: boolean;
  /** The report's files panel, or nothing when it has none. */
  files: ReactNode;
}) {
  const q = useQuery({
    queryKey: ['written', threadId],
    queryFn: ({ signal }) => call(getReportWritten, { params: { threadId }, signal }),
  });
  const data = q.data;
  if (!data) {
    return q.isError ? <Problem>{q.error.message}</Problem> : <>{files}</>;
  }
  const written = data.texts.length + data.links.length + data.erased.length > 0;
  if (!written && !files) return null;
  return (
    <section className="col" aria-labelledby={`attachments-${threadId}`}>
      <h2 id={`attachments-${threadId}`}>Attachments</h2>
      <p className="m">
        Each attachment is reviewed on its own. Approving the report puts it on the counts, the
        board and the maps, and shows none of these to anybody.
        {declined ? ' The report is declined, so all of them are kept back.' : ''}
      </p>
      {data.texts.map((t) => (
        <WrittenPanel
          key={t.ref}
          textRef={t.ref}
          shared={t.shared}
          outcome={t.outcome}
          length={t.length}
          declined={declined}
        />
      ))}
      {data.erased
        .filter((e) => e.kind === 'private_text')
        .map((e) => (
          <Note key={`${e.kind}-${e.field_key}-${e.erased_at}`}>
            <span>
              <b>Written account erased</b> {when(e.erased_at)}. The words are gone; this marker
              stays.
            </span>
          </Note>
        ))}
      {data.links.length ? (
        <Panel title={data.links.length === 1 ? 'Link · not published' : 'Links · not published'}>
          {data.links.map((l) => (
            <div key={l.ref} className="col">
              <div className="chips">
                <AttachmentChip state={linkStatus(l.outcome, data.shared, declined)} />
              </div>
              {data.shared ? null : (
                <p className="m">The reporter did not allow journalists to see it.</p>
              )}
              <Reveal textRef={l.ref} label="Show the link" mono />
              {l.group_id === null ? (
                <p className="m">Not judged yet.</p>
              ) : (
                <LinkVerdict
                  link={{ group_id: l.group_id, outcome: l.outcome, comment: l.comment }}
                  sources={
                    l.also_tips || l.also_reports ? alsoSent(l.also_tips, l.also_reports) : ''
                  }
                />
              )}
            </div>
          ))}
        </Panel>
      ) : null}
      {data.erased
        .filter((e) => e.kind === 'private_link')
        .map((e) => (
          <Note key={`${e.kind}-${e.field_key}-${e.erased_at}`}>
            <span>
              <b>Link erased</b> {when(e.erased_at)}. The address is gone; this marker stays.
            </span>
          </Note>
        ))}
      {files}
    </section>
  );
}

function alsoSent(tips: number, reports: number): string {
  const parts = [
    tips ? `${String(tips)} ${tips === 1 ? 'tip' : 'tips'}` : null,
    reports ? `${String(reports)} other ${reports === 1 ? 'report' : 'reports'}` : null,
  ].filter(Boolean);
  return `Also sent in ${parts.join(' and ')}. `;
}
