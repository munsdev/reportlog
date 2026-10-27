/**
 * Written accounts (W4): what reporters wrote in their own words, and the
 * tip line's descriptions, before a vetted journalist can read them.
 *
 *   TextsPage      the queue: Waiting, Checked, Redacted, Withheld
 *   RedactPage     the original beside the copy journalists read
 *   ReportWritten  the same check on a report's own page, with its links
 *
 * NOTHING HERE IS PUBLISHED, and a link is text, never an anchor. Checked and
 * Checked with redaction need the reporter's permission to share; without it
 * the only choices are Withheld and Illegal, and the server refuses the rest
 * as well. Illegal erases the words now, and cannot be undone, so it asks for
 * a reason (a category, never a description) and a tick.
 */
import {
  TEXT_ERASE_REASONS,
  checkText,
  getReportWritten,
  getText,
  listTexts,
  redactText,
  reviewRedaction,
} from '@reportlog/contracts';
import type { TextFilter, TextItem, TextOutcome } from '@reportlog/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card } from '../../components/ui/card.tsx';
import { CheckOption } from '../../components/ui/choice.tsx';
import { Chip } from '../../components/ui/chip.tsx';
import { Empty } from '../../components/ui/empty.tsx';
import { Field, FieldDescription } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Pagination } from '../../components/ui/pagination.tsx';
import { RadioGroup, RadioOption } from '../../components/ui/radio-group.tsx';
import { Select } from '../../components/ui/select.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { CountLine, Meta } from '../../components/ui/type.tsx';
import { call } from '../../lib/api.ts';
import { StaffHead, when } from './parts.tsx';

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
  checked: 'Checked',
  redacted: 'Checked with redaction',
  withheld: 'Withheld',
  illegal: 'Illegal',
};
const LONG: Record<TextOutcome, string> = {
  checked: 'Checked: journalists may read it as written',
  redacted: 'Checked with redaction: journalists read your edited copy',
  withheld: 'Withheld: nobody outside moderation reads it',
  illegal: 'Illegal: erase it now',
};

const TABS: { value: TextFilter; label: string }[] = [
  { value: 'waiting', label: 'Waiting' },
  { value: 'checked', label: 'Checked' },
  { value: 'redacted', label: 'Redacted' },
  { value: 'withheld', label: 'Withheld' },
];

const textsKey = ['texts'] as const;

/** Characters, said as a count of them. */
const characters = (n: number) => `${String(n)} ${n === 1 ? 'character' : 'characters'}`;

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
    <div className="flex flex-col gap-6">
      <StaffHead
        title="Written accounts"
        lede="What reporters wrote in their own words, and what tips described. Never published. Checked accounts reach vetted journalists only if the reporter allowed it."
      />
      <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button
            key={t.value}
            type="button"
            variant="secondary"
            aria-pressed={filter === t.value}
            className="shrink-0 aria-pressed:border-[3px] aria-pressed:bg-paper-alt"
            onClick={() => {
              setFilter(t.value);
              setPage(1);
            }}
          >
            {t.label}
            {counts ? <span className="ml-1.5 font-mono">{counts[t.value]}</span> : null}
          </Button>
        ))}
      </div>
      <Alert tone="note" title="Only accounts the reporter shared can be Checked.">
        If they did not allow journalists, the choices are Withheld or Illegal.
      </Alert>
      <CountLine
        parts={[
          q.data
            ? `${String(counts?.[filter] ?? q.data.items.length)} ${TABS.find((t) => t.value === filter)?.label.toLowerCase() ?? ''}`
            : null,
        ]}
      />
      {q.isPending ? <p role="status">Reading the written accounts…</p> : null}
      {q.isError ? <Alert tone="serious">{q.error.message}</Alert> : null}
      {q.data?.items.length === 0 ? (
        <Empty title={filter === 'waiting' ? 'No written account waiting' : 'Nothing here'}>
          {filter === 'waiting'
            ? 'What reporters write, and what tips describe, appears here until somebody checks it.'
            : 'No written account has been given this outcome.'}
        </Empty>
      ) : null}
      <ul className="flex flex-col gap-4" aria-label="Written accounts">
        {q.data?.items.map((item) => (
          <li key={item.ref}>
            <TextCard item={item} />
          </li>
        ))}
      </ul>
      {q.data ? (
        <Pagination
          page={q.data.page}
          pages={q.data.pages}
          label="Written accounts pages"
          onPage={setPage}
        />
      ) : null}
    </div>
  );
}

function Chips({ item }: { item: TextItem }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Chip tone={item.shared ? 'confirmed' : 'open'}>
        {item.shared ? 'Shared with journalists' : 'Not shared'}
      </Chip>
      {item.source === 'report' ? (
        <Chip tone="tag">{item.answers_public ? 'Answers public' : 'Answers waiting'}</Chip>
      ) : (
        <Chip tone="tag">Tip line</Chip>
      )}
      {item.outcome ? <Chip tone="tag">{SHORT[item.outcome]}</Chip> : null}
    </div>
  );
}

function TextCard({ item }: { item: TextItem }) {
  return (
    <Card>
      <Chips item={item} />
      {item.text === null ? (
        <p className="text-ink-alt">These words could not be opened.</p>
      ) : (
        <p className="max-w-prose whitespace-pre-wrap">{item.text}</p>
      )}
      <Meta>
        {item.thread_id && item.reference ? (
          <Link
            to="/moderate/$threadId"
            params={{ threadId: item.thread_id }}
            className="underline"
          >
            {item.reference}
          </Link>
        ) : (
          item.form_title
        )}
        {item.place ? ` · ${item.place}` : ''} · {characters(item.length)}
        {item.checked_by && item.checked_at
          ? ` · checked by ${item.checked_by}, ${when(item.checked_at)}`
          : ''}
      </Meta>
      <CheckForm item={item} withRedactLink />
    </Card>
  );
}

// ── the check ───────────────────────────────────────────────────────────

/**
 * The four choices and the button that records one. "Checked with redaction"
 * is written on the Redact page (saving a copy IS that outcome), so choosing
 * it and pressing the button goes there.
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
  const words = long ? LONG : SHORT;
  const choices: TextOutcome[] = item.shared
    ? ['checked', 'redacted', 'withheld', 'illegal']
    : ['withheld', 'illegal'];
  const save = useMutation({
    mutationFn: () =>
      call(checkText, {
        params: { ref: item.ref },
        body: { outcome, ...(outcome === 'illegal' ? { reason } : {}) },
      }),
    onSuccess: async () => {
      setOutcome('');
      setSure(false);
      await qc.invalidateQueries({ queryKey: textsKey });
      await qc.invalidateQueries({ queryKey: ['written'] });
    },
  });
  const ready = outcome !== '' && (outcome !== 'illegal' || (reason !== '' && sure));
  const redactPath = { to: '/moderate/texts/$ref' as const, params: { ref: item.ref } };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="label-face text-xs text-ink-alt">Check it</legend>
      <RadioGroup
        aria-label="Check it"
        name={id}
        value={outcome}
        onValueChange={(v) => {
          setOutcome(v as TextOutcome);
        }}
      >
        {choices.map((o) => (
          <RadioOption key={o} id={`${id}-${o}`} value={o} label={words[o]} />
        ))}
      </RadioGroup>
      {outcome === 'illegal' ? (
        <div className="flex flex-col gap-3 rounded-card border border-line p-3">
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
          <CheckOption
            id={`${id}-sure`}
            label="The words will be erased now and cannot be brought back. A marker stays."
            checked={sure}
            onCheckedChange={(on) => {
              setSure(on === true);
            }}
          />
        </div>
      ) : null}
      {save.isError ? <Alert tone="serious">{save.error.message}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!ready || save.isPending}
          onClick={() => {
            if (outcome === 'redacted') {
              void navigate(redactPath);
              return;
            }
            save.mutate();
          }}
        >
          {outcome === 'redacted' ? 'Write the copy' : 'Record the check'}
        </Button>
        {withRedactLink && item.shared ? (
          <Button asChild variant="secondary">
            <Link {...redactPath}>Redact a copy</Link>
          </Button>
        ) : null}
      </div>
    </fieldset>
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
  const title = item ? `Redact ${item.reference ?? 'tip text'}` : 'Redact';
  const copy = body ?? q.data?.redacted ?? item?.text ?? '';
  const red = item?.redaction;
  return (
    <div className="flex flex-col gap-6">
      <StaffHead title={title} mono />
      <Button asChild variant="quiet" className="self-start">
        <Link to="/moderate/texts">← Written accounts</Link>
      </Button>
      {q.isPending ? <p role="status">Reading it…</p> : null}
      {q.isError ? <Alert tone="serious">{q.error.message}</Alert> : null}
      {item ? (
        <div className="grid items-start gap-6 md:grid-cols-2">
          <Card variant="quiet" heading="The original · kept, never changed">
            <p className="max-w-prose whitespace-pre-wrap">{item.text ?? 'Could not be opened.'}</p>
          </Card>
          <div className="flex flex-col gap-6">
            <Card heading="The copy journalists read">
              <Field>
                <Label>Edit the copy</Label>
                <Textarea
                  rows={7}
                  value={copy}
                  onChange={(e) => {
                    setBody(e.target.value);
                  }}
                />
                <FieldDescription>Mark what you removed in square brackets.</FieldDescription>
              </Field>
              <Field>
                <Label>Why (for the record)</Label>
                <Input
                  value={why}
                  maxLength={500}
                  onChange={(e) => {
                    setWhy(e.target.value);
                  }}
                />
              </Field>
              {save.isError ? <Alert tone="serious">{save.error.message}</Alert> : null}
              {save.isSuccess ? (
                <p role="status">Saved. It is now Checked with redaction.</p>
              ) : null}
              <Button
                type="button"
                className="self-start"
                disabled={save.isPending || why.trim() === '' || copy.trim() === ''}
                onClick={() => {
                  save.mutate(copy);
                }}
              >
                Save the redacted copy
              </Button>
              <p className="text-sm text-ink-alt">Saving marks it Checked with redaction.</p>
            </Card>
            {red ? (
              <Card variant="quiet" heading="Review of the copy">
                <p className="text-sm">
                  Written by {red.redacted_by}, {when(red.redacted_at)}. Reason: {red.reason}
                </p>
                {red.review_verdict ? (
                  <p className="text-sm">
                    {red.review_verdict === 'approved' ? 'Approved' : 'Returned'} by{' '}
                    {red.reviewed_by ?? 'a reviewer'}
                    {red.reviewed_at ? `, ${when(red.reviewed_at)}` : ''}.
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-ink-alt">
                      Another moderator, or the owner, reviews it. Returning it deletes the copy and
                      the account waits again.
                    </p>
                    {review.isError ? <Alert tone="serious">{review.error.message}</Alert> : null}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        disabled={review.isPending}
                        onClick={() => {
                          review.mutate('approved');
                        }}
                      >
                        Approve the copy
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={review.isPending}
                        onClick={() => {
                          review.mutate('returned');
                        }}
                      >
                        Return it
                      </Button>
                    </div>
                  </>
                )}
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}
      {q.data?.history.length ? (
        <Card variant="quiet" heading="History">
          <ol className="flex flex-col gap-1 font-mono text-sm">
            {q.data.history.map((h) => (
              <li key={`${h.at}-${h.kind}`}>
                {when(h.at)} · {h.kind.replace('_', ' ')} · {h.by}
                {h.reason_category ? ` · ${h.reason_category}` : ''}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
    </div>
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
  if (!data) return q.isError ? <Alert tone="serious">{q.error.message}</Alert> : null;
  if (!data.texts.length && !data.links.length && !data.erased.length) return null;
  return (
    <>
      {data.texts.map((t) => (
        <Card key={t.ref} heading="Written account · not published">
          {t.text === null ? (
            <p className="text-ink-alt">These words could not be opened.</p>
          ) : (
            <p className="max-w-prose whitespace-pre-wrap">{t.text}</p>
          )}
          <p className="text-sm text-ink-alt">
            {characters(t.length)} ·{' '}
            {t.shared
              ? 'the reporter allows vetted journalists to read it'
              : 'the reporter does not allow journalists to read it'}
            {t.outcome ? ` · ${SHORT[t.outcome]}` : ' · not checked yet'}
          </p>
          <CheckForm item={t} long />
          {t.shared ? (
            <Button asChild variant="quiet" className="self-start">
              <Link to="/moderate/texts/$ref" params={{ ref: t.ref }}>
                Redact a copy
              </Link>
            </Button>
          ) : null}
        </Card>
      ))}
      {data.erased
        .filter((e) => e.kind === 'private_text')
        .map((e) => (
          <Alert
            key={`${e.kind}-${e.field_key}-${e.erased_at}`}
            tone="note"
            title="Written account erased"
          >
            {when(e.erased_at)}. The words are gone; this marker stays.
          </Alert>
        ))}
      {data.links.length ? (
        <Card heading="Link · not published">
          <ul className="flex flex-col gap-3">
            {data.links.map((l) => (
              <li key={l.url} className="flex flex-col gap-1">
                <p className="font-mono break-all">{l.url}</p>
                <p className="text-sm text-ink-alt">
                  {l.also_tips || l.also_reports ? alsoSent(l.also_tips, l.also_reports) : ''}
                  {l.outcome ? `Checked once as ${l.outcome}. ` : 'Not checked yet. '}
                  Checked once, on{' '}
                  <Link to="/lists/links" className="underline">
                    Links
                  </Link>
                  , for every copy.
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {data.erased
        .filter((e) => e.kind === 'private_link')
        .map((e) => (
          <Alert key={`${e.kind}-${e.field_key}-${e.erased_at}`} tone="note" title="Link erased">
            {when(e.erased_at)}. The address is gone; this marker stays.
          </Alert>
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
