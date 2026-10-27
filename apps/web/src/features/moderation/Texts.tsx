/**
 * Written accounts (W4): what reporters wrote in their own words, and the
 * tip line's descriptions, before a vetted journalist can read them.
 *
 *   TextsPage      the queue: Waiting, Notes, Kept internal
 *   RedactPage     the original beside the note journalists read
 *   ReportWritten  the same check on a report's own page, with its links
 *
 * NOTHING HERE IS PUBLISHED, and a link is text, never an anchor. A moderator
 * never passes a reporter's words to a journalist: they write a note, quoting
 * what they choose. A note needs the reporter's permission to share; without
 * it the only choices are Keep internal and Illegal, and the server refuses
 * the rest as well. Illegal erases the words now, and cannot be undone, so it asks for
 * a reason (a category, never a description) and a tick.
 */
import {
  TEXT_ERASE_REASONS,
  checkText,
  getReportWritten,
  getText,
  listTexts,
  openText,
  redactText,
  reviewRedaction,
} from '@reportlog/contracts';
import type { TextFilter, TextItem, TextOutcome } from '@reportlog/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useId, useRef, useState } from 'react';
import { Back } from '../../mockup/Back.tsx';
import { Btn } from '../../mockup/Btn.tsx';
import { Chip } from '../../mockup/Chip.tsx';
import { Check, Choice, Choices } from '../../mockup/Choices.tsx';
import { Empty } from '../../mockup/Empty.tsx';
import { Field, FieldDescription, Input, Label, Select, Textarea } from '../../mockup/Form.tsx';
import { Note } from '../../mockup/Note.tsx';
import { Problem } from '../../mockup/Notice.tsx';
import { Pager } from '../../mockup/Pager.tsx';
import { Panel } from '../../mockup/Panel.tsx';
import { Seg } from '../../mockup/Seg.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { call } from '../../lib/api.ts';
import { when } from './parts.tsx';

const REASON_WORDS: Record<(typeof TEXT_ERASE_REASONS)[number], string> = {
  'child-sexual-abuse': 'Child sexual abuse material',
  'terrorist-content': 'Terrorist content',
  'non-consensual-intimate-imagery': 'Intimate images shared without consent',
  'incitement-or-threats': 'Incitement or threats',
  'other-illegal': 'Other illegal content',
  'personal-data': 'Personal data that must not be kept',
};

/** The short words of the queue, and the longer ones of a report's page. */
const SHORT: Record<TextOutcome, string> = {
  redacted: 'Note for journalists',
  withheld: 'Kept internal',
  illegal: 'Illegal',
};
const LONG: Record<TextOutcome, string> = {
  redacted: 'Write a note for journalists',
  withheld: 'Keep internal: nobody outside moderation reads it',
  illegal: 'Illegal: erase it now',
};

const TABS: { value: TextFilter; label: string }[] = [
  { value: 'waiting', label: 'Waiting' },
  { value: 'redacted', label: 'Notes' },
  { value: 'withheld', label: 'Kept internal' },
];

const textsKey = ['texts'] as const;
export const WHY_MIN = 10;
export const WHY_MAX = 500;

/** Characters, said as a count of them. */
const characters = (n: number) => `${String(n)} ${n === 1 ? 'character' : 'characters'}`;

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
      <p className={mono ? 'mono' : undefined} style={{ whiteSpace: 'pre-wrap' }}>
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

// ── the queue ───────────────────────────────────────────────────────────

export function TextsPage() {
  const [filter, setFilter] = useState<TextFilter>('waiting');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: [...textsKey, 'list', filter, page],
    queryFn: ({ signal }) => call(listTexts, { query: { filter, page }, signal }),
    placeholderData: keepPreviousData,
  });
  const counts = q.data?.counts;
  return (
    <StaffPage
      title="Written accounts"
      lede="What reporters wrote in their own words, and what tips described. Never published. Journalists see only a note a moderator writes, and only if the reporter allowed it."
    >
      <Seg
        label="Show"
        options={TABS.map((t) => ({
          key: t.value,
          label: t.label,
          n: counts?.[t.value],
          pressed: filter === t.value,
          onClick: () => {
            setFilter(t.value);
            setPage(1);
          },
        }))}
      />
      <Note>
        <span>
          <b>Only accounts the reporter shared can get a note.</b> If they did not allow
          journalists, the choices are Keep internal or Illegal.
        </span>
      </Note>
      <p className="m">
        {q.data
          ? `${String(counts?.[filter] ?? q.data.items.length)} ${TABS.find((t) => t.value === filter)?.label.toLowerCase() ?? ''}`
          : ''}
      </p>
      {q.isPending ? <p role="status">Reading the written accounts…</p> : null}
      {q.isError ? <Problem>{q.error.message}</Problem> : null}
      {q.data?.items.length === 0 ? (
        <Empty title={filter === 'waiting' ? 'No written account waiting' : 'Nothing here'}>
          {filter === 'waiting'
            ? 'What reporters write, and what tips describe, appears here until a moderator decides what to do with it.'
            : 'No written account has been given this outcome.'}
        </Empty>
      ) : null}
      {q.data?.items.map((item) => (
        <TextCard key={item.ref} item={item} />
      ))}
      {q.data ? (
        <Pager
          page={q.data.page}
          pages={q.data.pages}
          label="Written accounts pages"
          onPage={setPage}
        />
      ) : null}
    </StaffPage>
  );
}

function Chips({ item }: { item: TextItem }) {
  return (
    <div className="chips">
      <Chip kind={item.shared ? 'ok' : 'off'}>
        {item.shared ? 'Shared with journalists' : 'Not shared'}
      </Chip>
      {item.source === 'report' ? (
        <Chip kind={item.answers_public ? 'ok' : 'wait'}>
          {item.answers_public ? 'Answers public' : 'Answers waiting'}
        </Chip>
      ) : (
        <Chip kind="off">Tip line</Chip>
      )}
      {item.outcome ? <Chip>{SHORT[item.outcome]}</Chip> : null}
    </div>
  );
}

function TextCard({ item }: { item: TextItem }) {
  return (
    <article className="panel">
      <Chips item={item} />
      <Reveal textRef={item.ref} />
      <p className="m">
        {item.thread_id && item.reference ? (
          <Link to="/moderate/$threadId" params={{ threadId: item.thread_id }} className="mono">
            {item.reference}
          </Link>
        ) : (
          item.form_title
        )}
        {item.place ? ` · ${item.place}` : ''} · {characters(item.length)}
        {item.checked_by && item.checked_at
          ? ` · decided by ${item.checked_by}, ${when(item.checked_at)}`
          : ''}
      </p>
      <CheckForm item={item} withRedactLink />
    </article>
  );
}

// ── the check ───────────────────────────────────────────────────────────

/**
 * The three choices and the button that records one. A note is written on
 * the note page (saving it IS that outcome), so choosing it and pressing the
 * button goes there.
 */
function CheckForm({
  item,
  long = false,
  withRedactLink = false,
}: {
  item: TextItem;
  long?: boolean;
  withRedactLink?: boolean;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const id = useId();
  const [outcome, setOutcome] = useState<TextOutcome | ''>('');
  const [reason, setReason] = useState('');
  const [sure, setSure] = useState(false);
  const [why, setWhy] = useState('');
  const words = long ? LONG : SHORT;
  const choices: TextOutcome[] = item.shared
    ? ['redacted', 'withheld', 'illegal']
    : ['withheld', 'illegal'];
  const save = useMutation({
    mutationFn: () =>
      call(checkText, {
        params: { ref: item.ref },
        body: { outcome, why: why.trim(), ...(outcome === 'illegal' ? { reason } : {}) },
      }),
    onSuccess: async () => {
      setOutcome('');
      setSure(false);
      setWhy('');
      await qc.invalidateQueries({ queryKey: textsKey });
      await qc.invalidateQueries({ queryKey: ['written'] });
    },
  });
  const whyOk = why.trim().length >= WHY_MIN && why.trim().length <= WHY_MAX;
  const ready =
    outcome !== '' &&
    (outcome === 'redacted' || whyOk) &&
    (outcome !== 'illegal' || (reason !== '' && sure));
  const redactPath = { to: '/moderate/texts/$ref' as const, params: { ref: item.ref } };
  return (
    <>
      <div role="radiogroup" aria-labelledby={`${id}-decide`}>
        <span className="lbl" id={`${id}-decide`}>
          Decide
        </span>
        <Choices>
          {choices.map((o) => (
            <Choice
              key={o}
              name={id}
              value={o}
              checked={outcome === o}
              onChange={() => {
                setOutcome(o);
              }}
            >
              {words[o]}
            </Choice>
          ))}
        </Choices>
      </div>
      {outcome === 'illegal' ? (
        <>
          <Field>
            <Label>Why it is illegal</Label>
            <Select
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            >
              <option value="">Choose one</option>
              {TEXT_ERASE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {REASON_WORDS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Check
            id={`${id}-sure`}
            checked={sure}
            onChange={(e) => {
              setSure(e.target.checked);
            }}
          >
            The words will be erased now and cannot be brought back. A marker stays.
          </Check>
        </>
      ) : null}
      {outcome !== '' && outcome !== 'redacted' ? (
        <Field>
          <Label>Why (for the record)</Label>
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
            }}
          />
        </Field>
      ) : null}
      {save.isError ? <Problem>{save.error.message}</Problem> : null}
      <div className="acts">
        <Btn
          sm
          flat
          look="ink"
          disabled={!ready || save.isPending}
          onClick={() => {
            if (outcome === 'redacted') {
              void navigate(redactPath);
              return;
            }
            save.mutate();
          }}
        >
          {outcome === 'redacted' ? 'Write the note' : 'Record the decision'}
        </Btn>
        {withRedactLink && item.shared ? (
          <Link className="btn sm flat" {...redactPath}>
            Write a note
          </Link>
        ) : null}
      </div>
    </>
  );
}

// ── redaction ───────────────────────────────────────────────────────────

export function RedactPage({ textRef }: { textRef: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: [...textsKey, 'one', textRef],
    queryFn: ({ signal }) => call(getText, { params: { ref: textRef }, signal }),
  });
  const [body, setBody] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  // The original is shown only after this person presses Show (which is
  // logged). The note never starts from it: it starts blank.
  const originalBox = useRef<HTMLDivElement>(null);
  const noteBox = useRef<HTMLTextAreaElement>(null);
  const [shown, setShown] = useState(false);
  const done = () => {
    void qc.invalidateQueries({ queryKey: textsKey });
    void qc.invalidateQueries({ queryKey: ['written'] });
  };
  const save = useMutation({
    mutationFn: (copy: string) =>
      call(redactText, { params: { ref: textRef }, body: { body: copy, why: why.trim() } }),
    onSuccess: done,
  });
  const review = useMutation({
    mutationFn: (verdict: 'approved' | 'returned') =>
      call(reviewRedaction, { params: { ref: textRef }, body: { verdict } }),
    onSuccess: done,
  });
  const item = q.data?.item;
  const title = item ? `Note for ${item.reference ?? 'tip text'}` : 'Note for journalists';
  const copy = body ?? q.data?.redacted ?? '';
  const red = item?.redaction;
  // Insert what is selected in the original, inside quotation marks, at the
  // cursor (or the end). Only a selection inside the original counts.
  const [quoteError, setQuoteError] = useState('');
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
  return (
    <StaffPage title={title} mono>
      <Back to="/moderate/texts">Written accounts</Back>
      {q.isPending ? <p role="status">Reading it…</p> : null}
      {q.isError ? <Problem>{q.error.message}</Problem> : null}
      {item ? (
        <div className="grid2 even">
          <div className="col">
            <Panel kind="quiet" title="The original · kept, never changed">
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
          </div>
          <div className="col">
            <Panel title="The note journalists read">
              <Field>
                <Label>Your note</Label>
                <Textarea
                  ref={noteBox}
                  rows={7}
                  value={copy}
                  onChange={(e) => {
                    setBody(e.target.value);
                  }}
                />
                <FieldDescription>
                  Write it in your own words. Journalists never see the original; they see only what
                  you quote here.
                </FieldDescription>
              </Field>
              <Field>
                <Label>Why (for the record)</Label>
                <FieldDescription>
                  10 to 500 characters. Only staff can read it. Describe the kind of thing, not the
                  words.
                </FieldDescription>
                <Input
                  value={why}
                  maxLength={WHY_MAX}
                  onChange={(e) => {
                    setWhy(e.target.value);
                  }}
                />
              </Field>
              {save.isError ? <Problem>{save.error.message}</Problem> : null}
              {save.isSuccess ? (
                <p role="status">Saved. Journalists can now read this note.</p>
              ) : null}
              <div className="acts">
                <Btn
                  sm
                  flat
                  look="ink"
                  disabled={save.isPending || why.trim().length < WHY_MIN || copy.trim() === ''}
                  onClick={() => {
                    save.mutate(copy);
                  }}
                >
                  Save the note
                </Btn>
              </div>
              <p className="m">Saving gives journalists this note, and never the original.</p>
            </Panel>
            {red ? (
              <Panel kind="quiet" title="Review of the note">
                <p>
                  Written by {red.redacted_by}, {when(red.redacted_at)}. Reason: {red.reason}
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
                      Another moderator, or the owner, reviews it. Returning it deletes the note and
                      the account waits again.
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
            ) : null}
          </div>
        </div>
      ) : null}
      {q.data?.history.length ? (
        <Panel kind="quiet" title="History">
          <div className="code">
            {q.data.history
              .map(
                (h) =>
                  `${when(h.at)} · ${h.kind.replace('_', ' ')} · ${h.by}${h.reason_category ? ` · ${h.reason_category}` : ''}${h.reason ? ` · ${h.reason}` : ''}`,
              )
              .join('\n')}
          </div>
        </Panel>
      ) : null}
    </StaffPage>
  );
}

// ── a report's own page ─────────────────────────────────────────────────

/**
 * The written account and links of one report, under what the reporter said.
 * The check here is the queue's own. A link is checked once, on Links, for
 * every copy of it, so it is only shown here.
 */
export function ReportWritten({ threadId }: { threadId: string }) {
  const q = useQuery({
    queryKey: ['written', threadId],
    queryFn: ({ signal }) => call(getReportWritten, { params: { threadId }, signal }),
  });
  const data = q.data;
  if (!data) return q.isError ? <Problem>{q.error.message}</Problem> : null;
  if (!data.texts.length && !data.links.length && !data.erased.length) return null;
  return (
    <>
      {data.texts.map((t) => (
        <Panel key={t.ref} title="Written account · not published">
          <Reveal textRef={t.ref} />
          <p className="m">
            {characters(t.length)} ·{' '}
            {t.shared
              ? 'the reporter allows vetted journalists to read it'
              : 'the reporter does not allow journalists to read it'}
            {t.outcome ? ` · ${SHORT[t.outcome]}` : ' · no decision yet'}
          </p>
          <CheckForm item={t} long />
          {t.shared ? (
            <div className="acts">
              <Link className="btn sm flat ghost" to="/moderate/texts/$ref" params={{ ref: t.ref }}>
                Write a note
              </Link>
            </div>
          ) : null}
        </Panel>
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
        <Panel title="Link · not published">
          {data.links.map((l) => (
            <div key={l.ref} className="col">
              <Reveal textRef={l.ref} label="Show the link" mono />
              <p className="m">
                {l.also_tips || l.also_reports ? alsoSent(l.also_tips, l.also_reports) : ''}
                {l.outcome ? `Checked once as ${l.outcome}. ` : 'Not checked yet. '}
                Checked once, on <Link to="/lists/links">Links</Link>, for every copy.
              </p>
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
    </>
  );
}

function alsoSent(tips: number, reports: number): string {
  const parts = [
    tips ? `${String(tips)} ${tips === 1 ? 'tip' : 'tips'}` : null,
    reports ? `${String(reports)} other ${reports === 1 ? 'report' : 'reports'}` : null,
  ].filter(Boolean);
  return `Also sent in ${parts.join(' and ')}. `;
}
